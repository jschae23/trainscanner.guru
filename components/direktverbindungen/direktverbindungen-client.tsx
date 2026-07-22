"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownAZ, ArrowDownUp, ArrowRight, CalendarDays, Clock, Database, Filter, Info, Loader2, MapPin, Search, Train, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  DirectConnectionsMap,
  type DirectConnectionResult,
  type DirectStation,
} from "@/components/direktverbindungen/direct-connections-map"
import { Footer } from "@/components/layout/footer"
import { BrandLogo } from "@/components/layout/brand-logo"
import { MainNavigation } from "@/components/layout/main-navigation"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { logError } from "@/lib/shared/logger"

const LOG_SCOPE = "direktverbindungen.client"

type ProductFilter = "all" | "longDistance" | "regional"
type ResultSort = "duration" | "name" | "product" | "frequency"
type MaxDurationFilter = "all" | "120" | "240" | "480" | "720"
type MinTripsFilter = "all" | "1" | "3" | "5" | "10" | "20"
type SortDirection = "asc" | "desc"

interface DirectConnectionsData {
  schemaVersion: number
  source: string
  generatedAt: string
  version: string
  stations: DirectStation[]
  edges: Array<Array<{
    to: number
    time: number
    typicalTime?: number
    tripsPerDay?: number
    tripCount?: number
    firstDeparture?: string | null
    lastDeparture?: string | null
    lines?: string[]
    products: string[]
  }>>
}

interface DirectConnectionDetailDeparture {
  departure: string
  arrival: string
  duration: number
  line?: string | null
  product: "longDistance" | "regional"
}

interface DirectConnectionDetailDay {
  date: string
  departures: DirectConnectionDetailDeparture[]
}

interface DirectConnectionDetails {
  from: string
  to: string
  generatedAt: string
  version: string
  horizonStart: string | null
  horizonEnd: string | null
  days: DirectConnectionDetailDay[]
  summary: {
    dayCount: number
    departureCount: number
  }
}

type DetailLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: DirectConnectionDetails }
  | { status: "error"; error: string }

interface DirektverbindungenClientProps {
  showFooter?: boolean
}

const ctrl =
  "h-11 w-full min-w-0 max-w-full box-border px-3 text-base leading-tight rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function scoreStation(station: DirectStation, query: string): number {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length < 2) return -1

  const names = [station.name, ...(station.altNames ?? [])]
  let bestScore = -1

  for (const name of names) {
    const candidate = normalize(name)
    if (candidate === normalizedQuery) bestScore = Math.max(bestScore, 1000)
    else if (candidate.startsWith(normalizedQuery)) bestScore = Math.max(bestScore, 700 - candidate.length)
    else if (candidate.includes(normalizedQuery)) bestScore = Math.max(bestScore, 400 - candidate.indexOf(normalizedQuery))
    else {
      let queryIndex = 0
      let fuzzyScore = 0
      for (let i = 0; i < candidate.length && queryIndex < normalizedQuery.length; i++) {
        if (candidate[i] === normalizedQuery[queryIndex]) {
          fuzzyScore += i === 0 || candidate[i - 1] === " " ? 3 : 1
          queryIndex += 1
        }
      }
      if (queryIndex === normalizedQuery.length) bestScore = Math.max(bestScore, fuzzyScore)
    }
  }

  return bestScore
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function formatTripsPerDay(value?: number): string {
  if (value === undefined || value === null) return "unbekannt"
  if (value < 1) return "<1 Fahrt/Tag"
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",")
  return `${rounded} Fahrten/Tag`
}

function formatGeneratedAt(value?: string): string {
  if (!value) return "unbekannt"
  try {
    return new Date(value).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  } catch {
    return "unbekannt"
  }
}

function productLabel(products: string[]): string {
  if (products.includes("longDistance") && products.includes("regional")) {
    return "Fern- und Nahverkehr"
  }
  if (products.includes("longDistance")) return "Fernverkehr"
  return "Nahverkehr"
}

function productClasses(products: string[]): string {
  if (products.includes("longDistance") && products.includes("regional")) {
    return "border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
  }
  if (products.includes("longDistance")) {
    return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300"
  }
  return "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
}

function formatDateChip(value: string): string {
  try {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    })
  } catch {
    return value
  }
}

function productDotClasses(product: "longDistance" | "regional"): string {
  return product === "longDistance" ? "bg-red-500" : "bg-emerald-500"
}

export default function DirektverbindungenClient({ showFooter = false }: DirektverbindungenClientProps) {
  const [data, setData] = useState<DirectConnectionsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedStation, setSelectedStation] = useState<DirectStation | null>(null)
  const [productFilter, setProductFilter] = useState<ProductFilter>("all")
  const [maxDuration, setMaxDuration] = useState<MaxDurationFilter>("all")
  const [minTripsPerDay, setMinTripsPerDay] = useState<MinTripsFilter>("all")
  const [resultSort, setResultSort] = useState<ResultSort>("duration")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [showDurationOverlay, setShowDurationOverlay] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedStationId, setHighlightedStationId] = useState<string | null>(null)
  const [resultQuery, setResultQuery] = useState("")
  const [expandedConnectionId, setExpandedConnectionId] = useState<string | null>(null)
  const [detailsByConnection, setDetailsByConnection] = useState<Record<string, DetailLoadState>>({})
  const [expandedDetailDays, setExpandedDetailDays] = useState<Record<string, boolean>>({})
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        setIsLoading(true)
        const response = await fetch("/api/direct-connections", { cache: "no-store" })
        if (!response.ok) {
          throw new Error("Die Direktverbindungsdaten sind aktuell nicht verfügbar.")
        }
        const nextData = await response.json()
        if (cancelled) return
        setData(nextData)

        const stationFromUrl = new URLSearchParams(window.location.search).get("station")
        if (stationFromUrl) {
          const station = nextData.stations.find((item: DirectStation) => item.id === stationFromUrl)
          if (station) {
            setSelectedStation(station)
            setQuery(station.name)
          }
        }
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : "Direktverbindungsdaten konnten nicht geladen werden.")
        logError(LOG_SCOPE, "Could not load direct connection data", loadError)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadData()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const suggestions = useMemo(() => {
    if (!data || query.trim().length < 2) return []

    return data.stations
      .map(station => ({ station, score: scoreStation(station, query) }))
      .filter(item => item.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const edgeDiff = (data.edges[data.stations.indexOf(b.station)]?.length ?? 0) - (data.edges[data.stations.indexOf(a.station)]?.length ?? 0)
        if (edgeDiff !== 0) return edgeDiff
        return a.station.name.localeCompare(b.station.name, "de")
      })
      .slice(0, 10)
      .map(item => item.station)
  }, [data, query])

  const selectedStationIndex = useMemo(() => {
    if (!data || !selectedStation) return -1
    return data.stations.findIndex(station => station.id === selectedStation.id)
  }, [data, selectedStation])

  const connections = useMemo<DirectConnectionResult[]>(() => {
    if (!data || selectedStationIndex < 0) return []

    const filteredConnections = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))
      .map(edge => ({
        station: data.stations[edge.to],
        time: edge.time,
        typicalTime: edge.typicalTime,
        tripsPerDay: edge.tripsPerDay,
        firstDeparture: edge.firstDeparture,
        lastDeparture: edge.lastDeparture,
        lines: edge.lines,
        products: edge.products,
      }))
      .filter(connection => !!connection.station)
      .filter(connection => {
        const trimmedQuery = normalize(resultQuery)
        if (!trimmedQuery) return true
        return normalize([
          connection.station.name,
          ...(connection.station.altNames ?? []),
          ...(connection.lines ?? []),
        ].join(" ")).includes(trimmedQuery)
      })

    const sortedConnections = filteredConnections.sort((a, b) => {
      if (resultSort === "name") {
        return a.station.name.localeCompare(b.station.name, "de") || a.time - b.time
      }
      if (resultSort === "product") {
        const productA = productLabel(a.products)
        const productB = productLabel(b.products)
        return productA.localeCompare(productB, "de") || a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
      }
      if (resultSort === "frequency") {
        return (a.tripsPerDay ?? 0) - (b.tripsPerDay ?? 0) || a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
      }
      return a.time - b.time || a.station.name.localeCompare(b.station.name, "de")
    })

    return sortDirection === "asc" ? sortedConnections : sortedConnections.reverse()
  }, [data, selectedStationIndex, productFilter, maxDuration, minTripsPerDay, resultQuery, resultSort, sortDirection])

  const productCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, longDistance: 0, regional: 0 }
    }

    const edges = data.edges[selectedStationIndex] ?? []
    const durationFilteredEdges = edges
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))
    return {
      all: durationFilteredEdges.length,
      longDistance: durationFilteredEdges.filter(edge => edge.products.includes("longDistance")).length,
      regional: durationFilteredEdges.filter(edge => edge.products.includes("regional")).length,
    }
  }, [data, selectedStationIndex, maxDuration, minTripsPerDay])

  const durationCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, "120": 0, "240": 0, "480": 0, "720": 0 }
    }

    const edges = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => minTripsPerDay === "all" || (edge.tripsPerDay ?? 0) >= Number(minTripsPerDay))

    return {
      all: edges.length,
      "120": edges.filter(edge => edge.time <= 120).length,
      "240": edges.filter(edge => edge.time <= 240).length,
      "480": edges.filter(edge => edge.time <= 480).length,
      "720": edges.filter(edge => edge.time <= 720).length,
    }
  }, [data, selectedStationIndex, productFilter, minTripsPerDay])

  const tripFrequencyCounts = useMemo(() => {
    if (!data || selectedStationIndex < 0) {
      return { all: 0, "1": 0, "3": 0, "5": 0, "10": 0, "20": 0 }
    }

    const edges = (data.edges[selectedStationIndex] ?? [])
      .filter(edge => productFilter === "all" || edge.products.includes(productFilter))
      .filter(edge => maxDuration === "all" || edge.time <= Number(maxDuration))

    return {
      all: edges.length,
      "1": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 1).length,
      "3": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 3).length,
      "5": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 5).length,
      "10": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 10).length,
      "20": edges.filter(edge => (edge.tripsPerDay ?? 0) >= 20).length,
    }
  }, [data, selectedStationIndex, productFilter, maxDuration])

  const selectStation = useCallback((station: DirectStation) => {
    setSelectedStation(station)
    setQuery(station.name)
    setShowSuggestions(false)
    setHighlightedStationId(null)
    setExpandedConnectionId(null)
    setExpandedDetailDays({})
    const params = new URLSearchParams(window.location.search)
    params.set("station", station.id)
    window.history.replaceState({}, "", `/direktverbindungen?${params.toString()}`)
  }, [])

  const reset = useCallback(() => {
    setQuery("")
    setSelectedStation(null)
    setHighlightedStationId(null)
    setExpandedConnectionId(null)
    setExpandedDetailDays({})
    setShowSuggestions(false)
    window.history.replaceState({}, "", "/direktverbindungen")
    inputRef.current?.focus()
  }, [])

  const handleSortClick = (sort: ResultSort) => {
    if (resultSort === sort) {
      setSortDirection(direction => direction === "asc" ? "desc" : "asc")
      return
    }

    setResultSort(sort)
    setSortDirection("asc")
  }

  const toggleConnectionDetails = useCallback(async (
    connection: DirectConnectionResult,
    options?: { forceOpen?: boolean }
  ) => {
    if (!selectedStation) return

    const targetId = connection.station.id
    setExpandedConnectionId(previous => options?.forceOpen ? targetId : previous === targetId ? null : targetId)
    setHighlightedStationId(targetId)

    if (detailsByConnection[targetId]?.status) {
      return
    }

    setDetailsByConnection(previous => ({
      ...previous,
      [targetId]: { status: "loading" },
    }))

    try {
      const response = await fetch(
        `/api/direct-connections/details?from=${encodeURIComponent(selectedStation.id)}&to=${encodeURIComponent(targetId)}`,
        { cache: "no-store" }
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Details konnten nicht geladen werden.")
      }

      setDetailsByConnection(previous => ({
        ...previous,
        [targetId]: { status: "loaded", data: payload },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Details konnten nicht geladen werden."
      setDetailsByConnection(previous => ({
        ...previous,
        [targetId]: { status: "error", error: message },
      }))
      logError(LOG_SCOPE, "Could not load direct connection details", error, {
        from: selectedStation.id,
        to: targetId,
      })
    }
  }, [detailsByConnection, selectedStation])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (suggestions[0]) {
      selectStation(suggestions[0])
    }
  }

  const selectedStationConnectionCount = selectedStationIndex >= 0
    ? data?.edges[selectedStationIndex]?.length ?? 0
    : 0

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MainNavigation active="direktverbindungen" variant="mobile" />
              <h1 className="min-w-0">
                <BrandLogo />
              </h1>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <MainNavigation active="direktverbindungen" />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <section className="mb-8">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50 to-gray-100 p-2 shadow-lg sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 sm:text-xl">
                Direktverbindungen
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-4">
                <h3 className="mb-2 flex items-center gap-2 text-md font-semibold text-gray-700 dark:text-gray-300 sm:mb-3">
                  <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Startbahnhof
                </h3>
                <div className="relative">
                  <Label htmlFor="direct-start" className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <Search className="h-4 w-4 text-blue-500" />
                      Von welchem Bahnhof möchtest du starten?
                    </span>
                  </Label>
                  <div className="relative">
                    <Input
                      ref={inputRef}
                      id="direct-start"
                      type="text"
                      value={query}
                      placeholder="z.B. Berlin Hauptbahnhof"
                      autoComplete="off"
                      className={`${ctrl} pr-10`}
                      onChange={event => {
                        setQuery(event.target.value)
                        setShowSuggestions(true)
                      }}
                      onFocus={() => query.length >= 2 && setShowSuggestions(true)}
                    />
                    {query && (
                      <button
                        type="button"
                        aria-label="Startbahnhof zurücksetzen"
                        onClick={reset}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg"
                    >
                      {suggestions.map(station => (
                        <button
                          key={station.id}
                          type="button"
                          onClick={() => selectStation(station)}
                          className="w-full border-b border-gray-100 dark:border-gray-700 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                        >
                          <div className="font-medium text-gray-900 dark:text-gray-100">{station.name}</div>
                          {station.altNames && station.altNames.length > 0 && (
                            <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                              auch: {station.altNames.slice(0, 2).join(", ")}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <Filter className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Verkehrsmittel
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {([
                    ["all", "Alle", productCounts.all],
                    ["longDistance", "Fernverkehr", productCounts.longDistance],
                    ["regional", "Nahverkehr", productCounts.regional],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setProductFilter(value)}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                        productFilter === value
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <Train className="h-4 w-4" />
                        <span>{label}</span>
                        {selectedStation && <span className="text-xs opacity-80">({count})</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <Filter className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Maximale Fahrtdauer
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {([
                    ["all", "Alle", durationCounts.all],
                    ["120", "bis 2 h", durationCounts["120"]],
                    ["240", "bis 4 h", durationCounts["240"]],
                    ["480", "bis 8 h", durationCounts["480"]],
                    ["720", "bis 12 h", durationCounts["720"]],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMaxDuration(value)}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                        maxDuration === value
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                        <span>{label}</span>
                        {selectedStation && <span className="text-xs opacity-80">({count})</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-3">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <Filter className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Mindestangebot
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  {([
                    ["all", "Alle", tripFrequencyCounts.all],
                    ["1", "ab 1/Tag", tripFrequencyCounts["1"]],
                    ["3", "ab 3/Tag", tripFrequencyCounts["3"]],
                    ["5", "ab 5/Tag", tripFrequencyCounts["5"]],
                    ["10", "ab 10/Tag", tripFrequencyCounts["10"]],
                    ["20", "ab 20/Tag", tripFrequencyCounts["20"]],
                  ] as const).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMinTripsPerDay(value)}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all ${
                        minTripsPerDay === value
                          ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                          : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      }`}
                    >
                      <div className="flex flex-col items-center justify-center gap-0.5 leading-tight">
                        <span>{label}</span>
                        {selectedStation && <span className="text-xs opacity-80">({count})</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" className="w-full rounded-lg bg-blue-600 px-6 py-2.5 font-medium text-white shadow-sm hover:bg-blue-700">
                <ArrowRight className="h-4 w-4" />
                Direktziele anzeigen
              </Button>
            </form>
          </div>
        </section>

        {error && (
          <section className="mb-8 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 text-sm text-amber-900 dark:text-amber-300">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <div>
                <div className="font-semibold">Datenbasis fehlt</div>
                <p className="mt-1">
                  {error} Die App lädt die Daten automatisch aus dem zentralen, täglich aktualisierten Bestand und nutzt danach den lokalen Cache.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="mb-8 space-y-4">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Karte</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedStation
                    ? `${connections.length} Direktziele werden angezeigt.`
                    : isLoading
                      ? "Daten werden geladen"
                      : "Wähle einen Bahnhof aus, um Direktziele auf der Karte zu sehen"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-50">Fernverkehr</Badge>
                <Badge className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50">Nahverkehr</Badge>
                <Badge className="border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-50">Beides</Badge>
                <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 shadow-sm">
                  <Switch
                    id="duration-overlay-toggle"
                    checked={showDurationOverlay}
                    onCheckedChange={setShowDurationOverlay}
                    aria-label="Fahrtdauer-Zonen anzeigen"
                  />
                  <Label
                    htmlFor="duration-overlay-toggle"
                    className="cursor-pointer select-none text-xs font-semibold text-gray-700 dark:text-gray-300"
                  >
                    Fahrtdauer-Zonen
                  </Label>
                </div>
              </div>
            </div>
            <DirectConnectionsMap
              selectedStation={selectedStation}
              connections={connections}
              highlightedStationId={highlightedStationId}
              showDurationOverlay={showDurationOverlay}
              onSelectConnection={connection => {
                setHighlightedStationId(connection.station.id)
                void toggleConnectionDetails(connection, { forceOpen: true })
                setTimeout(() => {
                  document.getElementById(`direct-result-${connection.station.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
                }, 50)
              }}
            />
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 shadow-sm sm:p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Direkt erreichbare Ziele</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedStation
                    ? `${connections.length} von ${selectedStationConnectionCount} Zielen`
                    : "Noch kein Startbahnhof ausgewählt"}
                </p>
              </div>
              <Database className="h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
            </div>

            {selectedStation && (
              <div className="mb-3 space-y-2 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2">
                <div>
                  <Label htmlFor="direct-results-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Ergebnisliste durchsuchen
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                    <Input
                      id="direct-results-search"
                      type="text"
                      value={resultQuery}
                      onChange={event => setResultQuery(event.target.value)}
                      placeholder="Ziel, Linie oder Zugname"
                      className="h-9 pl-8 pr-8 text-sm"
                    />
                    {resultQuery && (
                      <button
                        type="button"
                        aria-label="Ergebnisfilter zurücksetzen"
                        onClick={() => setResultQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Sortieren
                  </Label>
                  <button
                    type="button"
                    onClick={() => setSortDirection(direction => direction === "asc" ? "desc" : "asc")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  >
                    <ArrowDownUp className="h-3.5 w-3.5" />
                    {sortDirection === "asc" ? "Aufsteigend" : "Absteigend"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    ["duration", "Fahrzeit", ArrowDownUp],
                    ["name", "Name", ArrowDownAZ],
                    ["product", "Verkehr", Train],
                    ["frequency", "Fahrten", Database],
                  ] as const).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleSortClick(value)}
                      className={`rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
                        resultSort === value
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      }`}
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                        {resultSort === value && (
                          <span className="text-[10px] opacity-85">
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map(item => (
                  <div key={item} className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
                ))}
              </div>
            ) : !selectedStation ? (
              <div className="rounded-lg border border-blue-100 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 p-4 text-sm text-blue-900 dark:text-blue-200">
                Gib oben einen Startbahnhof ein. Danach siehst du alle Ziele, die ohne Umstieg erreichbar sind.
              </div>
            ) : connections.length === 0 ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 text-sm text-gray-700 dark:text-gray-300">
                Für diesen Filter wurden keine Direktziele gefunden.
              </div>
            ) : (
              <div className="grid max-h-[640px] gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                {connections.map(connection => {
                  const detailState = detailsByConnection[connection.station.id]
                  const isExpanded = expandedConnectionId === connection.station.id

                  return (
                  <div
                    key={connection.station.id}
                    id={`direct-result-${connection.station.id}`}
                    onMouseEnter={() => setHighlightedStationId(connection.station.id)}
                    onFocus={() => setHighlightedStationId(connection.station.id)}
                    onClick={() => setHighlightedStationId(connection.station.id)}
                    tabIndex={0}
                    className={`w-full rounded-lg border p-3 text-left transition-all ${
                      highlightedStationId === connection.station.id
                        ? "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/30 shadow-sm"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50/60 dark:hover:bg-blue-900/20"
                    }`}
                  >
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <Badge className={`${productClasses(connection.products)} w-fit max-w-full shrink-0 whitespace-normal text-left leading-snug`}>
                        {productLabel(connection.products)}
                      </Badge>
                      <div className="min-w-0 sm:order-first">
                        <div className="break-words font-semibold leading-snug text-gray-900 dark:text-gray-100">{connection.station.name}</div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          schnellste Fahrt {formatDuration(connection.time)}
                          {connection.typicalTime && connection.typicalTime !== connection.time && (
                            <> · typisch {formatDuration(connection.typicalTime)}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
                      <div className="rounded-md bg-gray-50 dark:bg-gray-800 px-2 py-1.5">
                        <div className="font-semibold text-gray-800 dark:text-gray-200">{formatTripsPerDay(connection.tripsPerDay)}</div>
                        <div>Angebot</div>
                      </div>
                      <div className="rounded-md bg-gray-50 dark:bg-gray-800 px-2 py-1.5">
                        <div className="font-semibold text-gray-800 dark:text-gray-200">
                          {connection.firstDeparture && connection.lastDeparture
                            ? `${connection.firstDeparture}-${connection.lastDeparture}`
                            : "unbekannt"}
                        </div>
                        <div>erste/letzte Fahrt</div>
                      </div>
                    </div>
                    {connection.lines && connection.lines.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connection.lines.slice(0, 6).map(line => (
                          <span
                            key={line}
                            className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:text-gray-400"
                          >
                            {line}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        Konkrete Abfahrten der nächsten Tage
                      </div>
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation()
                          void toggleConnectionDetails(connection)
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/30"
                      >
                        <CalendarDays className="h-3.5 w-3.5" />
                        {isExpanded ? "Ausblenden" : "Details"}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded-lg border border-blue-100 dark:border-blue-800 bg-white dark:bg-gray-800 p-3">
                        {detailState?.status === "loading" || !detailState ? (
                          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                            Verbindungen werden geladen...
                          </div>
                        ) : detailState.status === "error" ? (
                          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-300">
                            {detailState.error}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                              <Badge className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-50">
                                {detailState.data.summary.departureCount} Fahrten
                              </Badge>
                              <span>
                                {detailState.data.horizonStart && detailState.data.horizonEnd
                                  ? `${formatDateChip(detailState.data.horizonStart)} bis ${formatDateChip(detailState.data.horizonEnd)}`
                                  : "nächste verfügbare Tage"}
                              </span>
                            </div>

                            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                              {detailState.data.days.map(day => (
                                <div key={day.date} className="rounded-md border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="font-semibold text-gray-900 dark:text-gray-100">{formatDateChip(day.date)}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      {day.departures.length} Fahrt{day.departures.length === 1 ? "" : "en"}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {(expandedDetailDays[`${connection.station.id}:${day.date}`] ? day.departures : day.departures.slice(0, 12)).map((departure, index) => (
                                      <div
                                        key={`${departure.departure}-${departure.arrival}-${departure.line ?? ""}-${index}`}
                                        className="grid grid-cols-[minmax(116px,1fr)_minmax(64px,auto)_minmax(42px,auto)] items-center gap-3 rounded bg-white dark:bg-gray-800 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300"
                                      >
                                        <div className="flex min-w-0 items-center gap-1.5 font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                          <span className={`h-2 w-2 rounded-full ${productDotClasses(departure.product)}`} />
                                          <span className="whitespace-nowrap">{departure.departure}</span>
                                          <ArrowRight className="h-3 w-3 text-gray-300" />
                                          <span className="whitespace-nowrap">{departure.arrival}</span>
                                        </div>
                                        <div className="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400">
                                          <Clock className="h-3 w-3" />
                                          {formatDuration(departure.duration)}
                                        </div>
                                        <div className="min-w-0 truncate text-right font-medium text-gray-600 dark:text-gray-400">
                                          {departure.line || productLabel([departure.product])}
                                        </div>
                                      </div>
                                    ))}
                                    {day.departures.length > 12 && (
                                      <button
                                        type="button"
                                        onClick={event => {
                                          event.stopPropagation()
                                          const key = `${connection.station.id}:${day.date}`
                                          setExpandedDetailDays(previous => ({
                                            ...previous,
                                            [key]: !previous[key],
                                          }))
                                        }}
                                        className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-left text-xs font-semibold text-blue-700 dark:text-blue-300 transition-colors hover:border-blue-200 dark:hover:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                      >
                                        {expandedDetailDays[`${connection.station.id}:${day.date}`]
                                          ? "Weniger Fahrten anzeigen"
                                          : `+${day.departures.length - 12} weitere Fahrten an diesem Tag`}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}

            {data && (
              <div className="mt-4 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-600 dark:text-gray-400">
                Daten: {data.source}, Stand {formatGeneratedAt(data.generatedAt)} · {data.stations.length.toLocaleString("de-DE")} Bahnhöfe
              </div>
            )}
          </div>
        </section>

        <Footer show={showFooter} />
      </div>
    </div>
  )
}
