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

export interface ShopifyFulfillmentResult {
  success: boolean
  fulfillment_id?: string
  tracking_number?: string
  error?: string
  details?: string
}

export class ShopifyFulfillmentSync {
  private processingQueue = new Set<string>()

  async queueOrderForFulfillment(orderId: string): Promise<void> {
    try {
      // Get order details with Shopify connection
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
        console.error("❌ Order not found for fulfillment queue:", orderError)
        return
      }

      // Only queue Shopify orders
      if (!order.shopify_order_id || !order.shopify_connections) {
        console.log("ℹ️ Order is not from Shopify, skipping fulfillment queue")
        return
      }

      // Check if connection is active
      if (!order.shopify_connections.is_active) {
        console.log("⚠️ Shopify connection is inactive, skipping fulfillment queue")
        return
      }

      // Add to sync queue
      const { error: queueError } = await supabaseServiceRole.from("shopify_sync_queue").insert({
        order_id: orderId,
        shopify_connection_id: order.shopify_connection_id,
        sync_type: "fulfillment",
        status: "pending",
        scheduled_at: new Date().toISOString(),
        payload: {
          order_number: order.order_number,
          shopify_order_id: order.shopify_order_id,
        },
      })

      if (queueError) {
        console.error("❌ Error queuing fulfillment sync:", queueError)
        throw queueError
      }

      console.log(`📋 Queued fulfillment sync for order ${order.order_number}`)
    } catch (error) {
      console.error("❌ Error in queueOrderForFulfillment:", error)
      logError(error, { orderId, context: "queueOrderForFulfillment" })
    }
  }

  async fulfillShopifyOrder(
    shopDomain: string,
    accessToken: string,
    shopifyOrderId: string,
    orderNumber: string,
    driverId?: string,
  ): Promise<ShopifyFulfillmentResult> {
    const fulfillmentKey = `${shopDomain}-${shopifyOrderId}`

    // Prevent duplicate processing
    if (this.processingQueue.has(fulfillmentKey)) {
      console.log(`⏳ Fulfillment already in progress for ${orderNumber}`)
      return { success: false, error: "Fulfillment already in progress" }
    }

    this.processingQueue.add(fulfillmentKey)

    try {
      console.log(`🏪 Starting Shopify fulfillment for order: ${orderNumber} (${shopifyOrderId})`)
      console.log(`🔧 Shop Domain: ${shopDomain}`)
      console.log(`🔑 Access Token: ${accessToken ? `${accessToken.substring(0, 10)}...` : "MISSING"}`)

      // Step 1: Validate inputs
      if (!shopDomain || !accessToken || !shopifyOrderId) {
        const missing = []
        if (!shopDomain) missing.push("shopDomain")
        if (!accessToken) missing.push("accessToken")
        if (!shopifyOrderId) missing.push("shopifyOrderId")
        throw new Error(`Missing required parameters: ${missing.join(", ")}`)
      }

      // Step 2: Clean shop domain and validate format
      const cleanDomain = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
      if (!cleanDomain.includes(".myshopify.com") && !cleanDomain.includes(".")) {
        throw new Error(`Invalid shop domain format: ${cleanDomain}`)
      }

      console.log(`🌐 Using clean domain: ${cleanDomain}`)

      // Step 3: Check if order exists and get current fulfillment status
      const orderCheckResult = await this.checkOrderStatus(cleanDomain, accessToken, shopifyOrderId)
      if (!orderCheckResult.success) {
        throw new Error(orderCheckResult.error || "Failed to check order status")
      }

      // Step 4: Check if already fulfilled
      if (orderCheckResult.fulfillment_status === "fulfilled") {
        console.log(`ℹ️ Order ${orderNumber} is already fulfilled in Shopify`)
        return {
          success: true,
          fulfillment_id: orderCheckResult.fulfillment_id,
          details: "Order already fulfilled",
        }
      }

      // Step 5: Get driver info for tracking
      let driverName = "DeliveryOS Local Delivery"
      if (driverId) {
        const { data: driver } = await supabaseServiceRole
          .from("user_profiles")
          .select("first_name, last_name, phone")
          .eq("user_id", driverId)
          .single()

        if (driver) {
          driverName = `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || "DeliveryOS Driver"
        }
      }

      // Step 6: Create fulfillment with detailed logging
      const fulfillmentData = {
        fulfillment: {
          location_id: null,
          tracking_number: `DEL-${orderNumber}`,
          tracking_company: "DeliveryOS Local Delivery",
          tracking_url: null,
          notify_customer: true,
          line_items: [],
        },
      }

      console.log(`📦 Creating fulfillment with data:`, JSON.stringify(fulfillmentData, null, 2))

      const fulfillmentUrl = `https://${cleanDomain}/admin/api/2023-10/orders/${shopifyOrderId}/fulfillments.json`
      console.log(`🔗 Fulfillment URL: ${fulfillmentUrl}`)

      const response = await fetch(fulfillmentUrl, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
          "User-Agent": "DeliveryOS/1.0",
          Accept: "application/json",
        },
        body: JSON.stringify(fulfillmentData),
      })

      console.log(`📡 Shopify fulfillment API response status: ${response.status}`)
      console.log(`📡 Response headers:`, Object.fromEntries(response.headers.entries()))

      const responseText = await response.text()
      console.log(`📡 Raw response:`, responseText)

      if (!response.ok) {
        console.error(`❌ Shopify fulfillment API error (${response.status}):`, responseText)

        // Parse error details for better debugging
        let errorDetails = responseText
        try {
          const errorJson = JSON.parse(responseText)
          if (errorJson.errors) {
            errorDetails = JSON.stringify(errorJson.errors, null, 2)
            console.error(`🔍 Parsed errors:`, errorJson.errors)
          }
        } catch (e) {
          console.error(`🔍 Could not parse error response as JSON`)
        }

        throw new Error(`Shopify fulfillment failed (${response.status}): ${errorDetails}`)
      }

      let result
      try {
        result = JSON.parse(responseText)
      } catch (e) {
        throw new Error(`Invalid JSON response from Shopify: ${responseText}`)
      }

      console.log(`✅ Shopify fulfillment created successfully:`, JSON.stringify(result, null, 2))

      // Step 7: Verify fulfillment was created
      if (!result.fulfillment || !result.fulfillment.id) {
        throw new Error("Invalid fulfillment response from Shopify")
      }

      const fulfillmentId = result.fulfillment.id.toString()
      const trackingNumber = result.fulfillment.tracking_number || `DEL-${orderNumber}`

      console.log(`🎉 Successfully fulfilled Shopify order ${orderNumber} with fulfillment ID: ${fulfillmentId}`)

      return {
        success: true,
        fulfillment_id: fulfillmentId,
        tracking_number: trackingNumber,
        details: `Order fulfilled successfully with tracking number: ${trackingNumber}`,
      }
    } catch (error) {
      console.error(`❌ Error fulfilling Shopify order ${orderNumber}:`, error)
      logError(error, { shopDomain, shopifyOrderId, orderNumber, context: "fulfillShopifyOrder" })

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined,
      }
    } finally {
      this.processingQueue.delete(fulfillmentKey)
    }
  }

  private async checkOrderStatus(
    shopDomain: string,
    accessToken: string,
    shopifyOrderId: string,
  ): Promise<{
    success: boolean
    fulfillment_status?: string
    fulfillment_id?: string
    error?: string
  }> {
    try {
      const orderUrl = `https://${shopDomain}/admin/api/2023-10/orders/${shopifyOrderId}.json`
      const response = await fetch(orderUrl, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
          "User-Agent": "DeliveryOS/1.0",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          error: `Failed to check order status (${response.status}): ${errorText}`,
        }
      }

      const data = await response.json()
      const order = data.order

      if (!order) {
        return { success: false, error: "Order not found in response" }
      }

      // Check fulfillment status
      const fulfillmentStatus = order.fulfillment_status || "unfulfilled"
      let fulfillmentId = null

      // Get fulfillment ID if exists
      if (order.fulfillments && order.fulfillments.length > 0) {
        fulfillmentId = order.fulfillments[0].id.toString()
      }

      console.log(`📊 Order ${shopifyOrderId} status: ${fulfillmentStatus}`)

      return {
        success: true,
        fulfillment_status: fulfillmentStatus,
        fulfillment_id: fulfillmentId,
      }
    } catch (error) {
      console.error("❌ Error checking order status:", error)
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  async processQueuedFulfillments(): Promise<void> {
    try {
      // Get pending fulfillment tasks
      const { data: pendingTasks, error } = await supabaseServiceRole
        .from("shopify_sync_queue")
        .select(`
          *,
          orders!inner (
            id,
            order_number,
            status,
            shopify_order_id,
            driver_id,
            completed_at
          ),
          shopify_connections!inner (
            id,
            shop_domain,
            access_token,
            is_active
          )
        `)
        .eq("status", "pending")
        .eq("sync_type", "fulfillment")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(10)

      if (error) {
        console.error("❌ Error fetching pending fulfillment tasks:", error)
        return
      }

      if (!pendingTasks || pendingTasks.length === 0) {
        return
      }

      console.log(`📋 Processing ${pendingTasks.length} pending fulfillment tasks...`)

      for (const task of pendingTasks) {
        await this.processSingleFulfillment(task)
      }
    } catch (error) {
      console.error("❌ Error processing queued fulfillments:", error)
      logError(error, { context: "processQueuedFulfillments" })
    }
  }

  private async processSingleFulfillment(task: any): Promise<void> {
    const { id: taskId, orders: order, shopify_connections: connection } = task

    try {
      // Mark as processing
      await supabaseServiceRole
        .from("shopify_sync_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", taskId)

      // Only process delivered orders
      if (order.status !== "delivered") {
        await supabaseServiceRole
          .from("shopify_sync_queue")
          .update({
            status: "failed",
            error_message: `Order status is ${order.status}, not delivered`,
            processed_at: new Date().toISOString(),
          })
          .eq("id", taskId)
        return
      }

      // Check connection is active
      if (!connection.is_active) {
        await supabaseServiceRole
          .from("shopify_sync_queue")
          .update({
            status: "failed",
            error_message: "Shopify connection is inactive",
            processed_at: new Date().toISOString(),
          })
          .eq("id", taskId)
        return
      }

      // Fulfill the order
      const result = await this.fulfillShopifyOrder(
        connection.shop_domain,
        connection.access_token,
        order.shopify_order_id,
        order.order_number,
        order.driver_id,
      )

      if (result.success) {
        // Update order with fulfillment info
        await supabaseServiceRole
          .from("orders")
          .update({
            shopify_fulfillment_id: result.fulfillment_id,
            shopify_fulfilled_at: new Date().toISOString(),
            sync_status: "synced",
          })
          .eq("id", order.id)

        // Mark task as completed
        await supabaseServiceRole
          .from("shopify_sync_queue")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
            payload: { ...task.payload, result },
          })
          .eq("id", taskId)

        console.log(`✅ Successfully processed fulfillment for order ${order.order_number}`)
      } else {
        // Handle failure with retry logic
        const newAttempts = (task.attempts || 0) + 1
        const maxAttempts = 3

        if (newAttempts >= maxAttempts) {
          await supabaseServiceRole
            .from("shopify_sync_queue")
            .update({
              status: "failed",
              error_message: result.error || "Unknown error",
              attempts: newAttempts,
              processed_at: new Date().toISOString(),
            })
            .eq("id", taskId)

          await supabaseServiceRole.from("orders").update({ sync_status: "failed" }).eq("id", order.id)
        } else {
          // Schedule retry with exponential backoff
          const retryDelay = Math.pow(2, newAttempts) * 60 * 1000 // 2^n minutes
          const scheduledAt = new Date(Date.now() + retryDelay)

          await supabaseServiceRole
            .from("shopify_sync_queue")
            .update({
              status: "pending",
              error_message: result.error || "Unknown error",
              attempts: newAttempts,
              scheduled_at: scheduledAt.toISOString(),
            })
            .eq("id", taskId)
        }

        console.error(`❌ Failed to process fulfillment for order ${order.order_number}: ${result.error}`)
      }
    } catch (error) {
      console.error(`❌ Critical error processing fulfillment task ${taskId}:`, error)

      await supabaseServiceRole
        .from("shopify_sync_queue")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : "Critical error",
          processed_at: new Date().toISOString(),
        })
        .eq("id", taskId)
    }
  }

  async getQueueStatus() {
    const { data, error } = await supabaseServiceRole
      .from("shopify_sync_queue")
      .select("status, sync_type")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours

    if (error) {
      console.error("❌ Error getting queue status:", error)
      return null
    }

    const stats = data.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1
        acc.total++
        return acc
      },
      { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 },
    )

    return stats
  }
}

// Global instance
export const shopifyFulfillmentSync = new ShopifyFulfillmentSync()
