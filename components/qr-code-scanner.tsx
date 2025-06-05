"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { Camera, QrCode, Smartphone, RefreshCw, Check, X, Search } from "lucide-react"
import { useRouter } from "next/navigation"

interface QRCodeScannerProps {
  onScan?: (data: any) => void
  redirectToOrder?: boolean
}

export function QRCodeScanner({ onScan, redirectToOrder = true }: QRCodeScannerProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("camera")
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState("")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [lastScannedData, setLastScannedData] = useState<any | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start camera when tab changes to camera
  useEffect(() => {
    if (activeTab === "camera") {
      startCamera()
    } else {
      stopCamera()
    }

    return () => {
      stopCamera()
    }
  }, [activeTab])

  const startCamera = async () => {
    try {
      setCameraError(null)
      setScanning(true)

      // Try to get the back camera on mobile devices
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()

        // Start scanning for QR codes
        requestAnimationFrame(scanQRCode)
      }
    } catch (error) {
      console.error("Error accessing camera:", error)
      setCameraError("Could not access camera. Please check permissions.")
      setScanning(false)
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      const tracks = streamRef.current.getTracks()
      tracks.forEach((track) => track.stop())
      streamRef.current = null
    }
    setScanning(false)
  }

  const scanQRCode = () => {
    if (!scanning || !videoRef.current || !canvasRef.current) {
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const context = canvas.getContext("2d")

    if (context && video.readyState === video.HAVE_ENOUGH_DATA) {
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      // Draw video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      // In a real implementation, we would use a QR code scanning library
      // like jsQR to detect and decode QR codes from the canvas
      // For this example, we'll simulate finding a QR code after a few seconds

      // Simulate QR code detection (in real app, use jsQR or similar)
      if (Math.random() < 0.005) {
        // Small chance to "detect" a QR code
        const simulatedData = {
          orderId: "ord_" + Math.random().toString(36).substring(2, 10),
          orderNumber: "ORD-" + Math.floor(1000 + Math.random() * 9000),
          customerName: "John Doe",
          deliveryAddress: "123 Main St, Anytown, USA",
          customerPhone: "+1 (555) 123-4567",
          priority: Math.random() > 0.7 ? "high" : "normal",
          createdAt: new Date().toISOString(),
        }

        handleSuccessfulScan(simulatedData)
        return
      }
    }

    // Continue scanning
    requestAnimationFrame(scanQRCode)
  }

  const handleSuccessfulScan = (data: any) => {
    // Stop scanning
    setScanning(false)
    setLastScannedData(data)

    // Play success sound
    const audio = new Audio("/sounds/beep-success.mp3")
    audio.play().catch((e) => console.log("Audio play failed:", e))

    // Show success toast
    toast({
      title: "QR Code Scanned",
      description: `Order #${data.orderNumber} detected`,
    })

    // Call onScan callback if provided
    if (onScan) {
      onScan(data)
    }

    // Redirect to order page if enabled
    if (redirectToOrder) {
      setTimeout(() => {
        router.push(`/driver/orders/${data.orderId}`)
      }, 1500)
    }
  }

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!manualCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter an order number or tracking code",
        variant: "destructive",
      })
      return
    }

    // Simulate finding the order
    const simulatedData = {
      orderId: "ord_" + Math.random().toString(36).substring(2, 10),
      orderNumber: manualCode.toUpperCase(),
      customerName: "John Doe",
      deliveryAddress: "123 Main St, Anytown, USA",
      customerPhone: "+1 (555) 123-4567",
      priority: "normal",
      createdAt: new Date().toISOString(),
    }

    handleSuccessfulScan(simulatedData)
  }

  const resetScanner = () => {
    setLastScannedData(null)
    setManualCode("")
    if (activeTab === "camera") {
      startCamera()
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center">
          <QrCode className="mr-2 h-5 w-5" />
          QR Code Scanner
        </CardTitle>
        <CardDescription>Scan a shipping label QR code or enter the order number manually</CardDescription>
      </CardHeader>
      <CardContent>
        {lastScannedData ? (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-md p-4 flex items-center">
              <Check className="h-6 w-6 text-green-600 mr-2" />
              <div>
                <p className="font-medium text-green-800">Successfully Scanned</p>
                <p className="text-sm text-green-700">Order #{lastScannedData.orderNumber}</p>
              </div>
            </div>

            <div className="space-y-3 mt-4">
              <div>
                <Label className="text-sm font-medium">Customer</Label>
                <p className="text-sm">{lastScannedData.customerName}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Delivery Address</Label>
                <p className="text-sm">{lastScannedData.deliveryAddress}</p>
              </div>
              <div>
                <Label className="text-sm font-medium">Priority</Label>
                <p className="text-sm">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      lastScannedData.priority === "high" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {lastScannedData.priority}
                  </span>
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="camera">
                <Camera className="mr-2 h-4 w-4" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="manual">
                <Smartphone className="mr-2 h-4 w-4" />
                Manual Entry
              </TabsTrigger>
            </TabsList>

            <TabsContent value="camera" className="space-y-4">
              <div className="relative aspect-video bg-black rounded-md overflow-hidden">
                {cameraError ? (
                  <div className="absolute inset-0 flex items-center justify-center text-white bg-black bg-opacity-80 p-4 text-center">
                    <div>
                      <X className="h-8 w-8 mx-auto mb-2 text-red-500" />
                      <p>{cameraError}</p>
                      <Button
                        variant="outline"
                        className="mt-4 bg-white text-black hover:bg-gray-100"
                        onClick={startCamera}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Retry
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="border-2 border-white border-opacity-50 rounded-lg w-3/4 h-3/4 flex items-center justify-center">
                        <QrCode className="h-12 w-12 text-white opacity-50" />
                      </div>
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                  </>
                )}
              </div>

              <p className="text-sm text-center text-muted-foreground">Position the QR code within the frame to scan</p>
            </TabsContent>

            <TabsContent value="manual">
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orderNumber">Order Number or Tracking Code</Label>
                  <Input
                    id="orderNumber"
                    placeholder="e.g. ORD-1234 or TRACK-5678"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                  />
                </div>

                <Button type="submit" className="w-full">
                  <Search className="mr-2 h-4 w-4" />
                  Find Order
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        {lastScannedData ? (
          <>
            <Button variant="outline" onClick={resetScanner}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Scan Another
            </Button>
            <Button onClick={() => router.push(`/driver/orders/${lastScannedData.orderId}`)}>View Order Details</Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground w-full text-center">
            Scan a QR code from a shipping label to view order details
          </p>
        )}
      </CardFooter>
    </Card>
  )
}
