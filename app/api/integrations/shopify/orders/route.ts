import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

export async function GET(request: NextRequest) {
  console.log("=== FETCHING SHOPIFY ORDERS ===")

  try {
    // Get the session from the request headers for authentication
    const authHeader = request.headers.get("authorization")
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
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      console.log("❌ Authentication failed")
      return NextResponse.json({ error: "Invalid authentication" }, { status: 401 })
    }

    console.log("✅ User authenticated:", user.id)

    // Verify user is an admin
    const { data: userProfile, error: profileError } = await supabaseServiceRole
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (profileError || !userProfile || userProfile.role !== "admin") {
      console.log("❌ User is not admin")
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    // Get all Shopify connections for this admin
    const { data: connections, error: connectionsError } = await supabaseServiceRole
      .from("shopify_connections")
      .select("id")
      .eq("admin_id", user.id)
      .eq("is_active", true)

    if (connectionsError) {
      console.error("❌ Error fetching connections:", connectionsError)
      return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 })
    }

    if (!connections || connections.length === 0) {
      console.log("ℹ️ No active Shopify connections found")
      return NextResponse.json({ orders: [] })
    }

    const connectionIds = connections.map((conn) => conn.id)
    console.log("🔍 Fetching orders for connections:", connectionIds)

    // Fetch Shopify orders from all connections
    const { data: shopifyOrders, error: ordersError } = await supabaseServiceRole
      .from("shopify_orders")
      .select("*")
      .in("shopify_connection_id", connectionIds)
      .order("created_at", { ascending: false })
      .limit(50)

    if (ordersError) {
      console.error("❌ Error fetching Shopify orders:", ordersError)
      return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 })
    }

    console.log(`✅ Found ${shopifyOrders?.length || 0} Shopify orders`)

    return NextResponse.json({
      orders: shopifyOrders || [],
      total: shopifyOrders?.length || 0,
    })
  } catch (error) {
    console.error("💥 Error in Shopify orders endpoint:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch Shopify orders",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
