import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get connection details
    const { data: connection, error } = await supabase.from("shopify_connections").select("*").eq("id", id).single()

    if (error || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Test Shopify API connection
    const shopifyResponse = await fetch(`https://${connection.shop_domain}/admin/api/2023-10/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": connection.access_token,
      },
    })

    if (!shopifyResponse.ok) {
      return NextResponse.json({ error: "Shopify API connection failed" }, { status: 400 })
    }

    const shopData = await shopifyResponse.json()

    return NextResponse.json({
      success: true,
      shop: shopData.shop,
    })
  } catch (error) {
    console.error("Error testing Shopify connection:", error)
    return NextResponse.json({ error: "Connection test failed" }, { status: 500 })
  }
}
