import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTimeWindow(abfahrtAb?: string, ankunftBis?: string): string {
  if (!abfahrtAb && !ankunftBis) return "beliebig"
  return `${abfahrtAb || "beliebig"}-${ankunftBis || "beliebig"}`
}

export function getVehicleTypeStyle(produktGattung?: string) {
  switch (produktGattung) {
    case "ICE":
      return { color: "text-red-600", bg: "bg-red-50", border: "border-red-200" }
    case "EC_IC":
    case "IC":
    case "EC":
      return { color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" }
    case "IR":
    case "REGIONAL":
      return { color: "text-green-600", bg: "bg-green-50", border: "border-green-200" }
    case "SBAHN":
      return { color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" }
    case "BUS":
      return { color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" }
    default:
      return { color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" }
  }
}

export function formatDateDE(iso: string): string {
  if (!iso) return "–"
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Europe/Berlin",
    })
  } catch {
    return "–"
  }
}
