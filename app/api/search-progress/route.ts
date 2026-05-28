import { NextRequest, NextResponse } from "next/server"
import { globalRateLimiter } from "@/app/api/search-prices/rate-limiter"
import { logDebug, logError } from "@/lib/shared/logger"

const LOG_SCOPE = "search-progress"

// In-Memory Storage für Progress-Daten
const progressStorage = new Map<string, {
  currentDay: number
  totalDays: number
  currentDate: string
  isComplete: boolean
  uncachedDays?: number
  cachedDays?: number
  averageUncachedResponseTime?: number
  averageCachedResponseTime?: number
  queueSize?: number
  activeRequests?: number
  timestamp: number
  isActiveSearch?: boolean // Markiert aktive Suchen
}>()

// GET - Progress-Daten abrufen
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId')
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    const progressData = progressStorage.get(sessionId)
    
    if (!progressData) {
      // Default-Werte wenn noch keine Daten vorhanden
      return NextResponse.json({
        currentDay: 0,
        totalDays: 0,
        isComplete: false,
        estimatedTimeRemaining: 0,
        currentDate: "",
        queueSize: 0,
        activeRequests: 0
      })
    }

    const queueStatus = globalRateLimiter.getQueueStatus(sessionId)

    // Berechne Anzahl aktiver Suchanfragen (nicht abgeschlossene Sessions)
    const activeSearchCount = Array.from(progressStorage.values()).filter(
      session => !session.isComplete && (Date.now() - session.timestamp) < 30000 // Aktiv in letzten 30 Sekunden
    ).length

    // Berechne geschätzte verbleibende Zeit mit realistischer Logik
    let estimatedTimeRemaining = 0
    if (!progressData.isComplete) {
      const remainingDays = Math.max(0, progressData.totalDays - progressData.currentDay)
      const uncachedDays = progressData.uncachedDays || remainingDays
      
      if (uncachedDays > 0) {
        // Durchschnittliche API-Zeit pro Request (Sekunden)
        const avgApiTimeSec = Math.min((progressData.averageUncachedResponseTime || 1500) / 1000, 3)
        
        // Rate Limiter Parameter berücksichtigen
        const currentIntervalMs = Math.max(0, queueStatus.currentInterval || 1200)
        const sustainedIntervalSec = 2 // 30/min => mind. 2s Abstand
        const burstMax = 15 // bis zu 15 Requests im 1s-Burst
        
        let scheduleSeconds = 0
        let remaining = uncachedDays
        
        if (currentIntervalMs <= 1000) {
          // Anfangs-Burst mit 1s Abstand für bis zu 15 Requests
          const burstCount = Math.min(burstMax, remaining)
          scheduleSeconds += burstCount * 1
          remaining -= burstCount
          
          if (remaining > 0) {
            // Danach konservativ mit sustained 2s weiter
            scheduleSeconds += remaining * sustainedIntervalSec
          }
        } else if (currentIntervalMs < sustainedIntervalSec * 1000) {
          // Intervall < 2s: gehe konservativ von 2s aus
          scheduleSeconds += remaining * sustainedIntervalSec
        } else {
          // Aktuelles Intervall verwenden
          scheduleSeconds += remaining * (currentIntervalMs / 1000)
        }
        
        // Round-Robin Faktor: bei mehreren aktiven Suchen langsamer
        const totalUsers = Math.max(1, activeSearchCount)
        const roundRobinFactor = totalUsers > 1 ? Math.min(1 + (totalUsers - 1) * 0.25, 2.0) : 1.0
        scheduleSeconds *= roundRobinFactor
        
        // Abschluss-Puffer: durchschnittliche API-Laufzeit nach letztem Start
        scheduleSeconds += avgApiTimeSec
        
        // Grenzen setzen (1s bis 2 Minuten)
        estimatedTimeRemaining = Math.min(Math.max(Math.round(scheduleSeconds), 1), 120)
      } else if (remainingDays > 0) {
        // Nur gecachte Tage verbleibend - sehr schnell
        estimatedTimeRemaining = Math.min(remainingDays * 0.2, 5)
      }
    }

    return NextResponse.json({
      currentDay: progressData.currentDay,
      totalDays: progressData.totalDays,
      currentDate: progressData.currentDate,
      isComplete: progressData.isComplete,
      estimatedTimeRemaining,
      queueSize: progressData.queueSize || 0,
      activeRequests: progressData.activeRequests || 0,
      // Verwende tatsächlich aktive Suchanfragen statt Queue-Status
      totalUsers: activeSearchCount
    })

  } catch (error) {
    logError(LOG_SCOPE, "Could not read search progress", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST - Progress-Daten speichern
export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { sessionId } = data
    
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 })
    }

    // Speichere Progress-Daten
    progressStorage.set(sessionId, {
      ...data,
      timestamp: Date.now()
    })

    // Wenn die Suche abgeschlossen ist, markiere Session als beendet für den Rate Limiter
    if (data.isComplete) {
      // Session als abgeschlossen markieren, damit sie nicht mehr als aktiv gilt
      // Verwende die cancel-Funktion mit speziellem Grund für abgeschlossene Suchen
      globalRateLimiter.cancelSession(sessionId, 'search_completed')
      logDebug(LOG_SCOPE, "✅ Search session marked as completed", { sessionId })
    }

    // Nur wichtige Meilensteine loggen
    if (data.totalDays > 0 && (data.currentDay === 1 || data.currentDay === data.totalDays || data.currentDay % 10 === 0)) {
      logDebug(LOG_SCOPE, "📊 Search progress milestone updated", {
        sessionId,
        currentDay: data.currentDay,
        totalDays: data.totalDays,
        progressPercent: Math.round((data.currentDay / data.totalDays) * 100),
        currentDate: data.currentDate,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError(LOG_SCOPE, "Could not update search progress", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Cleanup alte Progress-Daten (älter als 1 Stunde)
setInterval(() => {
  const now = Date.now()
  const oneHour = 60 * 60 * 1000
  
  for (const [sessionId, data] of progressStorage.entries()) {
    if (now - data.timestamp > oneHour) {
      progressStorage.delete(sessionId)
      logDebug(LOG_SCOPE, "🧹 Old search progress data cleaned up", { sessionId })
    }
  }
}, 5 * 60 * 1000) // Cleanup alle 5 Minuten
