import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

export async function GET(request: NextRequest) {
  try {
    console.log("=== DEBUG ORDERS ENDPOINT ===")

    // Check shopify_orders table
    const { data: shopifyOrders, error: shopifyError } = await supabaseServiceRole
      .from("shopify_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)

    // Check orders table
    const { data: deliveryOrders, error: deliveryError } = await supabaseServiceRole
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)

    // Check shopify_connections
    const { data: connections, error: connectionsError } = await supabaseServiceRole
      .from("shopify_connections")
      .select("*")

    return NextResponse.json({
      shopify_orders: {
        count: shopifyOrders?.length || 0,
        data: shopifyOrders || [],
        error: shopifyError?.message || null,
      },
      delivery_orders: {
        count: deliveryOrders?.length || 0,
        data: deliveryOrders || [],
        error: deliveryError?.message || null,
      },
      connections: {
        count: connections?.length || 0,
        data: connections || [],
        error: connectionsError?.message || null,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Debug endpoint error:", error)
    return NextResponse.json(
      {
        error: "Debug failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
