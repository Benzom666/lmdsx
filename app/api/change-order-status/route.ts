import { type NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const { orderId, newStatus, driverId, reason, trackingNumber, trackingCompany } = await request.json()

    if (!orderId || !newStatus || !driverId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Get current order details
    const { data: currentOrder, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("driver_id", driverId)
      .single()

    if (fetchError || !currentOrder) {
      return NextResponse.json({ error: "Order not found or access denied" }, { status: 404 })
    }

    // Update order status
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)

    if (updateError) {
      throw updateError
    }

    // Create order update record
    const { error: logError } = await supabase.from("order_updates").insert({
      order_id: orderId,
      driver_id: driverId,
      status: newStatus,
      notes: `Status changed from ${currentOrder.status} to ${newStatus}. Reason: ${reason || "Driver requested status change"}`,
      latitude: null,
      longitude: null,
    })

    if (logError) {
      console.error("Error logging status change:", logError)
      // Don't fail the request if logging fails
    }

    // If changing to delivered status and this is a Shopify order, fulfill it in Shopify
    let shopifyFulfillmentResult = null
    if (newStatus === "delivered" && currentOrder.shopify_order_id && currentOrder.shopify_connection_id) {
      try {
        console.log("🏪 Order delivered - updating Shopify fulfillment")

        const fulfillmentResponse = await fetch("/api/shopify/fulfill-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderId: orderId,
            trackingNumber: trackingNumber || `DEL-${orderId.slice(-8)}`,
            trackingCompany: trackingCompany || "Local Delivery",
            notifyCustomer: true,
          }),
        })

        if (fulfillmentResponse.ok) {
          shopifyFulfillmentResult = await fulfillmentResponse.json()
          console.log("✅ Shopify fulfillment updated successfully")
        } else {
          console.error("❌ Failed to update Shopify fulfillment:", await fulfillmentResponse.text())
        }
      } catch (shopifyError) {
        console.error("❌ Error updating Shopify fulfillment:", shopifyError)
        // Don't fail the main request if Shopify update fails
      }
    }

    // If changing to failed status, handle any existing delivery records
    if (newStatus === "failed" && currentOrder.status === "delivered") {
      // Create a delivery failure record to document the status change
      const { error: failureError } = await supabase.from("delivery_failures").insert({
        order_id: orderId,
        driver_id: driverId,
        failure_reason: "Status correction",
        notes: `Order status corrected from delivered to failed. Original delivery may have been recorded in error.`,
        attempted_delivery: true,
        contacted_customer: false,
        left_at_location: false,
        reschedule_requested: false,
        location: currentOrder.delivery_address,
        photos: JSON.stringify([]),
      })

      if (failureError) {
        console.error("Error creating failure record:", failureError)
      }
    }

    return NextResponse.json({
      success: true,
      message: "Order status updated successfully",
      oldStatus: currentOrder.status,
      newStatus: newStatus,
      shopifyUpdated: shopifyFulfillmentResult?.shopify_updated || false,
      shopifyFulfillmentId: shopifyFulfillmentResult?.fulfillment_id,
    })
  } catch (error) {
    console.error("Error updating order status:", error)
    return NextResponse.json({ error: "Failed to update order status" }, { status: 500 })
  }
}
