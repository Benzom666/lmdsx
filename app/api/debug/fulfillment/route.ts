import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { shopifyFulfillmentSync } from "@/lib/shopify-fulfillment-sync"
import { logError } from "@/lib/error-handler"

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

export async function POST(request: NextRequest) {
  console.log("🔍 Debug fulfillment sync...")

  try {
    const { orderId, force = false } = await request.json()

    if (!orderId) {
      return NextResponse.json({ error: "Order ID or Order Number is required" }, { status: 400 })
    }

    const searchValue = orderId.trim()
    console.log(`🔍 Searching for order: ${searchValue}`)

    // Try to find order by UUID first, then by order number
    let orders = []
    let orderError = null

    // Check if it looks like a UUID (contains hyphens and is 36 chars)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchValue)

    if (isUUID) {
      console.log("🔍 Searching by UUID...")
      const { data, error } = await supabaseServiceRole.from("orders").select("*").eq("id", searchValue)
      orders = data || []
      orderError = error
    } else {
      console.log("🔍 Searching by order number...")
      // Remove # if present and search for order number
      const cleanOrderNumber = searchValue.replace(/^#/, "")
      const { data, error } = await supabaseServiceRole
        .from("orders")
        .select("*")
        .eq("order_number", cleanOrderNumber)
        .order("created_at", { ascending: false })
      orders = data || []
      orderError = error
    }

    if (orderError) {
      console.error("❌ Database error:", orderError)
      return NextResponse.json({ error: "Database error", details: orderError }, { status: 500 })
    }

    if (!orders || orders.length === 0) {
      console.log("🔍 No exact match found, trying broader search...")

      // Try a broader search to help the user
      const { data: similarOrders } = await supabaseServiceRole
        .from("orders")
        .select("id, order_number, status, source, created_at")
        .or(`order_number.ilike.%${searchValue}%`)
        .order("created_at", { ascending: false })
        .limit(10)

      return NextResponse.json(
        {
          error: "Order not found",
          search_value: searchValue,
          search_type: isUUID ? "UUID" : "Order Number",
          similar_orders: similarOrders || [],
          suggestion: "Try using the exact order number (e.g., 1009) or select from similar orders below",
        },
        { status: 404 },
      )
    }

    // If multiple orders found, let user choose
    if (orders.length > 1) {
      console.log(`🔍 Found ${orders.length} orders with the same number`)
      return NextResponse.json({
        error: "Multiple orders found",
        search_value: searchValue,
        multiple_orders: orders.map((order) => ({
          id: order.id,
          order_number: order.order_number,
          status: order.status,
          source: order.source,
          created_at: order.created_at,
          shopify_order_id: order.shopify_order_id,
        })),
        message: "Multiple orders found with this number. Please select the specific order you want to debug.",
      })
    }

    // Single order found
    const order = orders[0]

    console.log("📋 Order found:", {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      source: order.source,
      shopify_order_id: order.shopify_order_id,
      shopify_connection_id: order.shopify_connection_id,
      sync_status: order.sync_status,
      shopify_fulfillment_id: order.shopify_fulfillment_id,
    })

    // Check if this is a Shopify order
    if (order.source !== "shopify" || !order.shopify_order_id) {
      return NextResponse.json({
        error: "This is not a Shopify order",
        order_details: order,
        message: "Only Shopify orders can be fulfilled through this system",
      })
    }

    // Get the Shopify connection
    let connection = null
    if (order.shopify_connection_id) {
      const { data: connectionData, error: connectionError } = await supabaseServiceRole
        .from("shopify_connections")
        .select("*")
        .eq("id", order.shopify_connection_id)
        .single()

      if (connectionError) {
        console.error("❌ Connection error:", connectionError)
      } else {
        connection = connectionData
      }
    }

    // If no connection found via order, try to find an active connection
    if (!connection) {
      console.log("🔍 No connection found via order, searching for active connections...")

      const { data: activeConnections, error: activeError } = await supabaseServiceRole
        .from("shopify_connections")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })

      if (activeError) {
        console.error("❌ Error fetching active connections:", activeError)
        return NextResponse.json({
          error: "Failed to fetch Shopify connections",
          details: activeError,
          order_details: order,
        })
      }

      if (!activeConnections || activeConnections.length === 0) {
        return NextResponse.json({
          error: "No active Shopify connections found",
          order_details: order,
          message: "Please ensure you have an active Shopify connection configured",
        })
      }

      // Use the first active connection
      connection = activeConnections[0]

      // Update the order to link it to this connection
      await supabaseServiceRole.from("orders").update({ shopify_connection_id: connection.id }).eq("id", order.id)

      console.log(`🔗 Linked order ${order.order_number} to connection ${connection.shop_domain}`)
    }

    console.log("🔗 Connection details:", {
      id: connection.id,
      shop_domain: connection.shop_domain,
      is_active: connection.is_active,
      has_access_token: !!connection.access_token,
      access_token_length: connection.access_token?.length || 0,
    })

    // Validate connection
    const validationErrors = []
    if (!connection.is_active) validationErrors.push("Connection is not active")
    if (!connection.access_token) validationErrors.push("Missing access token")
    if (!connection.shop_domain) validationErrors.push("Missing shop domain")

    if (validationErrors.length > 0) {
      return NextResponse.json({
        error: "Connection validation failed",
        validation_errors: validationErrors,
        order_details: order,
        connection_details: connection,
      })
    }

    // Test Shopify API connection first
    console.log("🧪 Testing Shopify API connection...")
    const testResult = await testShopifyConnection(
      connection.shop_domain,
      connection.access_token,
      order.shopify_order_id,
    )

    if (!testResult.success) {
      return NextResponse.json({
        error: "Shopify API test failed",
        test_result: testResult,
        order_details: order,
        connection_details: connection,
      })
    }

    // Try fulfillment
    console.log("🚀 Attempting fulfillment...")
    const fulfillmentResult = await shopifyFulfillmentSync.fulfillShopifyOrder(
      connection.shop_domain,
      connection.access_token,
      order.shopify_order_id,
      order.order_number,
      order.driver_id,
    )

    // Update order based on result
    if (fulfillmentResult.success) {
      await supabaseServiceRole
        .from("orders")
        .update({
          shopify_fulfillment_id: fulfillmentResult.fulfillment_id,
          shopify_fulfilled_at: new Date().toISOString(),
          sync_status: "synced",
        })
        .eq("id", order.id)
    } else {
      await supabaseServiceRole
        .from("orders")
        .update({
          sync_status: "failed",
          sync_error: fulfillmentResult.error,
        })
        .eq("id", order.id)
    }

    return NextResponse.json({
      success: fulfillmentResult.success,
      message: fulfillmentResult.success ? "Fulfillment successful" : "Fulfillment failed",
      test_result: testResult,
      fulfillment_result: fulfillmentResult,
      order_details: order,
      connection_details: connection,
    })
  } catch (error) {
    console.error("❌ Debug fulfillment error:", error)
    logError(error, { endpoint: "debug_fulfillment", orderId: request.body?.orderId })

    return NextResponse.json(
      {
        error: "Debug fulfillment failed",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

async function testShopifyConnection(shopDomain: string, accessToken: string, shopifyOrderId: string) {
  try {
    const cleanDomain = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
    const testUrl = `https://${cleanDomain}/admin/api/2023-10/orders/${shopifyOrderId}.json`

    console.log(`🧪 Testing connection to: ${testUrl}`)

    const response = await fetch(testUrl, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        "User-Agent": "DeliveryOS/1.0",
      },
    })

    const responseText = await response.text()
    console.log(`🧪 Test response status: ${response.status}`)
    console.log(`🧪 Test response: ${responseText.substring(0, 500)}...`)

    if (!response.ok) {
      return {
        success: false,
        error: `API test failed (${response.status})`,
        response_text: responseText,
        url: testUrl,
      }
    }

    const data = JSON.parse(responseText)
    const order = data.order

    if (!order) {
      return {
        success: false,
        error: "Order not found in Shopify",
        response_text: responseText,
      }
    }

    return {
      success: true,
      order_id: order.id,
      order_number: order.order_number || order.name,
      fulfillment_status: order.fulfillment_status,
      financial_status: order.financial_status,
      fulfillments_count: order.fulfillments?.length || 0,
    }
  } catch (error) {
    console.error("🧪 Test connection error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
