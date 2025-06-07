import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { config } from "@/lib/config"
import { logError, AppError } from "@/lib/error-handler"
import { analytics } from "@/lib/analytics"

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

function verifyShopifyWebhook(body: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac("sha256", secret)
  hmac.update(body, "utf8")
  const calculatedSignature = hmac.digest("base64")

  return crypto.timingSafeEqual(Buffer.from(signature, "base64"), Buffer.from(calculatedSignature, "base64"))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get("x-shopify-hmac-sha256")
    const topic = request.headers.get("x-shopify-topic")
    const shopDomain = request.headers.get("x-shopify-shop-domain")

    if (!signature || !topic || !shopDomain) {
      throw new AppError("Missing required Shopify headers", 400)
    }

    // Verify webhook signature in production
    if (config.features.enableErrorReporting) {
      const isValid = verifyShopifyWebhook(body, signature, config.webhooks.shopify.secret)
      if (!isValid) {
        analytics.track("webhook_verification_failed", { shop: shopDomain, topic })
        throw new AppError("Invalid webhook signature", 401)
      }
    }

    const data = JSON.parse(body)

    analytics.track("webhook_received", { shop: shopDomain, topic })

    // Handle different webhook topics
    switch (topic) {
      case "orders/create":
      case "orders/updated":
        await handleOrderWebhook(data, shopDomain, topic)
        break

      case "orders/cancelled":
        await handleOrderCancellation(data, shopDomain)
        break

      case "orders/fulfilled":
      case "orders/partially_fulfilled":
        await handleOrderFulfillment(data, shopDomain)
        break

      default:
        console.log(`Unhandled webhook topic: ${topic}`)
    }

    analytics.track("webhook_processed", { shop: shopDomain, topic })

    return NextResponse.json({ success: true, processed: topic })
  } catch (error) {
    logError(error, {
      endpoint: "shopify_webhook",
      shop: request.headers.get("x-shopify-shop-domain"),
      topic: request.headers.get("x-shopify-topic"),
    })

    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

async function handleOrderWebhook(order: any, shopDomain: string, topic: string) {
  try {
    // Find the connection for this shop
    const { data: connection, error: connectionError } = await supabaseServiceRole
      .from("shopify_connections")
      .select("*")
      .eq("shop_domain", shopDomain)
      .eq("is_active", true)
      .single()

    if (connectionError || !connection) {
      console.log(`No active connection found for shop: ${shopDomain}`)
      return
    }

    // Check if order already exists
    const { data: existingOrder } = await supabaseServiceRole
      .from("shopify_orders")
      .select("id")
      .eq("shopify_order_id", order.id.toString())
      .eq("shopify_connection_id", connection.id)
      .single()

    const orderData = {
      shopify_connection_id: connection.id,
      shopify_order_id: order.id.toString(),
      order_number: order.order_number || order.name || `#${order.id}`,
      customer_name: order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim() || "Unknown Customer"
        : "Unknown Customer",
      customer_email: order.customer?.email || "",
      customer_phone: order.customer?.phone || "",
      shipping_address: order.shipping_address || {},
      line_items: order.line_items || [],
      total_price: Number.parseFloat(order.total_price || "0.00"),
      fulfillment_status: order.fulfillment_status || "unfulfilled",
      financial_status: order.financial_status || "pending",
      created_at: order.created_at || new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }

    if (existingOrder) {
      // Update existing order
      await supabaseServiceRole.from("shopify_orders").update(orderData).eq("id", existingOrder.id)
    } else {
      // Insert new order
      await supabaseServiceRole.rpc("insert_shopify_order", {
        p_data: orderData,
      })

      // Auto-create delivery order if enabled
      if (connection.settings?.auto_create_orders && order.shipping_address) {
        await createDeliveryOrderFromWebhook(order, connection)
      }
    }

    analytics.track("shopify_order_synced", {
      shop: shopDomain,
      order_id: order.id,
      action: existingOrder ? "updated" : "created",
    })
  } catch (error) {
    logError(error, { shop: shopDomain, order_id: order.id })
    throw error
  }
}

async function handleOrderCancellation(order: any, shopDomain: string) {
  try {
    const { error } = await supabaseServiceRole
      .from("shopify_orders")
      .update({
        fulfillment_status: "cancelled",
        synced_at: new Date().toISOString(),
      })
      .eq("shopify_order_id", order.id.toString())

    if (error) {
      throw error
    }

    analytics.track("shopify_order_cancelled", {
      shop: shopDomain,
      order_id: order.id,
    })
  } catch (error) {
    logError(error, { shop: shopDomain, order_id: order.id, action: "cancel" })
    throw error
  }
}

async function handleOrderFulfillment(order: any, shopDomain: string) {
  try {
    const { error } = await supabaseServiceRole
      .from("shopify_orders")
      .update({
        fulfillment_status: "fulfilled",
        synced_at: new Date().toISOString(),
      })
      .eq("shopify_order_id", order.id.toString())

    if (error) {
      throw error
    }

    analytics.track("shopify_order_fulfilled", {
      shop: shopDomain,
      order_id: order.id,
    })
  } catch (error) {
    logError(error, { shop: shopDomain, order_id: order.id, action: "fulfill" })
    throw error
  }
}

async function createDeliveryOrderFromWebhook(shopifyOrder: any, connection: any) {
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
      created_by: connection.admin_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabaseServiceRole.from("orders").insert(deliveryOrderData)
    if (error) {
      throw error
    }

    analytics.track("delivery_order_auto_created", {
      shopify_order_id: shopifyOrder.id,
      delivery_order_number: deliveryOrderData.order_number,
    })
  } catch (error) {
    logError(error, { shopify_order_id: shopifyOrder.id, action: "auto_create_delivery" })
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
