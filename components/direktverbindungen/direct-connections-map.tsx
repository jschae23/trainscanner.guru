"use client"

import { useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { logError, logWarn } from "@/lib/shared/logger"

const LOG_SCOPE = "direktverbindungen.map"

export interface DirectStation {
  id: string
  name: string
  lat: number
  lon: number
  altNames?: string[]
}

export interface DirectConnectionResult {
  station: DirectStation
  time: number
  typicalTime?: number
  tripsPerDay?: number
  firstDeparture?: string | null
  lastDeparture?: string | null
  lines?: string[]
  products: string[]
}

interface DirectConnectionsMapProps {
  selectedStation?: DirectStation | null
  connections: DirectConnectionResult[]
  highlightedStationId?: string | null
  showDurationOverlay?: boolean
  onSelectConnection?: (connection: DirectConnectionResult) => void
}

interface HullPoint {
  lat: number
  lon: number
}

const DURATION_BANDS = [
  { minMinutes: 0, maxMinutes: 120, label: "bis 2 h", color: "#16a34a" },
  { minMinutes: 120, maxMinutes: 240, label: "2-4 h", color: "#0891b2" },
  { minMinutes: 240, maxMinutes: 480, label: "4-8 h", color: "#d97706" },
  { minMinutes: 480, maxMinutes: 720, label: "8-12 h", color: "#dc2626" },
  { minMinutes: 720, maxMinutes: null, label: "12+ h", color: "#7f1d1d" },
]

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function productLabel(products: string[]): string {
  if (products.includes("longDistance") && products.includes("regional")) {
    return "Fern- und Nahverkehr"
  }
  if (products.includes("longDistance")) return "Fernverkehr"
  return "Nahverkehr"
}

function formatTripsPerDay(value?: number): string {
  if (value === undefined || value === null) return "unbekannt"
  if (value < 1) return "<1 Fahrt/Tag"
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1).replace(".", ",")
  return `${rounded} Fahrten/Tag`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function cross(origin: HullPoint, a: HullPoint, b: HullPoint): number {
  return (a.lon - origin.lon) * (b.lat - origin.lat) - (a.lat - origin.lat) * (b.lon - origin.lon)
}

function convexHull(points: HullPoint[]): HullPoint[] {
  const uniquePoints = Array.from(
    new Map(points.map(point => [`${point.lat.toFixed(5)},${point.lon.toFixed(5)}`, point])).values()
  ).sort((a, b) => a.lon - b.lon || a.lat - b.lat)

  if (uniquePoints.length < 3) return []

  const lower: HullPoint[] = []
  for (const point of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: HullPoint[] = []
  for (let i = uniquePoints.length - 1; i >= 0; i--) {
    const point = uniquePoints[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const DynamicLeafletMap = dynamic(async () => {
  const L = await import("leaflet")

  return {
    default: function LeafletDirectConnectionsMap({
      selectedStation,
      connections,
      highlightedStationId,
      showDurationOverlay = true,
      onSelectConnection,
    }: DirectConnectionsMapProps) {
      const mapContainerRef = useRef<HTMLDivElement>(null)
      const mapRef = useRef<any>(null)
      const layersRef = useRef<any[]>([])
      const hasUserMovedRef = useRef(false)
      const programmaticMoveRef = useRef(false)
      const onSelectRef = useRef(onSelectConnection)
      onSelectRef.current = onSelectConnection

      useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return

        try {
          const map = L.map(mapContainerRef.current, {
            center: [51.1657, 10.4515],
            zoom: 6,
            zoomControl: true,
          })
          mapRef.current = map

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors | Train data: GTFS.de",
            maxZoom: 19,
          }).addTo(map)

          map.on("movestart", () => {
            if (!programmaticMoveRef.current) hasUserMovedRef.current = true
          })
          map.on("zoomstart", () => {
            if (!programmaticMoveRef.current) hasUserMovedRef.current = true
          })

          setTimeout(() => map.invalidateSize(), 100)
        } catch (error) {
          logError(LOG_SCOPE, "Could not initialize Leaflet map", error)
        }

        return () => {
          if (!mapRef.current) return
          try {
            mapRef.current.remove()
          } catch {}
          mapRef.current = null
        }
      }, [])

      useEffect(() => {
        const map = mapRef.current
        if (!map) return

        for (const layer of layersRef.current) {
          try {
            map.removeLayer(layer)
          } catch {}
        }
        layersRef.current = []

        const boundsLayers: any[] = []

        if (!selectedStation) {
          setTimeout(() => map.invalidateSize(), 50)
          return
        }

        const origin = [selectedStation.lat, selectedStation.lon] as [number, number]
        const selectedStationName = escapeHtml(selectedStation.name)
        const originIcon = L.divIcon({
          className: "",
          iconSize: [1, 34],
          iconAnchor: [0, 34],
          html: `<div style="position:absolute;left:0;bottom:0;display:inline-flex;flex-direction:column;align-items:center;transform:translateX(-50%)">
            <div style="background:#2563eb;color:white;padding:5px 9px;border-radius:8px;font-size:12px;font-weight:800;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.28);line-height:1.25">Start: ${selectedStationName}</div>
            <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:8px solid #2563eb;margin-top:-1px"></div>
          </div>`,
        })
        const originMarker = L.marker(origin, { icon: originIcon })
          .bindPopup(`<strong>${selectedStationName}</strong><br><small>Startbahnhof</small>`)
          .addTo(map)
        layersRef.current.push(originMarker)
        boundsLayers.push(originMarker)

        if (showDurationOverlay) {
          for (let bandIndex = DURATION_BANDS.length - 1; bandIndex >= 0; bandIndex--) {
            const band = DURATION_BANDS[bandIndex]
            const bandHasConnections = connections.some(connection =>
              connection.time > band.minMinutes &&
              (band.maxMinutes === null || connection.time <= band.maxMinutes)
            )
            if (!bandHasConnections) continue

            const outerPoints = [
              { lat: selectedStation.lat, lon: selectedStation.lon },
              ...connections
                .filter(connection => band.maxMinutes === null || connection.time <= band.maxMinutes)
                .map(connection => ({
                  lat: connection.station.lat,
                  lon: connection.station.lon,
                })),
            ]
            const outerHull = convexHull(outerPoints)
            if (outerHull.length < 3) continue

            const innerPoints = [
              { lat: selectedStation.lat, lon: selectedStation.lon },
              ...connections
                .filter(connection => connection.time <= band.minMinutes)
                .map(connection => ({
                  lat: connection.station.lat,
                  lon: connection.station.lon,
                })),
            ]
            const innerHull = band.minMinutes > 0 ? convexHull(innerPoints) : []
            const polygonRings = [
              outerHull.map(point => [point.lat, point.lon] as [number, number]),
              ...(innerHull.length >= 3
                ? [innerHull.map(point => [point.lat, point.lon] as [number, number])]
                : []),
            ]

            const polygon = L.polygon(
              polygonRings,
              {
                color: band.color,
                weight: 2,
                opacity: 0.8,
                fillColor: band.color,
                fillOpacity: 0.07,
                dashArray: bandIndex % 2 === 0 ? "8 7" : "3 6",
                interactive: false,
              }
            ).addTo(map)
            layersRef.current.push(polygon)
          }
        }

        const visibleConnections = connections.slice(0, 500)
        for (const connection of visibleConnections) {
          const destination = connection.station
          const destinationPosition = [destination.lat, destination.lon] as [number, number]
          const isHighlighted = highlightedStationId === destination.id
          const hasLongDistance = connection.products.includes("longDistance")
          const hasRegional = connection.products.includes("regional")
          const color = hasLongDistance && hasRegional
            ? "#7c3aed"
            : hasLongDistance
              ? "#dc2626"
              : "#059669"
          if (isHighlighted) {
            const line = L.polyline([origin, destinationPosition], {
              color,
              weight: 4,
              opacity: 0.9,
            }).addTo(map)
            layersRef.current.push(line)
          }

          const lineHtml = connection.lines && connection.lines.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">${connection.lines.slice(0, 5).map(line => `<span style="display:inline-flex;border:1px solid #e5e7eb;border-radius:999px;background:#fff;padding:1px 7px;font-size:11px;font-weight:700;color:#4b5563">${line}</span>`).join("")}</div>`
            : ""
          const firstLastHtml = connection.firstDeparture && connection.lastDeparture
            ? `${connection.firstDeparture}-${connection.lastDeparture}`
            : "unbekannt"
          const typicalText = connection.typicalTime && connection.typicalTime !== connection.time
            ? `typisch ${formatTime(connection.typicalTime)}`
            : ""
          const productClassColor = connection.products.includes("longDistance") && connection.products.includes("regional")
            ? "#7c3aed"
            : connection.products.includes("longDistance")
              ? "#dc2626"
              : "#059669"

          const marker = L.circleMarker(destinationPosition, {
            radius: isHighlighted ? 8 : 5,
            color: isHighlighted ? "#111827" : "#ffffff",
            weight: isHighlighted ? 3 : 1.5,
            fillColor: color,
            fillOpacity: 0.9,
          })
            .bindTooltip(`${destination.name}: ${formatTime(connection.time)}`, {
              direction: "top",
              offset: [0, -8],
            })
            .bindPopup(`
              <div style="min-width:220px;max-width:260px;font-family:system-ui,sans-serif;color:#111827">
                <div style="display:inline-flex;max-width:100%;border:1px solid ${productClassColor}33;background:${productClassColor}12;color:${productClassColor};border-radius:999px;padding:2px 8px;font-size:11px;font-weight:800;line-height:1.3;margin-bottom:8px">${productLabel(connection.products)}</div>
                <div style="font-size:15px;font-weight:850;line-height:1.25;margin-bottom:5px">${destination.name}</div>
                <div style="font-size:12px;color:#6b7280;margin-bottom:10px">
                  schnellste Fahrt <strong style="color:#111827">${formatTime(connection.time)}</strong>${typicalText ? ` · ${typicalText}` : ""}
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
                  <div style="background:#f9fafb;border-radius:6px;padding:7px 8px">
                    <div style="font-size:12px;font-weight:800;color:#111827">${formatTripsPerDay(connection.tripsPerDay)}</div>
                    <div style="font-size:11px;color:#6b7280">Angebot</div>
                  </div>
                  <div style="background:#f9fafb;border-radius:6px;padding:7px 8px">
                    <div style="font-size:12px;font-weight:800;color:#111827">${firstLastHtml}</div>
                    <div style="font-size:11px;color:#6b7280">erste/letzte Fahrt</div>
                  </div>
                </div>
                ${lineHtml}
                <button id="direct-${destination.id}" style="margin-top:10px;width:100%;padding:7px 0;background:#2563eb;color:white;border:none;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer">Details</button>
              </div>
            `)
            .addTo(map)

          marker.on("popupopen", () => {
            const button = document.getElementById(`direct-${destination.id}`)
            if (button) {
              button.onclick = () => onSelectRef.current?.(connection)
            }
          })

          layersRef.current.push(marker)
          boundsLayers.push(marker)
        }

        if (!hasUserMovedRef.current && boundsLayers.length > 0) {
          try {
            const group = L.featureGroup(boundsLayers)
            programmaticMoveRef.current = true
            map.once("moveend", () => {
              programmaticMoveRef.current = false
            })
            map.fitBounds(group.getBounds().pad(0.18), { maxZoom: 8 })
            setTimeout(() => {
              programmaticMoveRef.current = false
              map.invalidateSize()
            }, 500)
          } catch (error) {
            programmaticMoveRef.current = false
            logWarn(LOG_SCOPE, "Could not fit direct connections map bounds", {
              error: error instanceof Error ? error.message : error,
            })
          }
        } else {
          setTimeout(() => map.invalidateSize(), 50)
        }
      }, [selectedStation, connections, highlightedStationId, showDurationOverlay])

      return (
        <div className="space-y-3">
          <div
            ref={mapContainerRef}
            className="h-[520px] w-full overflow-hidden rounded-lg border border-gray-200 bg-[#e5e3df] sm:h-[640px] xl:h-[720px]"
          />
          {showDurationOverlay && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-700">Fahrtdauer-Bereiche:</span>
              {DURATION_BANDS.map(band => (
                <span key={band.label} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1">
                  <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: band.color }} />
                  {band.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )
    },
  }
}, {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-sm text-gray-500 sm:h-[640px] xl:h-[720px]">
      Karte wird geladen...
    </div>
  ),
})

export function DirectConnectionsMap(props: DirectConnectionsMapProps) {
  return <DynamicLeafletMap {...props} />
}
