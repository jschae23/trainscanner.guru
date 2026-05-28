"use client"

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { logError, logWarn } from '@/lib/shared/logger'

const LOG_SCOPE = "urlaubsfinder.map"

// Dynamic import to avoid SSR issues with Leaflet
const DynamicLeaflet = dynamic(async () => {
  const L = await import('leaflet')
  
  interface DestinationResult {
    destination: string
    destinationId: string
    outwardDate: string
    outwardPrice: number
    outwardDeparture: string
    outwardArrival: string
    returnDate?: string
    returnPrice?: number
    returnDeparture?: string
    returnArrival?: string
    totalPrice: number
    lat?: number
    lon?: number
  }

  interface UrlauberfinderLeafletMapProps {
    destinations: DestinationResult[]
    homeStation: string
    homeCoords?: { lat: number; lon: number }
    selectedResult: DestinationResult | null
    onSelectResult: (result: DestinationResult) => void
  }

  function fmt(iso: string) {
    if (!iso) return '–'
    try {
      return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
    } catch { return '–' }
  }

  return {
    default: function UrlauberfinderLeafletMap({
      destinations,
      homeStation,
      homeCoords,
      selectedResult,
      onSelectResult,
    }: UrlauberfinderLeafletMapProps) {
      const mapContainerRef = useRef<HTMLDivElement>(null)
      const mapInstanceRef = useRef<any>(null)
      const markersRef = useRef<any[]>([])
      const homeMarkerRef = useRef<any>(null)
      const onSelectRef = useRef(onSelectResult)
      onSelectRef.current = onSelectResult
      // Track whether user has interacted with the map (pan/zoom)
      const userInteractedRef = useRef(false)
      const programmaticMoveRef = useRef(false)

      // Initialize map once on mount
      useEffect(() => {
        if (!mapContainerRef.current) return
        if (mapInstanceRef.current) return

        try {
          const map = L.map(mapContainerRef.current, {
            center: [51.5, 10],
            zoom: 5,
            zoomControl: true,
          })
          mapInstanceRef.current = map

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
          }).addTo(map)

          // Mark only manual map movement as user interaction. Leaflet also emits
          // move/zoom events for fitBounds, and those should not disable auto-fit.
          map.on('movestart', () => {
            if (!programmaticMoveRef.current) userInteractedRef.current = true
          })
          map.on('zoomstart', () => {
            if (!programmaticMoveRef.current) userInteractedRef.current = true
          })

          // Invalidate size after a short delay to ensure container is fully rendered
          setTimeout(() => {
            map.invalidateSize()
          }, 100)
        } catch (e) {
          logError(LOG_SCOPE, "Could not initialize Leaflet map", e)
        }

        return () => {
          if (mapInstanceRef.current) {
            try {
              mapInstanceRef.current.remove()
            } catch (e) {}
            mapInstanceRef.current = null
          }
        }
      }, [])

      // Update markers when destinations or homeCoords change
      useEffect(() => {
        const map = mapInstanceRef.current
        if (!map) return

        // Clear existing markers
        markersRef.current.forEach((marker: any) => {
          try { map.removeLayer(marker) } catch (e) {}
        })
        markersRef.current = []
        if (homeMarkerRef.current) {
          try { map.removeLayer(homeMarkerRef.current) } catch (e) {}
          homeMarkerRef.current = null
        }

        const allMarkersForBounds: any[] = []

        // Add home station marker
        if (homeCoords?.lat && homeCoords?.lon) {
          const homeIcon = L.divIcon({
            html: `<div style="position:relative;display:inline-flex;flex-direction:column;align-items:center;cursor:pointer">
              <div style="background:#2563eb;color:white;padding:4px 8px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);line-height:1.3">🏠 ${homeStation}</div>
              <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #2563eb;margin-top:-1px"></div>
            </div>`,
            className: '',
            iconAnchor: [40, 32],
          })
          homeMarkerRef.current = L.marker([homeCoords.lat, homeCoords.lon], { icon: homeIcon })
            .bindPopup(`<b>${homeStation}</b><br><small>Heimatbahnhof</small>`)
            .addTo(map)
          allMarkersForBounds.push(homeMarkerRef.current)
        }

        if (destinations.length === 0) return

        const minPrice = Math.min(...destinations.map((d: DestinationResult) => d.totalPrice))
        const maxPrice = Math.max(...destinations.map((d: DestinationResult) => d.totalPrice))
        const priceRange = maxPrice - minPrice

        destinations.forEach((dest: DestinationResult) => {
          if (!dest.lat || !dest.lon) return

          const pricePercent = priceRange > 0 ? ((dest.totalPrice - minPrice) / priceRange) * 100 : 50
          let bgColor = '#22c55e' // green
          if (pricePercent > 66) bgColor = '#ef4444' // red
          else if (pricePercent > 33) bgColor = '#f59e0b' // amber

          const label = pricePercent < 33 ? '💰' : pricePercent < 66 ? '⚖️' : '❌'

          const icon = L.divIcon({
            html: `<div style="position:relative;display:inline-flex;flex-direction:column;align-items:center;cursor:pointer">
              <div style="background:${bgColor};color:white;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.35);line-height:1.4">${label} ${dest.totalPrice.toFixed(0)}€</div>
              <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${bgColor};margin-top:-1px"></div>
            </div>`,
            className: '',
            iconAnchor: [30, 28],
          })

          // Build popup HTML with details + a "Zur Liste" button
          const hasReturn = !!(dest.returnDeparture && dest.returnPrice)
          const outRow = dest.outwardDeparture
            ? `<div style="margin:4px 0;font-size:12px;color:#1d4ed8">📍 Hin: ${fmt(dest.outwardDeparture)} → ${fmt(dest.outwardArrival)} · <b>${dest.outwardPrice.toFixed(0)} €</b></div>`
            : ''
          const retRow = hasReturn
            ? `<div style="margin:4px 0;font-size:12px;color:#c2410c">↩️ Rück: ${fmt(dest.returnDeparture!)} → ${fmt(dest.returnArrival ?? '')} · <b>${(dest.returnPrice ?? 0).toFixed(0)} €</b></div>`
            : ''

          const popupHtml = `
            <div style="min-width:180px;font-family:system-ui,sans-serif">
              <div style="font-size:14px;font-weight:700;color:#111;margin-bottom:4px">${dest.destination.replace(' Hbf', '')}</div>
              <div style="font-size:18px;font-weight:900;color:${bgColor};margin-bottom:4px">${dest.totalPrice.toFixed(2)} €</div>
              ${outRow}${retRow}
              <button
                id="jump-${dest.destinationId || dest.destination.replace(/\s/g, '_')}"
                style="margin-top:8px;width:100%;padding:6px 0;background:#2563eb;color:white;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer"
              >Zur Liste ↓</button>
            </div>`

          const marker = L.marker([dest.lat, dest.lon], { icon })
            .bindPopup(popupHtml, { maxWidth: 240, className: 'uf-popup' })
            .addTo(map)

          // When popup opens, wire up the "Zur Liste" button
          marker.on('popupopen', () => {
            const btnId = `jump-${dest.destinationId || dest.destination.replace(/\s/g, '_')}`
            const btn = document.getElementById(btnId)
            if (btn) {
              btn.onclick = () => {
                marker.closePopup()
                onSelectRef.current(dest)
              }
            }
          })

          markersRef.current.push(marker)
          allMarkersForBounds.push(marker)
        })

        // Only fit bounds if user has not manually interacted with the map
        if (!userInteractedRef.current && allMarkersForBounds.length > 0) {
          try {
            const group = L.featureGroup(allMarkersForBounds)
            const clearProgrammaticMove = () => {
              programmaticMoveRef.current = false
            }
            programmaticMoveRef.current = true
            map.once('moveend', clearProgrammaticMove)
            map.fitBounds(group.getBounds().pad(0.15))
            setTimeout(clearProgrammaticMove, 500)
            setTimeout(() => map.invalidateSize(), 50)
          } catch (e) {
            programmaticMoveRef.current = false
            logWarn(LOG_SCOPE, "Could not fit Leaflet bounds", {
              error: e instanceof Error ? e.message : e,
              markerCount: allMarkersForBounds.length,
            })
          }
        } else {
          setTimeout(() => map.invalidateSize(), 50)
        }
      }, [destinations, homeCoords, homeStation])

      return (
        <div 
          ref={mapContainerRef}
          style={{ 
            width: '100%',
            height: '450px',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            overflow: 'hidden',
            backgroundColor: '#e5e3df',
          }} 
        />
      )
    }
  }
}, {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: '450px', background: '#f3f4f6', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
      Karte wird geladen...
    </div>
  )
})

export function UrlauberfinderLeafletMap(props: any) {
  return <DynamicLeaflet {...props} />
}
