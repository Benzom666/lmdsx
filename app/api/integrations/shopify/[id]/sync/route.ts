import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get connection details
    const { data: connection, error } = await supabase.from("shopify_connections").select("*").eq("id", id).single()

    if (error || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Fetch orders from Shopify
    const shopifyResponse = await fetch(
      `https://${connection.shop_domain}/admin/api/2023-10/orders.json?status=any&limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": connection.access_token,
        },
      },
    )

    if (!shopifyResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch orders from Shopify" }, { status: 400 })
    }

    const ordersData = await shopifyResponse.json()
    const orders = ordersData.orders || []

    let syncedCount = 0

    // Process each order
    for (const order of orders) {
      try {
        // Check if order already exists
        const { data: existingOrder } = await supabase
          .from("shopify_orders")
          .select("id")
          .eq("shopify_order_id", order.id.toString())
          .single()

        if (!existingOrder) {
          // Create new order record
          const { error: insertError } = await supabase.from("shopify_orders").insert({
            shopify_connection_id: id,
            shopify_order_id: order.id.toString(),
            order_number: order.order_number || order.name,
            customer_name: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : "Unknown",
            customer_email: order.customer?.email || "",
            customer_phone: order.customer?.phone || "",
            shipping_address: order.shipping_address,
            line_items: order.line_items,
            total_price: order.total_price,
            fulfillment_status: order.fulfillment_status || "unfulfilled",
            financial_status: order.financial_status || "pending",
            created_at: order.created_at,
            synced_at: new Date().toISOString(),
          })

          if (!insertError) {
            syncedCount++

            // Optionally create delivery order if auto_create_orders is enabled
            if (connection.settings.auto_create_orders && order.shipping_address) {
              await createDeliveryOrder(order, connection)
            }
          }
        }
      } catch (orderError) {
        console.error(`Error processing order ${order.id}:`, orderError)
      }
    }

    // Update connection sync stats
    await supabase
      .from("shopify_connections")
      .update({
        last_sync: new Date().toISOString(),
        orders_synced: connection.orders_synced + syncedCount,
      })
      .eq("id", id)

    return NextResponse.json({
      success: true,
      synced_count: syncedCount,
      total_orders: orders.length,
    })
  } catch (error) {
    console.error("Error syncing Shopify orders:", error)
    return NextResponse.json({ error: "Failed to sync orders" }, { status: 500 })
  }
}

async function createDeliveryOrder(shopifyOrder: any, connection: any) {
  try {
    const { error } = await supabase.from("orders").insert({
      tracking_number: `SH-${shopifyOrder.order_number}`,
      customer_name: shopifyOrder.customer
        ? `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`
        : "Unknown",
      customer_phone: shopifyOrder.customer?.phone || "",
      customer_email: shopifyOrder.customer?.email || "",
      pickup_address: "Store Location", // You might want to configure this
      delivery_address: formatAddress(shopifyOrder.shipping_address),
      package_details: shopifyOrder.line_items.map((item: any) => `${item.quantity}x ${item.title}`).join(", "),
      delivery_instructions: shopifyOrder.note || "",
      priority: "normal",
      status: "pending",
      source: "shopify",
      external_order_id: shopifyOrder.id.toString(),
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.error("Error creating delivery order:", error)
    }
  } catch (error) {
    console.error("Error in createDeliveryOrder:", error)
  }
}

function formatAddress(address: any): string {
  if (!address) return ""

  const parts = [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
  ].filter(Boolean)

  return parts.join(", ")
}
