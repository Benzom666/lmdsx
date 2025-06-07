import { type NextRequest, NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase" // Ensure this is correctly imported

export async function GET(request: NextRequest) {
  try {
    const supabaseServer = createServerSupabaseClient()

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user profile to check role
    const { data: profile, error: profileError } = await supabaseServer
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single()

    if (profileError || profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch recent Shopify orders for this admin
    const { data: orders, error } = await supabaseServer
      .from("shopify_orders")
      .select(
        `
        *,
        shopify_connections!inner(admin_id)
      `,
      )
      .eq("shopify_connections.admin_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      throw error
    }

    return NextResponse.json({ orders: orders || [] })
  } catch (error) {
    console.error("Error fetching Shopify orders:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
