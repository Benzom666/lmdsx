import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get("x-shopify-hmac-sha256")
    const topic = request.headers.get("x-shopify-topic")
    const shopDomain = request.headers.get("x-shopify-shop-domain")

    if (!signature || !topic || !shopDomain) {
      return NextResponse.json({ error: "Missing required headers" }, { status: 400 })
    }

    // Get connection for this shop
    const { data: connection, error } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("shop_domain", shopDomain)
      .eq("is_active", true)
      .single()

    if (error || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Verify webhook signature if secret is configured
    if (connection.webhook_secret) {
      const expectedSignature = crypto
        .createHmac("sha256", connection.webhook_secret)
        .update(body, "utf8")
        .digest("base64")

      if (signature !== expectedSignature) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
    }

    const orderData = JSON.parse(body)

    // Handle different webhook topics
    switch (topic) {
      case "orders/create":
      case "orders/updated":
        await handleOrderWebhook(orderData, connection, topic)
        break
      case "orders/paid":
        await handleOrderPaid(orderData, connection)
        break
      case "orders/cancelled":
        await handleOrderCancelled(orderData, connection)
        break
      case "orders/fulfilled":
      case "orders/partially_fulfilled":
        await handleOrderFulfilled(orderData, connection)
        break
      default:
        console.log(`Unhandled webhook topic: ${topic}`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error processing Shopify webhook:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

async function handleOrderWebhook(orderData: any, connection: any, topic: string) {
  try {
    // Check if order already exists
    const { data: existingOrder } = await supabase
      .from("shopify_orders")
      .select("id")
      .eq("shopify_order_id", orderData.id.toString())
      .single()

    const orderRecord = {
      shopify_connection_id: connection.id,
      shopify_order_id: orderData.id.toString(),
      order_number: orderData.order_number || orderData.name,
      customer_name: orderData.customer
        ? `${orderData.customer.first_name} ${orderData.customer.last_name}`
        : "Unknown",
      customer_email: orderData.customer?.email || "",
      customer_phone: orderData.customer?.phone || "",
      shipping_address: orderData.shipping_address,
      line_items: orderData.line_items,
      total_price: orderData.total_price,
      fulfillment_status: orderData.fulfillment_status || "unfulfilled",
      financial_status: orderData.financial_status || "pending",
      created_at: orderData.created_at,
      synced_at: new Date().toISOString(),
    }

    if (existingOrder) {
      // Update existing order
      await supabase.from("shopify_orders").update(orderRecord).eq("id", existingOrder.id)
    } else {
      // Create new order
      await supabase.from("shopify_orders").insert(orderRecord)

      // Create delivery order if auto_create_orders is enabled
      if (connection.settings.auto_create_orders && orderData.shipping_address) {
        await createDeliveryOrderFromWebhook(orderData, connection)
      }
    }
  } catch (error) {
    console.error("Error handling order webhook:", error)
  }
}

async function handleOrderPaid(orderData: any, connection: any) {
  // Update order status and potentially trigger delivery creation
  await handleOrderWebhook(orderData, connection, "orders/paid")
}

async function handleOrderCancelled(orderData: any, connection: any) {
  // Update order status and cancel any related deliveries
  await handleOrderWebhook(orderData, connection, "orders/cancelled")

  // Cancel related delivery orders
  await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("external_order_id", orderData.id.toString())
    .eq("source", "shopify")
}

async function handleOrderFulfilled(orderData: any, connection: any) {
  // Update order status
  await handleOrderWebhook(orderData, connection, "orders/fulfilled")
}

async function createDeliveryOrderFromWebhook(shopifyOrder: any, connection: any) {
  try {
    const { error } = await supabase.from("orders").insert({
      tracking_number: `SH-${shopifyOrder.order_number}`,
      customer_name: shopifyOrder.customer
        ? `${shopifyOrder.customer.first_name} ${shopifyOrder.customer.last_name}`
        : "Unknown",
      customer_phone: shopifyOrder.customer?.phone || "",
      customer_email: shopifyOrder.customer?.email || "",
      pickup_address: "Store Location",
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
      console.error("Error creating delivery order from webhook:", error)
    }
  } catch (error) {
    console.error("Error in createDeliveryOrderFromWebhook:", error)
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
