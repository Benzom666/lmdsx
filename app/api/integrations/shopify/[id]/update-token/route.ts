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

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { access_token } = await request.json()

    if (!access_token || !access_token.startsWith("shpat_")) {
      return NextResponse.json({ error: "Invalid access token. Must start with 'shpat_'" }, { status: 400 })
    }

    // Update the connection with the new access token
    const { data, error } = await supabaseServiceRole
      .from("shopify_connections")
      .update({
        access_token,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select()
      .single()

    if (error) {
      console.error("❌ Failed to update access token:", error)
      return NextResponse.json({ error: "Failed to update access token", details: error }, { status: 500 })
    }

    // Verify the token was saved
    const { data: verification } = await supabaseServiceRole
      .from("shopify_connections")
      .select("access_token")
      .eq("id", params.id)
      .single()

    console.log("✅ Token verification:", verification?.access_token ? "Token saved successfully" : "Token not found")

    // Test the connection with the new token
    const testUrl = `https://${data.shop_domain}/admin/api/2023-10/shop.json`

    try {
      const testResponse = await fetch(testUrl, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": access_token,
          "Content-Type": "application/json",
          "User-Agent": "DeliveryOS/1.0",
        },
      })

      if (!testResponse.ok) {
        return NextResponse.json({
          success: false,
          message: "Access token updated but connection test failed",
          test_error: `HTTP ${testResponse.status}`,
          connection: data,
          token_length: access_token.length,
        })
      }

      return NextResponse.json({
        success: true,
        message: "Access token updated and connection test successful",
        connection: data,
        token_length: access_token.length,
      })
    } catch (testError) {
      return NextResponse.json({
        success: false,
        message: "Access token updated but connection test failed",
        test_error: testError instanceof Error ? testError.message : "Unknown error",
        connection: data,
        token_length: access_token.length,
      })
    }
  } catch (error) {
    console.error("❌ Update token error:", error)
    return NextResponse.json(
      {
        error: "Failed to update access token",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
