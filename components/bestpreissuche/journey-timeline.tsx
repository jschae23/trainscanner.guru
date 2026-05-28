import React from "react"
import { Clock, ArrowRight } from "lucide-react"

export interface JourneyLeg {
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  verkehrsmittel?: {
    produktGattung?: string
    kategorie?: string
    name?: string
    mittelText?: string
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getVehicleTypeStyle(produktGattung?: string) {
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

function calculateTransferTime(fromArrival: string, toDeparture: string): number {
  return Math.round(
    (new Date(toDeparture).getTime() - new Date(fromArrival).getTime()) / 60000
  )
}

function getTransferTimeStyle(minutes: number) {
  if (minutes <= 6)  return { bg: "bg-red-100",    text: "text-red-700",    border: "border-red-300" }
  if (minutes <= 10) return { bg: "bg-orange-100",  text: "text-orange-700", border: "border-orange-300" }
  if (minutes >= 30) return { bg: "bg-green-100",   text: "text-green-700",  border: "border-green-300" }
  return               { bg: "bg-blue-100",   text: "text-blue-700",  border: "border-blue-300" }
}

function legDuration(dep: string, arr: string): string {
  const mins = Math.round((new Date(arr).getTime() - new Date(dep).getTime()) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
}

function vehicleLabel(leg: JourneyLeg) {
  return (
    leg.verkehrsmittel?.mittelText ||
    leg.verkehrsmittel?.name ||
    leg.verkehrsmittel?.kategorie ||
    leg.verkehrsmittel?.produktGattung ||
    "Zug"
  )
}

// ─── Vertical / Mobile Timeline ───────────────────────────────────────────────

export function JourneyTimelineVertical({ legs }: { legs: JourneyLeg[] }) {
  if (!legs || legs.length === 0) {
    return (
      <div className="text-xs text-gray-600 text-center py-2">
        Keine Verbindungsdetails verfügbar
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {legs.map((leg, idx) => {
        const vehicleStyle = getVehicleTypeStyle(leg.verkehrsmittel?.produktGattung)
        const isLast = idx === legs.length - 1
        const nextLeg = !isLast ? legs[idx + 1] : null
        const transferTime = nextLeg
          ? calculateTransferTime(leg.ankunftsZeitpunkt, nextLeg.abfahrtsZeitpunkt)
          : null
        const transferStyle = transferTime !== null ? getTransferTimeStyle(transferTime) : null
        const duration = legDuration(leg.abfahrtsZeitpunkt, leg.ankunftsZeitpunkt)

        return (
          <div key={idx} className="border-l-2 border-gray-300 pl-3">
            {/* Departure */}
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-gray-800 text-xs">{leg.abfahrtsOrt}</div>
              <div className="font-semibold text-gray-800 text-xs">{fmtTime(leg.abfahrtsZeitpunkt)}</div>
            </div>

            {/* Vehicle + duration */}
            <div className="flex items-center justify-between mb-1">
              <div
                className={`px-2 py-1 rounded font-semibold text-xs ${vehicleStyle.color} ${vehicleStyle.bg} ${vehicleStyle.border} border whitespace-nowrap shadow-sm`}
              >
                {vehicleLabel(leg)}
              </div>
              <div className="text-xs text-gray-500">{duration}</div>
            </div>

            {/* Arrival */}
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-gray-800 text-xs">{leg.ankunftsOrt}</div>
              <div className="font-semibold text-gray-800 text-xs">{fmtTime(leg.ankunftsZeitpunkt)}</div>
            </div>

            {/* Transfer */}
            {!isLast && transferTime !== null && transferStyle && (
              <div className="flex items-center justify-center py-2 border-t border-gray-200">
                <div
                  className={`px-2 py-1 rounded-full ${transferStyle.bg} ${transferStyle.text} font-medium text-xs flex items-center gap-1 shadow-sm border ${transferStyle.border}`}
                >
                  <Clock className="h-3 w-3" />
                  {transferTime}min Umstieg
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Horizontal / Desktop Timeline ────────────────────────────────────────────

const MAX_SEGMENTS_PER_ROW = 3

function InlineText({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={`block min-w-0 max-w-[7.5rem] truncate ${className}`}>
      {children}
    </span>
  )
}

export function JourneyTimelineHorizontal({ legs }: { legs: JourneyLeg[] }) {
  if (!legs || legs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-600 w-full">
        <div className="px-2 py-1 rounded font-medium text-gray-600 bg-gray-50 border-gray-200 border">
          Zug
        </div>
        <div className="flex-1 h-px bg-gray-300" />
      </div>
    )
  }

  // Chunk into rows
  const chunks: JourneyLeg[][] = []
  for (let i = 0; i < legs.length; i += MAX_SEGMENTS_PER_ROW) {
    chunks.push(legs.slice(i, i + MAX_SEGMENTS_PER_ROW))
  }

  const topRowHeight = "h-8"
  const textSize = "text-xs"

  return (
    <div className="w-full min-w-0 space-y-2">
      {chunks.map((chunk, chunkIdx) => {
        const isLastChunk = chunkIdx === chunks.length - 1
        const chunkStartIdx = chunkIdx * MAX_SEGMENTS_PER_ROW

        return (
          <div key={chunkIdx} className="flex min-w-0 items-start">
            {chunk.map((leg, idx) => {
              const globalIdx = chunkStartIdx + idx
              const vehicleStyle = getVehicleTypeStyle(leg.verkehrsmittel?.produktGattung)
              const isFirst = globalIdx === 0
              const isLast = globalIdx === legs.length - 1
              const nextLeg = !isLast ? legs[globalIdx + 1] : null
              const transferTime = nextLeg
                ? calculateTransferTime(leg.ankunftsZeitpunkt, nextLeg.abfahrtsZeitpunkt)
                : null
              const transferStyle = transferTime !== null ? getTransferTimeStyle(transferTime) : null
              const duration = legDuration(leg.abfahrtsZeitpunkt, leg.ankunftsZeitpunkt)
              const isLastInChunk = idx === chunk.length - 1

              return (
                <React.Fragment key={idx}>
                  {/* Start station (first of each chunk) */}
                  {(isFirst || (chunkIdx > 0 && idx === 0)) && (
                    <div className="flex min-w-0 flex-col text-center flex-shrink-0">
                      <div className={`${topRowHeight} flex items-center justify-center px-1`}>
                        <InlineText className={`font-semibold text-gray-800 ${textSize}`}>
                          {leg.abfahrtsOrt}
                        </InlineText>
                      </div>
                      <div className={`font-semibold text-gray-800 ${textSize} mt-1`}>
                        {fmtTime(leg.abfahrtsZeitpunkt)}
                      </div>
                    </div>
                  )}

                  {/* Line */}
                  <div className="min-w-3 flex-1 flex flex-col px-1">
                    <div className={`${topRowHeight} flex items-center`}>
                      <div className="w-full h-px bg-gray-400" />
                    </div>
                    <div className={`${textSize} mt-1 invisible`}>-</div>
                  </div>

                  {/* Vehicle badge + duration */}
                  <div className="flex min-w-0 flex-col text-center flex-shrink-0">
                    <div className={`${topRowHeight} flex items-center justify-center`}>
                      <div
                        className={`max-w-[5.75rem] truncate px-2 py-1 rounded font-semibold ${textSize} ${vehicleStyle.color} ${vehicleStyle.bg} ${vehicleStyle.border} border whitespace-nowrap shadow-sm`}
                      >
                        {vehicleLabel(leg)}
                      </div>
                    </div>
                    <div className={`${textSize} text-gray-500 whitespace-nowrap mt-1`}>{duration}</div>
                  </div>

                  {/* Line */}
                  <div className="min-w-3 flex-1 flex flex-col px-1">
                    <div className={`${topRowHeight} flex items-center`}>
                      <div className="w-full h-px bg-gray-400" />
                    </div>
                    <div className={`${textSize} mt-1 invisible`}>-</div>
                  </div>

                  {/* Arrival / transfer station */}
                  <div className="flex min-w-0 flex-col text-center flex-shrink-0">
                    <div className={`${topRowHeight} flex items-center justify-center px-1`}>
                      <InlineText className={`font-semibold text-gray-800 ${textSize}`}>
                        {leg.ankunftsOrt}
                      </InlineText>
                    </div>
                    <div className={`font-semibold text-gray-800 ${textSize} mt-1`}>
                      {!isLast && transferTime !== null && transferStyle ? (
                        isLastInChunk && !isLastChunk ? (
                          // End of a non-final chunk row: just show arrival time
                          <span className={`font-semibold ${textSize}`}>
                            {fmtTime(leg.ankunftsZeitpunkt)}
                          </span>
                        ) : (
                          // Mid-journey transfer: arr | badge | dep
                          <div className={`flex flex-wrap items-center gap-1 justify-center ${textSize}`}>
                            <span className={`font-semibold text-gray-600 ${textSize}`}>
                              {fmtTime(leg.ankunftsZeitpunkt)}
                            </span>
                            <div
                              className={`px-1.5 py-0.5 rounded-full ${transferStyle.bg} ${transferStyle.text} font-medium text-[10px] flex items-center gap-0.5 shadow-sm border ${transferStyle.border}`}
                            >
                              <Clock className="h-2 w-2" />
                              {transferTime}min
                            </div>
                            <span className={`font-semibold text-gray-600 ${textSize}`}>
                              {fmtTime(nextLeg!.abfahrtsZeitpunkt)}
                            </span>
                          </div>
                        )
                      ) : (
                        <span className={`font-semibold ${textSize}`}>
                          {fmtTime(leg.ankunftsZeitpunkt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Row-continue arrow (end of non-final chunk) */}
                  {isLastInChunk && !isLastChunk && (
                    <div className="flex-1 flex flex-col px-1">
                      <div className={`${topRowHeight} flex items-center justify-center`}>
                        <ArrowRight className="h-4 w-4 text-gray-400" />
                      </div>
                      <div className={`${textSize} mt-1 text-center text-gray-400`}>weiter</div>
                    </div>
                  )}
                </React.Fragment>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
