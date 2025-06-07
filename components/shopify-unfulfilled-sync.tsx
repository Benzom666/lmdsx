"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/components/ui/use-toast"
import { RefreshCw, Package, CheckCircle, AlertTriangle } from "lucide-react"

interface ShopifyUnfulfilledSyncProps {
  connectionId: string
  shopDomain: string
  onSyncComplete?: () => void
}

export function ShopifyUnfulfilledSync({ connectionId, shopDomain, onSyncComplete }: ShopifyUnfulfilledSyncProps) {
  const { toast } = useToast()
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [syncResult, setSyncResult] = useState<any>(null)

  const syncUnfulfilledOrders = async () => {
    setSyncing(true)
    setProgress(10)
    setSyncResult(null)

    try {
      // Get auth headers for the request
      const {
        data: { session },
      } = await (window as any).supabase.auth.getSession()

      if (!session) {
        throw new Error("Authentication required")
      }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      }

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval)
            return 90
          }
          return prev + 10
        })
      }, 500)

      // Call the sync-unfulfilled endpoint
      const response = await fetch(`/api/integrations/shopify/${connectionId}/sync-unfulfilled`, {
        method: "POST",
        headers,
      })

      clearInterval(progressInterval)
      setProgress(100)

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || error.details || "Failed to sync unfulfilled orders")
      }

      const result = await response.json()
      setSyncResult(result)

      toast({
        title: "Sync Completed",
        description: result.message || `Successfully synced ${result.synced_count} unfulfilled orders`,
      })

      if (onSyncComplete) {
        onSyncComplete()
      }
    } catch (error) {
      console.error("Error syncing unfulfilled orders:", error)
      toast({
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Failed to sync unfulfilled orders",
        variant: "destructive",
      })
      setSyncResult({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Unfulfilled Orders Sync
        </CardTitle>
        <CardDescription>
          Sync only unfulfilled orders from {shopDomain} and create delivery orders ready for assignment
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {syncing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Syncing unfulfilled orders...</span>
                <span className="text-sm font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          ) : syncResult ? (
            <div className={`p-4 rounded-lg ${syncResult.success ? "bg-green-50" : "bg-red-50"}`}>
              <div className="flex items-start gap-3">
                {syncResult.success ? (
                  <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                )}
                <div>
                  <h4 className={`font-medium ${syncResult.success ? "text-green-800" : "text-red-800"}`}>
                    {syncResult.success ? "Sync Completed" : "Sync Failed"}
                  </h4>
                  <p className={`text-sm ${syncResult.success ? "text-green-700" : "text-red-700"}`}>
                    {syncResult.message || syncResult.error || "Unknown result"}
                  </p>
                  {syncResult.success && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
                          {syncResult.synced_count} orders synced
                        </Badge>
                        {syncResult.delivery_orders_created > 0 && (
                          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                            {syncResult.delivery_orders_created} delivery orders created
                          </Badge>
                        )}
                        {syncResult.error_count > 0 && (
                          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                            {syncResult.error_count} errors
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Data source: {syncResult.data_source === "shopify_api" ? "Shopify API" : "Demo Data"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm">
                This will sync only <strong>unfulfilled orders</strong> from Shopify and automatically create delivery
                orders ready for assignment.
              </p>
            </div>
            <Button onClick={syncUnfulfilledOrders} disabled={syncing}>
              {syncing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Unfulfilled Orders
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
