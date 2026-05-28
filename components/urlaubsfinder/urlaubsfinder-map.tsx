'use client'

import { MapPin, TrendingDown } from 'lucide-react'

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

interface UrlauberfinderMapProps {
  destinations: DestinationResult[]
  homeStation: string
  selectedResult: DestinationResult | null
  onSelectResult: (result: DestinationResult) => void
}

/**
 * Germany map visualization showing destinations with prices
 * Uses CSS-based positioning instead of Leaflet to avoid external dependencies
 */
export default function UrlauberfinderMap({
  destinations,
  homeStation,
  selectedResult,
  onSelectResult,
}: UrlauberfinderMapProps) {
  // Germany bounding box (simplified)
  const GERMANY_LAT_MIN = 47.0
  const GERMANY_LAT_MAX = 55.0
  const GERMANY_LON_MIN = 5.8
  const GERMANY_LON_MAX = 15.0

  const normalize = (value: number, min: number, max: number): number => {
    return ((value - min) / (max - min)) * 100
  }

  // Find cheapest and most expensive
  const minPrice = Math.min(...destinations.map(d => d.totalPrice))
  const maxPrice = Math.max(...destinations.map(d => d.totalPrice))

  // Filter destinations with coordinates
  const locatedDestinations = destinations.filter(d => d.lat && d.lon)

  return (
    <div className="w-full space-y-4">
      {/* Map Background */}
      <div className="relative w-full bg-gradient-to-br from-blue-100 to-blue-50 rounded-lg border border-blue-200 overflow-hidden" style={{ aspectRatio: '16/10' }}>
        {/* Map container */}
        <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#999" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Destination markers */}
        {locatedDestinations.map((destination, index) => {
          const left = normalize(destination.lon!, GERMANY_LON_MIN, GERMANY_LON_MAX)
          const top = 100 - normalize(destination.lat!, GERMANY_LAT_MIN, GERMANY_LAT_MAX)

          const isCheapest = destination.totalPrice === minPrice
          const isSelected = selectedResult?.destination === destination.destination

          // Color intensity based on price
          const pricePercent = ((destination.totalPrice - minPrice) / (maxPrice - minPrice)) * 100
          let bgColor = 'bg-green-500'
          if (pricePercent > 66) bgColor = 'bg-red-500'
          else if (pricePercent > 33) bgColor = 'bg-yellow-500'

          return (
            <button
              key={destination.destination}
              onClick={() => onSelectResult(destination)}
              className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-200 ${
                isSelected ? 'scale-125 z-20' : 'scale-100 z-10'
              }`}
              style={{ left: `${left}%`, top: `${top}%` }}
              title={`${destination.destination}: ${destination.totalPrice.toFixed(2)}€`}
            >
              {/* Outer ring for selected */}
              {isSelected && (
                <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-pulse" style={{ width: '70px', height: '70px', left: '-35px', top: '-35px' }} />
              )}

              {/* Main marker */}
              <div
                className={`relative w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg border-2 ${
                  isCheapest ? 'bg-green-600 border-white' : `${bgColor} border-white`
                } cursor-pointer hover:shadow-xl`}
              >
                <div className="text-center">
                  <div className="text-xs font-bold">{destination.totalPrice.toFixed(0)}€</div>
                </div>
                {isCheapest && (
                  <div className="absolute -top-2 -right-2 bg-yellow-300 rounded-full w-6 h-6 flex items-center justify-center text-xs">
                    🏆
                  </div>
                )}
              </div>

              {/* Label below marker */}
              <div className="absolute top-14 left-1/2 transform -translate-x-1/2 whitespace-nowrap bg-white px-2 py-1 rounded shadow-md text-xs font-semibold text-gray-800 border border-gray-200 pointer-events-none">
                {destination.destination}
              </div>
            </button>
          )
        })}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 bg-white p-3 rounded-lg shadow-md border border-gray-200 text-xs space-y-1 z-10">
          <div className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Preislegende
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded-full"></div>
            <span>Günstig</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
            <span>Mittel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded-full"></div>
            <span>Teuer</span>
          </div>
        </div>
      </div>

      {/* Info text */}
      <p className="text-xs text-gray-500 flex items-center gap-2">
        <MapPin className="w-3 h-3" />
        Klicke auf einen Marker für Details. Grüne Marker = günstiger, Rote Marker = teurer
      </p>
    </div>
  )
}
