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
  console.log("🚚 Driver completing order...")

  try {
    const { orderId, driverId, completionData } = await request.json()

    if (!orderId || !driverId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Verify the driver is assigned to this order
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
      .eq("driver_id", driverId)
      .single()

    if (orderError || !order) {
      console.error("❌ Order not found or not assigned to driver:", orderError)
      return NextResponse.json({ error: "Order not found or not assigned to you" }, { status: 404 })
    }

    // Update the order status to delivered
    const updateData = {
      status: "delivered",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...completionData, // Include photos, notes, signature, etc.
    }

    const { error: updateError } = await supabaseServiceRole.from("orders").update(updateData).eq("id", orderId)

    if (updateError) {
      console.error("❌ Error updating order:", updateError)
      return NextResponse.json({ error: "Failed to update order" }, { status: 500 })
    }

    console.log(`✅ Order ${order.order_number} marked as delivered by driver`)

    // If this is a Shopify order, automatically update fulfillment
    let shopifyResult = null
    if (order.shopify_order_id && order.shopify_connections) {
      const connection = order.shopify_connections

      if (connection.is_active && connection.access_token) {
        try {
          shopifyResult = await updateShopifyFulfillment(
            connection.shop_domain,
            connection.access_token,
            order.shopify_order_id,
            order.order_number,
            driverId,
          )

          // Update our record with fulfillment info
          await supabaseServiceRole
            .from("orders")
            .update({
              shopify_fulfillment_id: shopifyResult.fulfillment_id,
              shopify_fulfilled_at: new Date().toISOString(),
            })
            .eq("id", orderId)

          console.log(`🏪 Shopify fulfillment updated for order: ${order.order_number}`)
        } catch (shopifyError) {
          console.error("⚠️ Failed to update Shopify fulfillment:", shopifyError)
          // Don't fail the entire request if Shopify update fails
          shopifyResult = { error: shopifyError.message }
        }
      }
    }

    // Send notifications
    await Promise.all([
      sendDriverCompletionNotification(order, driverId),
      sendAdminCompletionNotification(order, driverId),
    ])

    return NextResponse.json({
      success: true,
      message: "Order completed successfully",
      order: {
        id: order.id,
        order_number: order.order_number,
        status: "delivered",
        completed_at: updateData.completed_at,
      },
      shopify_updated: !!shopifyResult && !shopifyResult.error,
      shopify_result: shopifyResult,
    })
  } catch (error) {
    console.error("❌ Error completing order:", error)
    logError(error, { endpoint: "driver_complete_order" })

    return NextResponse.json(
      {
        error: "Failed to complete order",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

async function updateShopifyFulfillment(
  shopDomain: string,
  accessToken: string,
  shopifyOrderId: string,
  orderNumber: string,
  driverId: string,
): Promise<{ fulfillment_id: string }> {
  console.log(`🏪 Updating Shopify fulfillment for order: ${shopifyOrderId}`)

  // Get driver info for tracking
  const { data: driver } = await supabaseServiceRole
    .from("user_profiles")
    .select("first_name, last_name, phone")
    .eq("user_id", driverId)
    .single()

  const driverName = driver ? `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "Driver" : "Driver"

  const fulfillmentData = {
    fulfillment: {
      location_id: null,
      tracking_number: `DEL-${orderNumber}`,
      tracking_company: "Local Delivery Service",
      tracking_url: null,
      notify_customer: true,
      line_items: [], // Empty array fulfills all items
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

async function sendDriverCompletionNotification(order: any, driverId: string) {
  try {
    const notificationData = {
      user_id: driverId,
      title: "Delivery Completed",
      message: `You have successfully completed delivery for order ${order.order_number}`,
      type: "success",
      read: false,
      created_at: new Date().toISOString(),
    }

    await supabaseServiceRole.from("notifications").insert(notificationData)
    console.log(`🔔 Sent completion notification to driver: ${driverId}`)
  } catch (error) {
    console.error("❌ Error sending driver notification:", error)
  }
}

async function sendAdminCompletionNotification(order: any, driverId: string) {
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
      title: "Order Delivered",
      message: `Order ${order.order_number} has been successfully delivered by ${driverName}${order.shopify_order_id ? " and Shopify has been updated" : ""}`,
      type: "success",
      read: false,
      created_at: new Date().toISOString(),
    }

    await supabaseServiceRole.from("notifications").insert(notificationData)
    console.log(`🔔 Sent completion notification to admin: ${order.created_by}`)
  } catch (error) {
    console.error("❌ Error sending admin notification:", error)
  }
}
