"use client"

import { QRCodeSVG } from "qrcode.react"
import { cn } from "@/lib/utils"
import { generateShippingBarcode } from "@/lib/qr-code-generator"
import { useState, useEffect } from "react"

interface ShippingLabelProps {
  order: any
  labelConfig: {
    size: "small" | "medium" | "large"
    theme: "minimal" | "standard" | "branded"
    includeQR: boolean
    includeBarcode: boolean
    fontSize: "small" | "medium" | "large"
    scannerOptimized?: boolean
  }
  className?: string
}

export function ShippingLabel({ order, labelConfig, className }: ShippingLabelProps) {
  const [barcodeDataURL, setBarcodeDataURL] = useState<string>("")

  useEffect(() => {
    if (order?.order_number && labelConfig.includeBarcode) {
      try {
        const barcode = generateShippingBarcode(order.order_number)
        setBarcodeDataURL(barcode)
      } catch (error) {
        console.error("Failed to generate barcode:", error)
        setBarcodeDataURL("")
      }
    }
  }, [order?.order_number, labelConfig.includeBarcode])

  if (!order) {
    return (
      <div className={cn("border rounded-lg p-4 bg-gray-50", className)}>
        <p className="text-center text-muted-foreground">No order data available</p>
      </div>
    )
  }

  const sizeClasses = {
    small: "w-[225px] h-[125px] text-xs",
    medium: "w-[400px] h-[300px] text-sm",
    large: "w-[400px] h-[600px] text-base",
  }

  const fontSizeClasses = {
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
  }

  const qrData = JSON.stringify({
    orderId: order.id,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    deliveryAddress: order.delivery_address,
    trackingUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://example.com"}/track/${order.order_number}`,
  })

  return (
    <div
      className={cn(
        "border-2 border-black bg-white p-4 font-mono print:border-black print:bg-white",
        sizeClasses[labelConfig.size],
        fontSizeClasses[labelConfig.fontSize],
        className,
      )}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-black pb-2 mb-2">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="font-bold text-lg">SHIPPING LABEL</h1>
              <p className="text-xs">Order: #{order.order_number}</p>
              {labelConfig.scannerOptimized && <p className="text-xs text-green-600">Scanner Optimized</p>}
            </div>
            {labelConfig.includeQR && (
              <div className="flex-shrink-0">
                <QRCodeSVG
                  value={qrData}
                  size={labelConfig.size === "small" ? 40 : 60}
                  level="H"
                  includeMargin={true}
                />
              </div>
            )}
          </div>
        </div>

        {/* From Address */}
        <div className="mb-3">
          <p className="font-bold text-xs mb-1">FROM:</p>
          <div className="text-xs">
            <p>Your Company Name</p>
            <p>123 Business Street</p>
            <p>City, State 12345</p>
          </div>
        </div>

        {/* To Address */}
        <div className="mb-3 flex-grow">
          <p className="font-bold text-xs mb-1">TO:</p>
          <div className="text-xs">
            <p className="font-bold">{order.customer_name}</p>
            <p>{order.delivery_address}</p>
            {order.customer_phone && <p>Phone: {order.customer_phone}</p>}
          </div>
        </div>

        {/* Order Details */}
        <div className="mb-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="font-bold">Priority:</p>
              <p className="uppercase">{order.priority || "NORMAL"}</p>
            </div>
            <div>
              <p className="font-bold">Status:</p>
              <p className="uppercase">{order.status}</p>
            </div>
          </div>
        </div>

        {/* Delivery Notes */}
        {order.delivery_notes && (
          <div className="mb-3">
            <p className="font-bold text-xs">NOTES:</p>
            <p className="text-xs">{order.delivery_notes}</p>
          </div>
        )}

        {/* Enhanced Barcode */}
        {labelConfig.includeBarcode && (
          <div className="mt-auto">
            <div className="border-t border-black pt-2">
              {barcodeDataURL ? (
                <div className="flex flex-col items-center">
                  <img
                    src={barcodeDataURL || "/placeholder.svg"}
                    alt={`Barcode: ${order.order_number}`}
                    className="max-w-full h-auto"
                    style={{
                      imageRendering: "pixelated",
                      filter: "contrast(1.2)", // Enhance contrast for better scanning
                    }}
                  />
                  <p className="text-center text-xs mt-1 font-bold tracking-wider">{order.order_number}</p>
                  {labelConfig.scannerOptimized && (
                    <p className="text-center text-xs text-green-600 mt-1">CODE128 - Scanner Ready</p>
                  )}
                </div>
              ) : (
                <div className="text-center text-xs text-red-600">Barcode generation failed</div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-xs text-center mt-2 pt-2 border-t border-black">
          <p>Generated: {new Date().toLocaleDateString()}</p>
          {labelConfig.scannerOptimized && <p className="text-green-600">Industry Standard Compatible</p>}
        </div>
      </div>
    </div>
  )
}
