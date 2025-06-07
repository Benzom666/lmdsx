import { type NextRequest, NextResponse } from "next/server"
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"

export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user profile to check role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Only admins and super_admins can manage API keys
    if (!["admin", "super_admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    // Get API keys for the organization
    const { data: apiKeys, error: keysError } = await supabase
      .from("api_keys")
      .select("*")
      .order("created_at", { ascending: false })

    if (keysError) {
      console.error("Error fetching API keys:", keysError)
      return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 })
    }

    return NextResponse.json({ apiKeys })
  } catch (error) {
    console.error("Error in API keys route:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user profile to check role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    // Only admins and super_admins can create API keys
    if (!["admin", "super_admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const { name, permissions } = await request.json()

    if (!name || !permissions || !Array.isArray(permissions)) {
      return NextResponse.json({ error: "Name and permissions are required" }, { status: 400 })
    }

    // Generate a secure API key
    const apiKey = `sk_live_${Math.random().toString(36).substring(2, 18)}${Math.random().toString(36).substring(2, 18)}`

    // Insert the new API key
    const { data: newApiKey, error: insertError } = await supabase
      .from("api_keys")
      .insert({
        name,
        key: apiKey,
        permissions,
        created_by: user.id,
        status: "active",
      })
      .select()
      .single()

    if (insertError) {
      console.error("Error creating API key:", insertError)
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 })
    }

    return NextResponse.json({ apiKey: newApiKey })
  } catch (error) {
    console.error("Error in API keys creation route:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
