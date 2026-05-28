import React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Euro, Star, Train, ArrowRight, Shuffle } from "lucide-react"
import { recommendBestPrice } from "@/lib/train-search/recommendation-engine"
import { VehicleTypesSummary } from "./vehicle-types-summary"

export function RecommendationCards({
  data,
  intervals,
  recommendation,
  recommendedTrip,
  startStation,
  zielStation,
  searchParams,
  calculateDuration,
  createBookingLink,
}: any) {
  return (
      <div className="bg-green-50 border-2 border-green-200 p-4 rounded-lg relative flex flex-col justify-between h-full">
        <div className="absolute -top-3 left-4 flex gap-2">
          <Badge className="bg-green-600 text-white px-3 py-1">
            <Euro className="h-3 w-3 mr-1" />
            Bestpreis
          </Badge>

        </div>
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="text-4xl font-bold text-green-700">{data.preis}€</div>
              {intervals && intervals.length > 0 && (() => {
                const bestPriceTrip = recommendBestPrice(intervals)
                return bestPriceTrip ? (
                  <div className="ml-2"><VehicleTypesSummary interval={bestPriceTrip} /></div>
                ) : null
              })()}
            </div>
            {/* Gemeinsame Zeile für Reisedaten */}
            {data.abfahrtsZeitpunkt && data.ankunftsZeitpunkt && (() => {
              // Nutze recommendBestPrice für die Anzeige
              const bestPriceTrip = intervals.length > 0 ? recommendBestPrice(intervals) : null
              return bestPriceTrip ? (
                <div className="flex flex-wrap items-center gap-2 md:gap-4 text-sm text-gray-600 mb-3">
                  <span>
                    {new Date(bestPriceTrip.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                    <ArrowRight className="inline h-3 w-3 mx-1" />
                    {new Date(bestPriceTrip.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span>({calculateDuration(bestPriceTrip.abfahrtsZeitpunkt, bestPriceTrip.ankunftsZeitpunkt)})</span>
                  <span className="flex items-center gap-1">
                    <Shuffle className="h-4 w-4 text-gray-500" />
                    <span className="hidden md:inline">Umstiege:</span>
                    {bestPriceTrip.umstiegsAnzahl || 0}
                  </span>
                  {(bestPriceTrip.umstiegsAnzahl || 0) === 0 && (
                    <span className="inline-flex items-center ml-2">
                      <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                        Direktverbindung
                      </Badge>
                    </span>
                  )}
                </div>
              ) : null
            })()}
          </div>
          {data.abfahrtsZeitpunkt && startStation && zielStation && (
            <Button
              onClick={() => {
                const bookingLink = createBookingLink(
                  data.abfahrtsZeitpunkt,
                  startStation.name,
                  zielStation.name,
                  startStation.id,
                  zielStation.id,
                  searchParams.klasse || "KLASSE_2",
                  searchParams.maximaleUmstiege || "",
                  searchParams.alter || "ERWACHSENER",
                  searchParams.ermaessigungArt || "KEINE_ERMAESSIGUNG",
                  searchParams.ermaessigungKlasse || "KLASSENLOS",
                  searchParams.umstiegszeit
                )
                if (bookingLink) {
                  window.open(bookingLink, "_blank")
                }
              }}
              className="bg-green-600 hover:bg-green-700 w-full mt-auto"
            >
              <Train className="h-4 w-4 mr-2" />
              Bestpreis buchen
            </Button>
          )}
        </div>
    </div>
  )
}
