"use client"

import { Menu } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

type MainNavItem = {
  href: string
  label: string
  enabled?: boolean
}

interface MainNavigationProps {
  active: "bestpreissuche" | "urlaubsfinder" | "direktverbindungen"
  showUrlaubsfinder?: boolean
  variant?: "desktop" | "mobile"
}

export function MainNavigation({ active, showUrlaubsfinder = true, variant = "desktop" }: MainNavigationProps) {
  const items: MainNavItem[] = [
    { href: "/", label: "Bestpreissuche" },
    { href: "/urlaubsfinder", label: "Urlaubsfinder", enabled: showUrlaubsfinder },
    { href: "/direktverbindungen", label: "Direktverbindungen" },
  ].filter(item => item.enabled !== false)

  const activeItem = items.find(item => {
    if (active === "bestpreissuche") return item.href === "/"
    return item.href.includes(active)
  }) ?? items[0]

  return (
    <nav>
      {variant === "desktop" ? (
      <div className="hidden flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 sm:flex">
        {items.map(item => {
          const isActive = item.href === activeItem.href
          return (
            <a
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-white text-blue-700 shadow-sm ring-1 ring-gray-200"
                  : "text-gray-600 hover:bg-white/80 hover:text-blue-700"
              }`}
            >
              {item.label}
            </a>
          )
        })}
      </div>
      ) : (
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 border-gray-300 bg-white text-gray-700"
              aria-label="Navigation öffnen"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {items.map(item => {
              const isActive = item.href === activeItem.href
              return (
                <DropdownMenuItem key={item.href} asChild>
                  <a
                    href={item.href}
                    className={`cursor-pointer ${isActive ? "font-semibold text-blue-700" : ""}`}
                  >
                    {item.label}
                  </a>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      )}
    </nav>
  )
}
