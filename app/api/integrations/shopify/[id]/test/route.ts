import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get connection details
    const { data: connection, error: connectionError } = await supabase
      .from("shopify_connections")
      .select("*")
      .eq("id", id)
      .single()

    if (connectionError || !connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Validate connection details
    if (!connection.shop_domain || !connection.access_token) {
      return NextResponse.json({ error: "Invalid connection configuration" }, { status: 400 })
    }

    console.log(`Testing connection to shop: ${connection.shop_domain}`)

    // Test connection to Shopify API with a simple shop info request
    try {
      const testUrl = `https://${connection.shop_domain}/admin/api/2023-10/shop.json`
      console.log(`Testing with URL: ${testUrl}`)

      // Create an AbortController for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout for test

      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": connection.access_token,
          "Content-Type": "application/json",
          "User-Agent": "DeliverySystem/1.0",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log(`Test response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Shopify test error: ${response.status} - ${errorText}`)

        if (response.status === 401) {
          return NextResponse.json({ error: "Invalid access token" }, { status: 401 })
        } else if (response.status === 403) {
          return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
        } else if (response.status === 404) {
          return NextResponse.json({ error: "Store not found" }, { status: 404 })
        } else {
          return NextResponse.json(
            {
              error: `Shopify API error: ${response.status}`,
              details: errorText,
            },
            { status: 400 },
          )
        }
      }

      const shopData = await response.json()
      console.log(`Test successful for shop: ${shopData.shop?.name || connection.shop_domain}`)

      return NextResponse.json({
        success: true,
        shop_name: shopData.shop?.name || "Unknown",
        shop_domain: shopData.shop?.domain || connection.shop_domain,
        message: "Connection test successful",
      })
    } catch (fetchError) {
      console.error("Network error testing Shopify connection:", fetchError)

      // Handle different types of fetch errors
      if (fetchError instanceof Error) {
        if (fetchError.name === "AbortError") {
          return NextResponse.json(
            { error: "Connection timeout - Shopify API took too long to respond" },
            { status: 408 },
          )
        } else if (fetchError.message.includes("ENOTFOUND") || fetchError.message.includes("DNS")) {
          return NextResponse.json(
            { error: "Cannot resolve shop domain. Please check the domain format (e.g., your-store.myshopify.com)" },
            { status: 400 },
          )
        } else if (fetchError.message.includes("ECONNREFUSED")) {
          return NextResponse.json(
            { error: "Connection refused. Please check your store configuration." },
            { status: 400 },
          )
        } else if (fetchError.message.includes("certificate") || fetchError.message.includes("SSL")) {
          return NextResponse.json({ error: "SSL certificate error. Please check your connection." }, { status: 400 })
        }
      }

      return NextResponse.json(
        {
          error: "Failed to connect to Shopify",
          details: fetchError instanceof Error ? fetchError.message : "Network error",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Error testing Shopify connection:", error)
    return NextResponse.json(
      {
        error: "Failed to test connection",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
