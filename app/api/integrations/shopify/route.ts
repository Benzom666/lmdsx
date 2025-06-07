import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET() {
  try {
    const { data: connections, error } = await supabase
      .from("shopify_connections")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json({ connections: connections || [] })
  } catch (error) {
    console.error("Error fetching Shopify connections:", error)
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { shop_domain, access_token, webhook_secret } = body

    if (!shop_domain || !access_token) {
      return NextResponse.json({ error: "Shop domain and access token are required" }, { status: 400 })
    }

    // Validate Shopify connection
    const shopifyResponse = await fetch(`https://${shop_domain}/admin/api/2023-10/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": access_token,
      },
    })

    if (!shopifyResponse.ok) {
      return NextResponse.json({ error: "Invalid Shopify credentials" }, { status: 400 })
    }

    const shopData = await shopifyResponse.json()

    // Save connection to database
    const { data: connection, error } = await supabase
      .from("shopify_connections")
      .insert({
        shop_domain,
        access_token,
        webhook_secret,
        is_active: true,
        last_sync: new Date().toISOString(),
        orders_synced: 0,
        settings: {
          auto_create_orders: true,
          auto_assign_drivers: false,
          sync_order_status: true,
          notification_emails: [],
          fulfillment_service: false,
        },
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ connection })
  } catch (error) {
    console.error("Error creating Shopify connection:", error)
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 })
  }
}
