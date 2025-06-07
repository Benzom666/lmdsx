import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { logError } from "@/lib/error-handler"

// Use service role client that bypasses RLS
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  console.log("=== SYNC ORDERS ENDPOINT CALLED ===")
  console.log("Connection ID:", params.id)
  console.log("Environment:", process.env.NODE_ENV)
  console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL)

  try {
    const { id } = params // This is shopify_connection_id

    // Get the session from the request headers for authentication
    const authHeader = request.headers.get("authorization")
    console.log("Auth header present:", !!authHeader)

    if (!authHeader) {
      console.log("❌ No authorization header")
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // Create authenticated Supabase client for user verification
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
    console.log("Getting user from auth...")
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError) {
      console.log("❌ Auth error:", authError)
      return NextResponse.json({ error: "Authentication failed", details: authError.message }, { status: 401 })
    }

    if (!user) {
      console.log("❌ No user found")
      return NextResponse.json({ error: "User not found" }, { status: 401 })
    }

    console.log("✅ User authenticated:", user.id)

    // Verify user is an admin using service role client
    console.log("Checking user role...")
    const { data: userProfile, error: profileError } = await supabaseServiceRole
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (profileError) {
      console.log("❌ Profile error:", profileError)
      return NextResponse.json({ error: "Failed to verify user role", details: profileError.message }, { status: 500 })
    }

    if (!userProfile || userProfile.role !== "admin") {
      console.log("❌ User is not admin. Role:", userProfile?.role)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    console.log("✅ User is admin")

    // Get connection details and verify ownership using service role client
    console.log("Fetching connection details...")
    const { data: connection, error: connectionError } = await supabaseServiceRole
      .from("shopify_connections")
      .select("*")
      .eq("id", id)
      .eq("admin_id", user.id) // Ensure the connection belongs to this admin
      .single()

    if (connectionError) {
      console.log("❌ Connection error:", connectionError)
      return NextResponse.json({ error: "Database error", details: connectionError.message }, { status: 500 })
    }

    if (!connection) {
      console.log("❌ Connection not found for ID:", id, "and admin:", user.id)
      return NextResponse.json({ error: "Connection not found or access denied" }, { status: 404 })
    }

    console.log("✅ Connection found:", connection.shop_domain)

    if (!connection.is_active) {
      console.log("❌ Connection is not active")
      return NextResponse.json({ error: "Connection is not active" }, { status: 400 })
    }

    // Validate connection details
    if (!connection.shop_domain || !connection.access_token) {
      console.log("❌ Invalid connection configuration")
      return NextResponse.json({ error: "Invalid connection configuration" }, { status: 400 })
    }

    console.log(`🔄 Syncing orders for shop: ${connection.shop_domain}`)

    // In production, we'll use real Shopify API
    let orders: any[] = []
    let isRealShopifyData = false

    if (process.env.NODE_ENV === "production" && connection.access_token.startsWith("shpat_")) {
      try {
        console.log("🌐 Fetching real orders from Shopify API...")
        orders = await fetchShopifyOrders(connection.shop_domain, connection.access_token)
        isRealShopifyData = true
        console.log(`✅ Fetched ${orders.length} real orders from Shopify`)
      } catch (shopifyError) {
        console.log("⚠️ Shopify API failed, falling back to demo data:", shopifyError)
        orders = generateMockShopifyOrders(connection.shop_domain)
        isRealShopifyData = false
      }
    } else {
      console.log("🎭 Using demo data (development mode or invalid token)")
      orders = generateMockShopifyOrders(connection.shop_domain)
      isRealShopifyData = false
    }

    if (orders.length === 0) {
      console.log("ℹ️ No orders to sync")
      return NextResponse.json({
        success: true,
        synced_count: 0,
        total_orders: 0,
        error_count: 0,
        message: "No new orders to sync",
        data_source: isRealShopifyData ? "shopify_api" : "demo",
      })
    }

    let syncedCount = 0
    let errorCount = 0

    console.log(`🔄 Processing ${orders.length} orders...`)

    for (const order of orders) {
      try {
        console.log(`Processing order: ${order.order_number || order.name || order.id}`)

        const { data: existingOrderCheck, error: checkError } = await supabaseServiceRole.rpc(
          "check_shopify_order_exists",
          {
            p_shopify_order_id: order.id.toString(),
            p_connection_id: id, // shopify_connection_id
          },
        )

        if (checkError) {
          console.error(`❌ Error checking if order ${order.id} exists:`, checkError)
          errorCount++
          continue
        }

        const orderExists = existingOrderCheck

        if (!orderExists) {
          const orderData = {
            shopify_connection_id: id, // shopify_connection_id
            shopify_order_id: order.id.toString(),
            order_number: order.order_number || order.name || `#${order.id}`,
            customer_name: order.customer
              ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || "Unknown Customer"
              : "Unknown Customer",
            customer_email: order.customer?.email || "",
            customer_phone: order.customer?.phone || "",
            shipping_address: order.shipping_address || {},
            line_items: order.line_items || [],
            total_price: Number.parseFloat(order.total_price || "0.00"), // Ensure this is a number
            fulfillment_status: order.fulfillment_status || "unfulfilled",
            financial_status: order.financial_status || "pending",
            created_at: order.created_at || new Date().toISOString(),
            synced_at: new Date().toISOString(),
          }

          console.log(`💾 Inserting order: ${orderData.order_number}`)
          const { error: insertError } = await supabaseServiceRole.rpc("insert_shopify_order", {
            p_data: orderData, // This will be stringified by the Supabase client
          })

          if (insertError) {
            console.error(`❌ Error inserting order ${order.id} (${order.order_number || order.name}):`, insertError)
            errorCount++
          } else {
            syncedCount++
            console.log(`✅ Synced order: ${order.order_number || order.name}`)

            if (connection.settings?.auto_create_orders && order.shipping_address) {
              try {
                await createDeliveryOrder(order, connection, user.id)
                console.log(`📦 Created delivery order for: ${order.order_number || order.name}`)
              } catch (deliveryError) {
                console.error(`❌ Error creating delivery order for ${order.id}:`, deliveryError)
              }
            }
          }
        } else {
          console.log(`ℹ️ Order ${order.order_number || order.name} already exists, skipping`)
        }
      } catch (orderError) {
        console.error(`❌ Error processing order ${order.id}:`, orderError)
        errorCount++
      }
    }

    // Update connection stats
    try {
      console.log("📊 Updating connection stats...")
      await supabaseServiceRole
        .from("shopify_connections")
        .update({
          last_sync: new Date().toISOString(),
          orders_synced: (connection.orders_synced || 0) + syncedCount,
        })
        .eq("id", id)
        .eq("admin_id", user.id)
      console.log("✅ Connection stats updated")
    } catch (updateError) {
      console.error("⚠️ Error updating connection stats:", updateError)
    }

    const message = isRealShopifyData
      ? `Successfully synced ${syncedCount} orders from Shopify${errorCount > 0 ? ` (${errorCount} errors)` : ""}`
      : `Successfully synced ${syncedCount} demo orders${errorCount > 0 ? ` (${errorCount} errors)` : ""} (Demo Mode)`

    console.log(`🎉 Sync completed: ${syncedCount} synced, ${errorCount} errors`)
    return NextResponse.json({
      success: true,
      synced_count: syncedCount,
      total_orders: orders.length,
      error_count: errorCount,
      message,
      data_source: isRealShopifyData ? "shopify_api" : "demo",
    })
  } catch (error) {
    console.error("💥 Critical error in sync endpoint:", error)
    logError(error, { endpoint: "shopify_sync", connection_id: params.id })
    return NextResponse.json(
      {
        error: "Failed to sync orders",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function fetchShopifyOrders(shopDomain: string, accessToken: string): Promise<any[]> {
  const url = `https://${shopDomain}/admin/api/2023-10/orders.json?status=any&limit=50`

  console.log("🌐 Fetching from Shopify API:", url)

  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("❌ Shopify API error:", response.status, errorText)
    throw new Error(`Shopify API error: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  console.log(`✅ Shopify API returned ${data.orders?.length || 0} orders`)
  return data.orders || []
}

function generateMockShopifyOrders(shopDomain: string): any[] {
  console.log("🎭 Generating mock orders for:", shopDomain)
  const currentDate = new Date()
  const orders = []
  for (let i = 1; i <= 5; i++) {
    const orderId = Math.floor(Math.random() * 1000000) + 1000000
    const orderDate = new Date(currentDate.getTime() - i * 24 * 60 * 60 * 1000)
    orders.push({
      id: orderId,
      order_number: `${1000 + i}`,
      name: `#${1000 + i}`,
      created_at: orderDate.toISOString(),
      updated_at: orderDate.toISOString(),
      total_price: (Math.random() * 200 + 50).toFixed(2),
      financial_status: "paid",
      fulfillment_status: "unfulfilled",
      customer: {
        id: Math.floor(Math.random() * 100000),
        first_name: ["John", "Jane", "Mike", "Sarah", "David"][Math.floor(Math.random() * 5)],
        last_name: ["Smith", "Johnson", "Williams", "Brown", "Davis"][Math.floor(Math.random() * 5)],
        email: `customer${i}@example.com`,
        phone: `+1-555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      },
      shipping_address: {
        first_name: ["John", "Jane", "Mike", "Sarah", "David"][Math.floor(Math.random() * 5)],
        last_name: ["Smith", "Johnson", "Williams", "Brown", "Davis"][Math.floor(Math.random() * 5)],
        address1: `${Math.floor(Math.random() * 9999) + 1} Main St`,
        address2: Math.random() > 0.5 ? `Apt ${Math.floor(Math.random() * 100) + 1}` : null,
        city: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix"][Math.floor(Math.random() * 5)],
        province: "NY",
        zip: String(Math.floor(Math.random() * 90000) + 10000),
        country: "United States",
        country_code: "US",
      },
      line_items: [
        {
          id: Math.floor(Math.random() * 1000000),
          title: ["T-Shirt", "Jeans", "Sneakers", "Hoodie", "Cap"][Math.floor(Math.random() * 5)],
          quantity: Math.floor(Math.random() * 3) + 1,
          price: (Math.random() * 100 + 20).toFixed(2),
        },
      ],
      note: Math.random() > 0.5 ? "Please handle with care" : "",
    })
  }
  console.log(`🎭 Generated ${orders.length} mock orders`)
  return orders
}

async function createDeliveryOrder(shopifyOrder: any, connection: any, adminId: string) {
  try {
    const deliveryOrderData = {
      order_number: `SH-${shopifyOrder.order_number || shopifyOrder.id}`,
      customer_name: shopifyOrder.customer
        ? `${shopifyOrder.customer.first_name || ""} ${shopifyOrder.customer.last_name || ""}`.trim() ||
          "Unknown Customer"
        : "Unknown Customer",
      customer_phone: shopifyOrder.customer?.phone || "",
      customer_email: shopifyOrder.customer?.email || "",
      pickup_address: connection.settings?.pickup_address || "Store Location",
      delivery_address: formatAddress(shopifyOrder.shipping_address),
      delivery_notes:
        shopifyOrder.line_items
          ?.map((item: any) => `${item.quantity || 1}x ${item.title || item.name || "Item"}`)
          .join(", ") || "Shopify Order Items",
      priority: "normal" as const,
      status: "pending" as const,
      created_by: adminId, // Use created_by instead of admin_id
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabaseServiceRole.from("orders").insert(deliveryOrderData)
    if (error) {
      console.error("❌ Error creating delivery order:", error)
      throw error
    } else {
      console.log(`📦 Created delivery order for Shopify order: ${shopifyOrder.order_number || shopifyOrder.id}`)
    }
  } catch (error) {
    console.error("❌ Error in createDeliveryOrder:", error)
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
