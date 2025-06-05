"use client"

import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Home, Package, QrCode, User } from "lucide-react"

interface BottomNavigationProps {
  className?: string
}

export function BottomNavigation({ className }: BottomNavigationProps) {
  const pathname = usePathname()
  const router = useRouter()

  const navigationItems = [
    {
      name: "Home",
      href: "/driver/orders",
      icon: Home,
      badge: null,
    },
    {
      name: "Scanner",
      href: "/driver/scanner",
      icon: QrCode,
      badge: null,
    },
    {
      name: "Orders",
      href: "/driver/orders",
      icon: Package,
      badge: "3", // This could be dynamic based on active orders
    },
    {
      name: "Profile",
      href: "/driver/profile",
      icon: User,
      badge: null,
    },
  ]

  const handleNavigation = (href: string) => {
    router.push(href)
  }

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 dark:bg-gray-900 dark:border-gray-700",
        "safe-area-pb", // For devices with home indicators
        className,
      )}
    >
      <div className="grid grid-cols-4 h-16 max-w-lg mx-auto">
        {navigationItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href === "/driver/orders" && (pathname === "/driver/home" || pathname.startsWith("/driver/orders")))

          return (
            <button
              key={item.name}
              onClick={() => handleNavigation(item.href)}
              className={cn(
                "flex flex-col items-center justify-center px-2 py-2 text-xs font-medium transition-colors",
                "hover:bg-gray-50 dark:hover:bg-gray-800",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400",
              )}
            >
              <div className="relative">
                <item.icon
                  className={cn(
                    "h-6 w-6 mb-1",
                    isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400",
                  )}
                />
                {item.badge && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center text-xs p-0 min-w-[20px]"
                  >
                    {item.badge}
                  </Badge>
                )}
              </div>
              <span
                className={cn(
                  "text-xs leading-none",
                  isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400",
                )}
              >
                {item.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
