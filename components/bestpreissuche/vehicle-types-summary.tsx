// Shared component for displaying vehicle types summary with color-coded badges
import React from "react"

// Helper function to get vehicle type icon/color
function getVehicleTypeStyle(produktGattung?: string) {
  switch (produktGattung) {
    case 'ICE':
      return { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
    case 'EC_IC':
    case 'IC':
    case 'EC':
      return { color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
    case 'IR':
    case 'REGIONAL':
      return { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' }
    case 'SBAHN':
      return { color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' }
    case 'BUS':
      return { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
    default:
      return { color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' }
  }
}

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