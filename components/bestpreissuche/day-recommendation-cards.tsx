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
    <div className="grid gap-4 md:grid-cols-2">
      {/* Bestpreis */}
      <div className="bg-green-50 border-2 border-green-200 p-4 rounded-lg relative flex flex-col justify-between h-full">
        <div className="absolute -top-3 left-4 flex gap-2">
          <Badge className="bg-green-600 text-white px-3 py-1">
            <Euro className="h-3 w-3 mr-1" />
            Bestpreis
          </Badge>
          {recommendation && recommendedTrip && recommendedTrip.preis === data.preis && (
            <Badge className="bg-amber-100 text-amber-800 border border-amber-400 px-3 py-1">
              <Star className="h-3 w-3 mr-1" />
              Empfohlen
            </Badge>
          )}
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

      {/* KI-Empfehlung */}
      {recommendation && recommendedTrip && recommendedTrip.preis !== data.preis ? (
        <div className="bg-amber-50 border-2 border-amber-200 p-4 rounded-lg relative flex flex-col justify-between h-full">
          <div className="absolute -top-3 left-4">
            <Popover>
              <PopoverTrigger asChild>
                <Badge className="bg-amber-600 text-white px-3 py-1 cursor-help">
                  <Star className="h-3 w-3 mr-1" />
                  Empfohlen
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="max-w-sm text-sm">
                <div className="font-semibold mb-2 text-amber-800">🧠 Intelligente Empfehlung</div>
                <div className="space-y-2">
                  <div>Unser Algorithmus bewertet alle Verbindungen nach:</div>
                  <ul className="list-disc list-inside space-y-1 text-xs text-gray-600">
                    <li><strong>45%</strong> Preis</li>
                    <li><strong>30%</strong> Reisezeit</li>
                    <li><strong>25%</strong> Anzahl Umstiege (Komfort)</li>
                    <li><strong>Direktverbindung</strong> wird bis zu 40% Aufpreis bevorzugt</li>
                  </ul>
                  <div className="text-xs mt-2 p-2 bg-amber-100 rounded">
                    <strong>Diese Verbindung:</strong> {recommendation.explanation.reason}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-4xl font-bold text-amber-700">{recommendedTrip.preis.toFixed(2)}€</span>
                <span className="text-lg text-gray-500">+{(recommendedTrip.preis - data.preis).toFixed(2)}€</span>
                <span className="ml-2"><VehicleTypesSummary interval={recommendedTrip} /></span>
              </div>
              {/* Gemeinsame Zeile für Reisedaten */}
              <div className="flex flex-wrap items-center gap-2 md:gap-4 text-sm text-gray-600 mb-1">
                <span>
                  {new Date(recommendedTrip.abfahrtsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                  <ArrowRight className="inline h-3 w-3 mx-1" />
                  {new Date(recommendedTrip.ankunftsZeitpunkt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>({calculateDuration(recommendedTrip.abfahrtsZeitpunkt, recommendedTrip.ankunftsZeitpunkt)})</span>
                <span className="flex items-center gap-1">
                  <Shuffle className="h-4 w-4 text-gray-500" />
                  <span className="hidden md:inline">Umstiege:</span>
                  {recommendedTrip.umstiegsAnzahl || 0}
                </span>
                {(recommendedTrip.umstiegsAnzahl || 0) === 0 && (
                  <Badge variant="outline" className="text-green-700 border-green-300 text-xs ml-1">Direktverbindung</Badge>
                )}
              </div>
              {/* Begründung für die KI-Analyse */}
              <div className="text-sm text-amber-700 font-medium mb-3">
                {recommendation.explanation.reason}
              </div>
            </div>
            {startStation && zielStation && (
              <Button
                onClick={() => {
                  const bookingLink = createBookingLink(
                    recommendedTrip.abfahrtsZeitpunkt,
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
                className="bg-amber-600 hover:bg-amber-700 w-full mt-auto"
              >
                <Star className="h-4 w-4 mr-2" />
                Empfehlung buchen
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden md:flex bg-amber-50 border-2 border-amber-200 p-4 rounded-lg shadow-sm items-center justify-center">
          <div className="text-center">
            <Star className="h-8 w-8 mx-auto mb-2 text-amber-400" />
            <div className="font-semibold text-amber-800">Bestpreis ist bereits optimal!</div>
            <div className="text-sm mt-1 text-amber-700">Die KI-Analyse bestätigt: Diese Verbindung bietet die beste Balance aus Preis, Zeit und Komfort.<br/>Keine bessere Empfehlung möglich.</div>
          </div>
        </div>
      )}
    </div>
  )
}
