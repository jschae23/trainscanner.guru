// Shared component for displaying vehicle types summary with color-coded badges
import React from "react"
import { getVehicleTypeStyle } from "@/lib/utils"

export function VehicleTypesSummary({ interval }: { interval: any }) {
  if (!interval.abschnitte || interval.abschnitte.length === 0) {
    return <span className="text-xs text-gray-500">Zug</span>
  }

  const uniqueVehicles = Array.from(
    new Set(
      interval.abschnitte
        .map((a: any) => a.verkehrsmittel?.produktGattung)
        .filter(Boolean)
    )
  )

  if (uniqueVehicles.length === 0) {
    return <span className="text-xs text-gray-500">Zug</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {uniqueVehicles.map((produktGattung, idx) => {
        const vehicleStyle = getVehicleTypeStyle(produktGattung as string)
        const displayName = produktGattung === 'EC_IC' ? 'IC/EC' : produktGattung
        
        return (
          <span 
            key={idx}
            className={`text-xs px-1.5 py-0.5 rounded font-medium ${vehicleStyle.color} ${vehicleStyle.bg} ${vehicleStyle.border} border`}
          >
            {String(displayName)}
          </span>
        )
      })}
    </div>
  )
}