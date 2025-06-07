import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get the session from the request headers for authentication
    const authHeader = request.headers.get("authorization")
    if (!authHeader) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Create authenticated Supabase client
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    )

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Invalid authentication" }, { status: 401 })
    }

    // Verify user is an admin
    const { data: userProfile, error: profileError } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (profileError || !userProfile || userProfile.role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    // Get connection details and verify ownership
    const { data: connection, error: connectionError } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("id", id)
      .eq("admin_id", user.id) // Ensure the connection belongs to this admin
      .single()

    if (connectionError) {
      console.error("Database error fetching connection:", connectionError)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    if (!connection) {
      return NextResponse.json({ error: "Connection not found or access denied" }, { status: 404 })
    }

    if (!connection.is_active) {
      return NextResponse.json({ error: "Connection is not active" }, { status: 400 })
    }

    // Validate connection details
    if (!connection.shop_domain || !connection.access_token) {
      return NextResponse.json({ error: "Invalid connection configuration" }, { status: 400 })
    }

    console.log(`Syncing orders for shop: ${connection.shop_domain}`)

    // Fetch orders from Shopify with improved error handling
    let shopifyResponse
    try {
      const shopifyUrl = `https://${connection.shop_domain}/admin/api/2023-10/orders.json?status=any&limit=50`
      console.log(`Fetching from: ${shopifyUrl}`)

      // Create an AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      shopifyResponse = await fetch(shopifyUrl, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": connection.access_token,
          "Content-Type": "application/json",
          "User-Agent": "DeliverySystem/1.0",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log(`Shopify API response status: ${shopifyResponse.status}`)

      if (!shopifyResponse.ok) {
        const errorText = await shopifyResponse.text()
        console.error(`Shopify API error: ${shopifyResponse.status} - ${errorText}`)

        if (shopifyResponse.status === 401) {
          return NextResponse.json({ error: "Invalid Shopify access token" }, { status: 401 })
        } else if (shopifyResponse.status === 403) {
          return NextResponse.json({ error: "Insufficient permissions for Shopify API" }, { status: 403 })
        } else if (shopifyResponse.status === 404) {
          return NextResponse.json({ error: "Shopify store not found" }, { status: 404 })
        } else if (shopifyResponse.status === 429) {
          return NextResponse.json(
            { error: "Shopify API rate limit exceeded. Please try again later." },
            { status: 429 },
          )
        } else {
          return NextResponse.json(
            {
              error: `Shopify API error: ${shopifyResponse.status}`,
              details: errorText,
            },
            { status: 400 },
          )
        }
      }
    } catch (fetchError) {
      console.error("Network error fetching from Shopify:", fetchError)

      // Handle different types of fetch errors
      if (fetchError instanceof Error) {
        if (fetchError.name === "AbortError") {
          return NextResponse.json({ error: "Request timeout - Shopify API took too long to respond" }, { status: 408 })
        } else if (fetchError.message.includes("ENOTFOUND") || fetchError.message.includes("DNS")) {
          return NextResponse.json(
            { error: "Cannot resolve Shopify store domain. Please check the shop domain." },
            { status: 400 },
          )
        } else if (fetchError.message.includes("ECONNREFUSED")) {
          return NextResponse.json(
            { error: "Connection refused by Shopify. Please check your store configuration." },
            { status: 400 },
          )
        } else if (fetchError.message.includes("certificate") || fetchError.message.includes("SSL")) {
          return NextResponse.json({ error: "SSL certificate error. Please check your connection." }, { status: 400 })
        }
      }

      return NextResponse.json(
        {
          error: "Failed to connect to Shopify API",
          details: fetchError instanceof Error ? fetchError.message : "Network error",
        },
        { status: 500 },
      )
    }

    let ordersData
    try {
      ordersData = await shopifyResponse.json()
    } catch (parseError) {
      console.error("Error parsing Shopify response:", parseError)
      return NextResponse.json({ error: "Invalid response from Shopify API" }, { status: 500 })
    }

    const orders = ordersData.orders || []
    console.log(`Found ${orders.length} orders from Shopify`)

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        synced_count: 0,
        total_orders: 0,
        error_count: 0,
        message: "No new orders to sync",
      })
    }

    let syncedCount = 0
    let errorCount = 0

    // Process each order using the authenticated client to respect RLS
    for (const order of orders) {
      try {
        // Check if order already exists using the authenticated client
        const { data: existingOrder } = await supabaseAuth
          .from("shopify_orders")
          .select("id")
          .eq("shopify_order_id", order.id.toString())
          .single()

        if (!existingOrder) {
          // Create new order record using the authenticated client
          const orderData = {
            shopify_connection_id: id,
            shopify_order_id: order.id.toString(),
            order_number: order.order_number || order.name || `#${order.id}`,
            customer_name: order.customer
              ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || "Unknown Customer"
              : "Unknown Customer",
            customer_email: order.customer?.email || "",
            customer_phone: order.customer?.phone || "",
            shipping_address: order.shipping_address || {},
            line_items: order.line_items || [],
            total_price: order.total_price || "0.00",
            fulfillment_status: order.fulfillment_status || "unfulfilled",
            financial_status: order.financial_status || "pending",
            created_at: order.created_at || new Date().toISOString(),
            synced_at: new Date().toISOString(),
          }

          const { error: insertError } = await supabaseAuth.from("shopify_orders").insert(orderData)

          if (insertError) {
            console.error(`Error inserting order ${order.id}:`, insertError)
            errorCount++
          } else {
            syncedCount++
            console.log(`Synced order: ${order.order_number || order.name}`)

            // Optionally create delivery order if auto_create_orders is enabled
            if (connection.settings?.auto_create_orders && order.shipping_address) {
              try {
                await createDeliveryOrder(order, connection, user.id)
              } catch (deliveryError) {
                console.error(`Error creating delivery order for ${order.id}:`, deliveryError)
              }
            }
          }
        } else {
          console.log(`Order ${order.order_number || order.name} already exists, skipping`)
        }
      } catch (orderError) {
        console.error(`Error processing order ${order.id}:`, orderError)
        errorCount++
      }
    }

    // Update connection sync stats using service role (admin owns the connection)
    try {
      await supabase
        .from("shopify_connections")
        .update({
          last_sync: new Date().toISOString(),
          orders_synced: connection.orders_synced + syncedCount,
        })
        .eq("id", id)
        .eq("admin_id", user.id) // Ensure we only update connections owned by this admin
    } catch (updateError) {
      console.error("Error updating connection stats:", updateError)
    }

    console.log(`Sync completed: ${syncedCount} synced, ${errorCount} errors`)

    return NextResponse.json({
      success: true,
      synced_count: syncedCount,
      total_orders: orders.length,
      error_count: errorCount,
      message: `Successfully synced ${syncedCount} orders${errorCount > 0 ? ` (${errorCount} errors)` : ""}`,
    })
  } catch (error) {
    console.error("Error syncing Shopify orders:", error)
    return NextResponse.json(
      {
        error: "Failed to sync orders",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function createDeliveryOrder(shopifyOrder: any, connection: any, adminId: string) {
  try {
    const deliveryOrderData = {
      tracking_number: `SH-${shopifyOrder.order_number || shopifyOrder.id}`,
      customer_name: shopifyOrder.customer
        ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim() ||
          "Unknown Customer"
        : "Unknown Customer",
      customer_phone: shopifyOrder.customer?.phone || "",
      customer_email: shopifyOrder.customer?.email || "",
      pickup_address: connection.settings?.pickup_address || "Store Location",
      delivery_address: formatAddress(shopifyOrder.shipping_address),
      package_details:
        shopifyOrder.line_items
          ?.map((item: any) => `${item.quantity || 1}x ${item.title || item.name || "Item"}`)
          .join(", ") || "Shopify Order Items",
      delivery_instructions: shopifyOrder.note || "",
      priority: "normal",
      status: "pending",
      source: "shopify",
      external_order_id: shopifyOrder.id.toString(),
      admin_id: adminId, // Ensure the delivery order is associated with the correct admin
      created_at: new Date().toISOString(),
    }

    // Use service role for creating delivery orders since we've already verified admin ownership
    const { error } = await supabase.from("orders").insert(deliveryOrderData)

    if (error) {
      console.error("Error creating delivery order:", error)
      throw error
    } else {
      console.log(`Created delivery order for Shopify order: ${shopifyOrder.order_number || shopifyOrder.id}`)
    }
  } catch (error) {
    console.error("Error in createDeliveryOrder:", error)
    throw error
  }
}

function formatAddress(address: any): string {
  if (!address) return ""

  const parts = [
    address.address1,
    address.address2,
    address.city,
    address.province || address.province_code,
    address.zip || address.postal_code,
    address.country || address.country_code,
  ].filter(Boolean)

  return parts.join(", ")
}
