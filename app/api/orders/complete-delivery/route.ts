import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
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
  console.log("📦 Processing delivery completion...")

  try {
    const { orderId, driverId, completionData } = await request.json()

    if (!orderId || !driverId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Get order details including Shopify connection info
    const { data: order, error: orderError } = await supabaseServiceRole
      .from("orders")
      .select(`
        *,
        shopify_connections!shopify_connection_id (
          id,
          shop_domain,
          access_token,
          is_active,
          settings
        )
      `)
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      console.error("❌ Error fetching order:", orderError)
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    // Update the delivery order status
    const { error: updateError } = await supabaseServiceRole
      .from("orders")
      .update({
        status: "delivered",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...completionData, // Include any additional completion data (photos, notes, etc.)
      })
      .eq("id", orderId)

    if (updateError) {
      console.error("❌ Error updating order:", updateError)
      return NextResponse.json({ error: "Failed to update order" }, { status: 500 })
    }

    console.log(`✅ Marked delivery order ${order.order_number} as completed`)

    // If this is a Shopify order, update fulfillment status
    let shopifyUpdated = false
    let fulfillmentResult = null

    if (order.shopify_order_id && order.shopify_connections) {
      const connection = order.shopify_connections

      if (connection.is_active && connection.access_token) {
        try {
          fulfillmentResult = await fulfillShopifyOrder(
            connection.shop_domain,
            connection.access_token,
            order.shopify_order_id,
            order.order_number,
            driverId,
          )
          shopifyUpdated = true

          // Update our record with fulfillment info
          await supabaseServiceRole
            .from("orders")
            .update({
              shopify_fulfillment_id: fulfillmentResult.fulfillment_id,
              shopify_fulfilled_at: new Date().toISOString(),
            })
            .eq("id", orderId)

          console.log(`✅ Updated Shopify fulfillment for order: ${order.order_number}`)
        } catch (shopifyError) {
          console.error("❌ Failed to update Shopify fulfillment:", shopifyError)
          // Don't fail the entire request if Shopify update fails
        }
      }
    }

    // Send notification to admin
    await sendCompletionNotification(order, driverId)

    return NextResponse.json({
      success: true,
      message: "Delivery completed successfully",
      shopify_updated: shopifyUpdated,
      fulfillment_result: fulfillmentResult,
    })
  } catch (error) {
    console.error("❌ Error completing delivery:", error)
    logError(error, { endpoint: "complete_delivery", order_id: request.body?.orderId })

    return NextResponse.json(
      {
        error: "Failed to complete delivery",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function fulfillShopifyOrder(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  orderNumber: string,
  driverId: string,
): Promise<{ fulfillment_id: string }> {
  console.log(`🏪 Fulfilling Shopify order: ${shopifyOrderId} on ${shopDomain}`)

  // Get driver info for tracking
  const { data: driver } = await supabaseServiceRole
    .from("user_profiles")
    .select("first_name, last_name")
    .eq("user_id", driverId)
    .single()

  const driverName = driver ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "Driver" : "Driver"

  const fulfillmentData = {
    fulfillment: {
      location_id: null, // Shopify will use the first location
      tracking_number: `DEL-${orderNumber}`,
      tracking_company: "Local Delivery Service",
      tracking_url: null,
      notify_customer: true,
      line_items: [], // Empty array means fulfill all items
    },
  }

  const response = await fetch(`https://${shopDomain}/admin/api/2023-10/orders/${shopifyOrderId}/fulfillments.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fulfillmentData),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("❌ Shopify fulfillment error:", response.status, errorText)
    throw new Error(`Shopify fulfillment failed: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  console.log(`✅ Shopify fulfillment created: ${result.fulfillment.id}`)

  return {
    fulfillment_id: result.fulfillment.id.toString(),
  }
}

async function sendCompletionNotification(order: any, driverId: string) {
  try {
    // Get driver info
    const { data: driver } = await supabaseServiceRole
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("user_id", driverId)
      .single()

    const driverName = driver ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "Driver" : "Driver"

    const notificationData = {
      user_id: order.created_by,
      title: "Delivery Completed",
      message: `Order ${order.order_number} has been delivered by ${driverName}`,
      type: "success",
      read: false,
      created_at: new Date().toISOString(),
    }

    await supabaseServiceRole.from("notifications").insert(notificationData)
    console.log(`🔔 Sent completion notification for order: ${order.order_number}`)
  } catch (error) {
    console.error("❌ Error sending completion notification:", error)
  }
}
