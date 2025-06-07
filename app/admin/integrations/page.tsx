"use client"

import { useState, useEffect } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Key,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Play,
  RefreshCw,
  ExternalLink,
  Zap,
  Shield,
  Database,
  Webhook,
  Settings,
  BookOpen,
  TestTube,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react"

interface ApiKey {
  id: string
  name: string
  key: string
  permissions: string[]
  created_at: string
  last_used: string | null
  status: "active" | "inactive"
}

interface TestResult {
  endpoint: string
  status: "success" | "error" | "pending"
  response?: any
  error?: string
  duration?: number
}

export default function IntegrationsPage() {
  const { toast } = useToast()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<TestResult[]>([])
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  // New API Key Dialog State
  const [newKeyDialog, setNewKeyDialog] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([])

  // Test Configuration State
  const [testConfig, setTestConfig] = useState({
    apiKey: "",
    endpoint: "/api/deliveries",
    method: "GET",
    payload: "",
  })

  const availableApis = [
    {
      id: "orders",
      name: "Orders API",
      description: "Manage orders, assignments, and status updates",
      icon: <Database className="w-6 h-6" />,
      endpoints: [
        { method: "GET", path: "/api/orders", description: "List all orders" },
        { method: "POST", path: "/api/assign-order", description: "Assign order to driver" },
        { method: "PUT", path: "/api/change-order-status", description: "Update order status" },
      ],
      status: "active",
    },
    {
      id: "deliveries",
      name: "Deliveries API",
      description: "Track deliveries and manage delivery operations",
      icon: <Zap className="w-6 h-6" />,
      endpoints: [
        { method: "GET", path: "/api/deliveries", description: "Get delivery information" },
        { method: "POST", path: "/api/delivery-failure", description: "Report delivery failure" },
        { method: "POST", path: "/api/validate-scan", description: "Validate QR code scans" },
      ],
      status: "active",
    },
    {
      id: "users",
      name: "User Management API",
      description: "Manage drivers, admins, and user accounts",
      icon: <Shield className="w-6 h-6" />,
      endpoints: [
        { method: "POST", path: "/api/create-driver", description: "Create new driver" },
        { method: "POST", path: "/api/create-admin", description: "Create new admin" },
        { method: "PUT", path: "/api/suspend-user", description: "Suspend/activate user" },
      ],
      status: "active",
    },
    {
      id: "webhooks",
      name: "Webhooks API",
      description: "Real-time notifications for order and delivery events",
      icon: <Webhook className="w-6 h-6" />,
      endpoints: [
        { method: "POST", path: "/api/webhooks/register", description: "Register webhook endpoint" },
        { method: "GET", path: "/api/webhooks", description: "List registered webhooks" },
        { method: "DELETE", path: "/api/webhooks/:id", description: "Remove webhook" },
      ],
      status: "beta",
    },
  ]

  const integrationScenarios = [
    {
      title: "E-commerce Integration",
      description: "Connect your online store to automatically create delivery orders",
      difficulty: "Beginner",
      steps: [
        "Generate API key with orders permissions",
        "Configure webhook for order creation",
        "Implement order sync endpoint",
        "Test with sample orders",
      ],
      codeExample: `// Create order from e-commerce platform
const response = await fetch('/api/assign-order', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    orderId: 'ECOM_ORDER_123',
    customerInfo: {
      name: 'John Doe',
      address: '123 Main St',
      phone: '+1234567890'
    },
    items: [
      { name: 'Product A', quantity: 2 }
    ]
  })
});`,
    },
    {
      title: "Mobile App Integration",
      description: "Build a mobile app for customers to track their deliveries",
      difficulty: "Intermediate",
      steps: [
        "Set up API key with delivery tracking permissions",
        "Implement real-time tracking using webhooks",
        "Add push notifications for status updates",
        "Test delivery flow end-to-end",
      ],
      codeExample: `// Track delivery status
const trackDelivery = async (orderId) => {
  const response = await fetch(\`/api/deliveries?orderId=\${orderId}\`, {
    headers: {
      'Authorization': 'Bearer YOUR_API_KEY'
    }
  });
  
  const delivery = await response.json();
  return delivery;
};`,
    },
    {
      title: "Warehouse Management System",
      description: "Integrate with WMS for automated order processing",
      difficulty: "Advanced",
      steps: [
        "Configure API keys for full system access",
        "Set up bidirectional webhooks",
        "Implement inventory sync",
        "Add automated driver assignment",
      ],
      codeExample: `// Automated order processing
const processWarehouseOrder = async (warehouseOrder) => {
  // Create delivery order
  const orderResponse = await createDeliveryOrder(warehouseOrder);
  
  // Auto-assign to available driver
  const assignResponse = await autoAssignDriver(orderResponse.orderId);
  
  // Update warehouse system
  await updateWarehouseStatus(warehouseOrder.id, 'assigned');
  
  return assignResponse;
};`,
    },
  ]

  const permissions = [
    { id: "orders:read", label: "Read Orders", description: "View order information" },
    { id: "orders:write", label: "Manage Orders", description: "Create and update orders" },
    { id: "deliveries:read", label: "Read Deliveries", description: "View delivery information" },
    { id: "deliveries:write", label: "Manage Deliveries", description: "Update delivery status" },
    { id: "users:read", label: "Read Users", description: "View user information" },
    { id: "users:write", label: "Manage Users", description: "Create and manage users" },
    { id: "webhooks:manage", label: "Manage Webhooks", description: "Configure webhook endpoints" },
  ]

  useEffect(() => {
    loadApiKeys()
  }, [])

  const loadApiKeys = async () => {
    setLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const mockKeys: ApiKey[] = [
        {
          id: "key_1",
          name: "E-commerce Integration",
          key: "sk_live_1234567890abcdef",
          permissions: ["orders:read", "orders:write"],
          created_at: "2024-01-15T10:30:00Z",
          last_used: "2024-01-20T14:22:00Z",
          status: "active",
        },
        {
          id: "key_2",
          name: "Mobile App",
          key: "sk_live_abcdef1234567890",
          permissions: ["deliveries:read", "orders:read"],
          created_at: "2024-01-10T09:15:00Z",
          last_used: null,
          status: "inactive",
        },
      ]

      setApiKeys(mockKeys)
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load API keys",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const generateApiKey = async () => {
    if (!newKeyName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the API key",
        variant: "destructive",
      })
      return
    }

    if (newKeyPermissions.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one permission",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const newKey: ApiKey = {
        id: `key_${Date.now()}`,
        name: newKeyName,
        key: `sk_live_${Math.random().toString(36).substring(2, 18)}`,
        permissions: newKeyPermissions,
        created_at: new Date().toISOString(),
        last_used: null,
        status: "active",
      }

      setApiKeys([...apiKeys, newKey])
      setNewKeyDialog(false)
      setNewKeyName("")
      setNewKeyPermissions([])

      toast({
        title: "Success",
        description: "API key generated successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate API key",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const deleteApiKey = async (keyId: string) => {
    setLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      setApiKeys(apiKeys.filter((key) => key.id !== keyId))

      toast({
        title: "Success",
        description: "API key deleted successfully",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete API key",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const toggleKeyVisibility = (keyId: string) => {
    const newVisibleKeys = new Set(visibleKeys)
    if (newVisibleKeys.has(keyId)) {
      newVisibleKeys.delete(keyId)
    } else {
      newVisibleKeys.add(keyId)
    }
    setVisibleKeys(newVisibleKeys)
  }

  const copyToClipboard = async (text: string, keyId: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(keyId)
      setTimeout(() => setCopiedKey(null), 2000)

      toast({
        title: "Copied",
        description: "API key copied to clipboard",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      })
    }
  }

  const testApiConnection = async () => {
    if (!testConfig.apiKey) {
      toast({
        title: "Error",
        description: "Please enter an API key",
        variant: "destructive",
      })
      return
    }

    setIsTestingConnection(true)
    const startTime = Date.now()

    const newResult: TestResult = {
      endpoint: testConfig.endpoint,
      status: "pending",
    }

    setTestResults([newResult, ...testResults.slice(0, 4)])

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const duration = Date.now() - startTime
      const mockResponse = {
        success: true,
        data: { message: "API connection successful", timestamp: new Date().toISOString() },
        meta: { total: 42, page: 1 },
      }

      const updatedResult: TestResult = {
        endpoint: testConfig.endpoint,
        status: "success",
        response: mockResponse,
        duration,
      }

      setTestResults([updatedResult, ...testResults.slice(1)])

      toast({
        title: "Success",
        description: `API test completed successfully in ${duration}ms`,
      })
    } catch (error) {
      const duration = Date.now() - startTime
      const updatedResult: TestResult = {
        endpoint: testConfig.endpoint,
        status: "error",
        error: "Connection failed: Invalid API key or endpoint",
        duration,
      }

      setTestResults([updatedResult, ...testResults.slice(1)])

      toast({
        title: "Error",
        description: "API test failed",
        variant: "destructive",
      })
    } finally {
      setIsTestingConnection(false)
    }
  }

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-500 animate-spin" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />
    }
  }

  const maskApiKey = (key: string) => {
    return `${key.substring(0, 8)}${"*".repeat(16)}${key.substring(key.length - 4)}`
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">API Integrations</h1>
            <p className="text-muted-foreground">
              Manage API keys, test connections, and integrate with external systems
            </p>
          </div>
          <Dialog open={newKeyDialog} onOpenChange={setNewKeyDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Generate API Key
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Generate New API Key</DialogTitle>
                <DialogDescription>
                  Create a new API key with specific permissions for your integration.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="keyName">Key Name</Label>
                  <Input
                    id="keyName"
                    placeholder="e.g., E-commerce Integration"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Permissions</Label>
                  <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                    {permissions.map((permission) => (
                      <div key={permission.id} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={permission.id}
                          checked={newKeyPermissions.includes(permission.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewKeyPermissions([...newKeyPermissions, permission.id])
                            } else {
                              setNewKeyPermissions(newKeyPermissions.filter((p) => p !== permission.id))
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                        <div className="flex-1">
                          <Label htmlFor={permission.id} className="text-sm font-medium">
                            {permission.label}
                          </Label>
                          <p className="text-xs text-muted-foreground">{permission.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewKeyDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={generateApiKey} disabled={loading}>
                  {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                  Generate Key
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="api-keys">API Keys</TabsTrigger>
            <TabsTrigger value="testing">Testing</TabsTrigger>
            <TabsTrigger value="documentation">Documentation</TabsTrigger>
            <TabsTrigger value="scenarios">Integration Guides</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Key className="h-8 w-8 text-blue-500" />
                    <div>
                      <p className="text-2xl font-bold">{apiKeys.length}</p>
                      <p className="text-sm text-muted-foreground">API Keys</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Database className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold">{availableApis.length}</p>
                      <p className="text-sm text-muted-foreground">Available APIs</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold">{testResults.filter((r) => r.status === "success").length}</p>
                      <p className="text-sm text-muted-foreground">Successful Tests</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center space-x-2">
                    <Zap className="h-8 w-8 text-purple-500" />
                    <div>
                      <p className="text-2xl font-bold">{integrationScenarios.length}</p>
                      <p className="text-sm text-muted-foreground">Integration Guides</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Available APIs</CardTitle>
                  <CardDescription>APIs ready for integration</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {availableApis.map((api) => (
                    <div key={api.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        {api.icon}
                        <div>
                          <h4 className="font-medium">{api.name}</h4>
                          <p className="text-sm text-muted-foreground">{api.description}</p>
                        </div>
                      </div>
                      <Badge variant={api.status === "active" ? "default" : "secondary"}>{api.status}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Recent Test Results</CardTitle>
                  <CardDescription>Latest API connection tests</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {testResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No tests run yet. Use the Testing tab to validate your API connections.
                    </p>
                  ) : (
                    testResults.slice(0, 5).map((result, index) => (
                      <div key={index} className="flex items-center justify-between p-2 border rounded">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(result.status)}
                          <span className="text-sm font-mono">{result.endpoint}</span>
                        </div>
                        {result.duration && <span className="text-xs text-muted-foreground">{result.duration}ms</span>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="api-keys" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>API Keys Management</CardTitle>
                <CardDescription>
                  Generate and manage API keys for secure access to your delivery system
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading && apiKeys.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                    Loading API keys...
                  </div>
                ) : apiKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <Key className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">No API Keys</h3>
                    <p className="text-muted-foreground mb-4">
                      Generate your first API key to start integrating with external systems.
                    </p>
                    <Button onClick={() => setNewKeyDialog(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Generate API Key
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {apiKeys.map((apiKey) => (
                      <div key={apiKey.id} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-3">
                            <div>
                              <h4 className="font-medium">{apiKey.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                Created {new Date(apiKey.created_at).toLocaleDateString()}
                                {apiKey.last_used && (
                                  <span> • Last used {new Date(apiKey.last_used).toLocaleDateString()}</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant={apiKey.status === "active" ? "default" : "secondary"}>
                              {apiKey.status}
                            </Badge>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this API key? This action cannot be undone and will
                                    immediately revoke access for any applications using this key.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteApiKey(apiKey.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <Label className="text-sm font-medium">API Key</Label>
                            <div className="flex items-center space-x-2 mt-1">
                              <Input
                                value={visibleKeys.has(apiKey.id) ? apiKey.key : maskApiKey(apiKey.key)}
                                readOnly
                                className="font-mono text-sm"
                              />
                              <Button variant="outline" size="sm" onClick={() => toggleKeyVisibility(apiKey.id)}>
                                {visibleKeys.has(apiKey.id) ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => copyToClipboard(apiKey.key, apiKey.id)}
                              >
                                {copiedKey === apiKey.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>

                          <div>
                            <Label className="text-sm font-medium">Permissions</Label>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {apiKey.permissions.map((permission) => (
                                <Badge key={permission} variant="outline" className="text-xs">
                                  {permission}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="testing" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>API Connection Tester</CardTitle>
                  <CardDescription>Test your API keys and validate connections</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="testApiKey">API Key</Label>
                    <Select
                      value={testConfig.apiKey}
                      onValueChange={(value) => setTestConfig({ ...testConfig, apiKey: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an API key" />
                      </SelectTrigger>
                      <SelectContent>
                        {apiKeys.map((key) => (
                          <SelectItem key={key.id} value={key.key}>
                            {key.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="testEndpoint">Endpoint</Label>
                    <Select
                      value={testConfig.endpoint}
                      onValueChange={(value) => setTestConfig({ ...testConfig, endpoint: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableApis.flatMap((api) =>
                          api.endpoints.map((endpoint) => (
                            <SelectItem key={endpoint.path} value={endpoint.path}>
                              {endpoint.method} {endpoint.path}
                            </SelectItem>
                          )),
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="testMethod">Method</Label>
                    <Select
                      value={testConfig.method}
                      onValueChange={(value) => setTestConfig({ ...testConfig, method: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(testConfig.method === "POST" || testConfig.method === "PUT") && (
                    <div className="space-y-2">
                      <Label htmlFor="testPayload">Request Payload (JSON)</Label>
                      <Textarea
                        id="testPayload"
                        placeholder='{"key": "value"}'
                        value={testConfig.payload}
                        onChange={(e) => setTestConfig({ ...testConfig, payload: e.target.value })}
                        rows={4}
                      />
                    </div>
                  )}

                  <Button onClick={testApiConnection} disabled={isTestingConnection} className="w-full">
                    {isTestingConnection ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {isTestingConnection ? "Testing..." : "Test Connection"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Test Results</CardTitle>
                  <CardDescription>Recent API test results and responses</CardDescription>
                </CardHeader>
                <CardContent>
                  {testResults.length === 0 ? (
                    <div className="text-center py-8">
                      <TestTube className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-muted-foreground">No tests run yet</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {testResults.map((result, index) => (
                        <div key={index} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(result.status)}
                              <span className="font-mono text-sm">{result.endpoint}</span>
                            </div>
                            {result.duration && (
                              <span className="text-xs text-muted-foreground">{result.duration}ms</span>
                            )}
                          </div>

                          {result.response && (
                            <div className="mt-2">
                              <Label className="text-xs text-muted-foreground">Response</Label>
                              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                                {JSON.stringify(result.response, null, 2)}
                              </pre>
                            </div>
                          )}

                          {result.error && (
                            <div className="mt-2">
                              <Label className="text-xs text-red-600">Error</Label>
                              <p className="text-xs text-red-600 bg-red-50 p-2 rounded mt-1">{result.error}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="documentation" className="space-y-4">
            <div className="grid grid-cols-1 gap-6">
              {availableApis.map((api) => (
                <Card key={api.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {api.icon}
                        <div>
                          <CardTitle>{api.name}</CardTitle>
                          <CardDescription>{api.description}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={api.status === "active" ? "default" : "secondary"}>{api.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <h4 className="font-medium">Available Endpoints</h4>
                      <div className="space-y-2">
                        {api.endpoints.map((endpoint, index) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                            <div className="flex items-center space-x-3">
                              <Badge
                                variant="outline"
                                className={
                                  endpoint.method === "GET"
                                    ? "border-green-500 text-green-600"
                                    : endpoint.method === "POST"
                                      ? "border-blue-500 text-blue-600"
                                      : endpoint.method === "PUT"
                                        ? "border-yellow-500 text-yellow-600"
                                        : "border-red-500 text-red-600"
                                }
                              >
                                {endpoint.method}
                              </Badge>
                              <code className="text-sm">{endpoint.path}</code>
                            </div>
                            <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Authentication</CardTitle>
                <CardDescription>How to authenticate your API requests</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Authorization Header</h4>
                  <code className="text-sm">Authorization: Bearer YOUR_API_KEY</code>
                </div>

                <div className="bg-muted p-4 rounded-lg">
                  <h4 className="font-medium mb-2">Example Request</h4>
                  <pre className="text-sm overflow-x-auto">
                    {`curl -X GET "https://your-domain.com/api/deliveries" \\
  -H "Authorization: Bearer sk_live_1234567890abcdef" \\
  -H "Content-Type: application/json"`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scenarios" className="space-y-4">
            <div className="grid grid-cols-1 gap-6">
              {integrationScenarios.map((scenario, index) => (
                <Card key={index}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{scenario.title}</CardTitle>
                        <CardDescription>{scenario.description}</CardDescription>
                      </div>
                      <Badge
                        variant={
                          scenario.difficulty === "Beginner"
                            ? "default"
                            : scenario.difficulty === "Intermediate"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {scenario.difficulty}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Implementation Steps</h4>
                      <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                        {scenario.steps.map((step, stepIndex) => (
                          <li key={stepIndex}>{step}</li>
                        ))}
                      </ol>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Code Example</h4>
                      <div className="bg-muted p-4 rounded-lg">
                        <pre className="text-sm overflow-x-auto">
                          <code>{scenario.codeExample}</code>
                        </pre>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Need Help?</CardTitle>
                <CardDescription>Additional resources and support</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button variant="outline" className="h-auto p-4 flex flex-col items-center space-y-2">
                    <BookOpen className="h-6 w-6" />
                    <span>Full Documentation</span>
                  </Button>
                  <Button variant="outline" className="h-auto p-4 flex flex-col items-center space-y-2">
                    <ExternalLink className="h-6 w-6" />
                    <span>API Reference</span>
                  </Button>
                  <Button variant="outline" className="h-auto p-4 flex flex-col items-center space-y-2">
                    <Settings className="h-6 w-6" />
                    <span>Contact Support</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
