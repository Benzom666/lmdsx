"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/components/ui/use-toast"
import {
  Package,
  Calendar,
  User,
  Phone,
  MapPin,
  Truck,
  FileText,
  CheckCircle,
  Edit,
  UserCheck,
  Trash2,
  MoreHorizontal,
  Printer,
  Download,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { generateAndPrintLabel } from "@/lib/label-utils"
import type { ReactNode } from "react"

interface OrdersListProps {
  orders: any[]
  loading: boolean
  selectedOrders: Set<string>
  onSelectAll: (checked: boolean) => void
  onSelectOrder: (orderId: string, checked: boolean) => void
  allSelected: boolean
  someSelected: boolean
  getStatusBadge: (status: string) => ReactNode
  getPriorityBadge: (priority: string) => ReactNode
  onBulkAssignDriver: (driverId: string) => void
  onBulkDelete: () => void
  router: any
}

export function OrdersList({
  orders,
  loading,
  selectedOrders,
  onSelectAll,
  onSelectOrder,
  allSelected,
  someSelected,
  getStatusBadge,
  getPriorityBadge,
  onBulkAssignDriver,
  onBulkDelete,
  router,
}: OrdersListProps) {
  const { toast } = useToast()

  const handlePrintLabel = async (order: any) => {
    try {
      await generateAndPrintLabel(order)
      toast({
        title: "Success",
        description: "Label sent to printer successfully",
      })
    } catch (error) {
      console.error("Error printing label:", error)
      toast({
        title: "Print Error",
        description: "Failed to print label. Please try again or check your printer settings.",
        variant: "destructive",
      })
    }
  }

  const handleDownloadLabel = async (order: any) => {
    try {
      await generateAndPrintLabel(order, true)
      toast({
        title: "Success",
        description: "Label downloaded successfully",
      })
    } catch (error) {
      console.error("Error downloading label:", error)
      toast({
        title: "Download Error",
        description: "Failed to download label. Please try again.",
        variant: "destructive",
      })
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">Loading orders...</div>
        </CardContent>
      </Card>
    )
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <Package className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No orders found</h3>
            <p className="text-muted-foreground">No orders match your current filters</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Select All Header */}
          <div className="flex items-center gap-3 pb-2 border-b">
            <Checkbox
              checked={allSelected}
              onCheckedChange={onSelectAll}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allSelected
              }}
            />
            <span className="text-sm font-medium">
              {allSelected ? "Deselect All" : someSelected ? "Select All" : "Select All"}
            </span>
            <span className="text-sm text-muted-foreground">({orders.length} orders)</span>
          </div>

          {/* Orders List */}
          <div className="space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex items-start gap-3 p-4 border rounded-lg hover:shadow-md transition-shadow"
              >
                <Checkbox
                  checked={selectedOrders.has(order.id)}
                  onCheckedChange={(checked) => onSelectOrder(order.id, checked as boolean)}
                  className="mt-1"
                />

                <div className="flex-1 space-y-4">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">#{order.order_number}</h3>
                      {getStatusBadge(order.status)}
                      {getPriorityBadge(order.priority)}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {new Date(order.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Order Details */}
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{order.customer_name}</span>
                      </div>
                      {order.customer_phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{order.customer_phone}</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium">Delivery Address</p>
                          <p className="text-sm text-muted-foreground">{order.delivery_address}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Driver</p>
                          <p className="text-sm text-muted-foreground">{order.driver_name || "Unassigned"}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Delivery Notes */}
                  {order.delivery_notes && (
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-sm">
                        <span className="font-medium">Notes:</span> {order.delivery_notes}
                      </p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={() => router.push(`/admin/orders/${order.id}`)}>
                      <FileText className="mr-1 h-3 w-3" />
                      View Details
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`,
                        )
                      }
                    >
                      <MapPin className="mr-1 h-3 w-3" />
                      View Location
                    </Button>

                    {order.status === "delivered" && (
                      <Button variant="outline" size="sm" onClick={() => router.push(`/admin/orders/${order.id}/pod`)}>
                        <CheckCircle className="mr-1 h-3 w-3" />
                        View POD
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => router.push(`/admin/orders/${order.id}`)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onBulkAssignDriver(order.driver_id || "")}>
                          <UserCheck className="mr-2 h-4 w-4" />
                          Assign Driver
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handlePrintLabel(order)}>
                          <Printer className="mr-2 h-4 w-4" />
                          Print Label
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownloadLabel(order)}>
                          <Download className="mr-2 h-4 w-4" />
                          Download Label
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onBulkDelete()} className="text-red-600">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
