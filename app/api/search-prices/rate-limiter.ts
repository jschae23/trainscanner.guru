import { metricsCollector } from '@/app/api/metrics/collector'
import { logDebug, logInfo, logWarn } from '@/lib/shared/logger'

const LOG_SCOPE = "bahn-api.rate-limiter"

/* Globales Rate Limiting für alle API-Calls
Die Bahn-API hat strenge Limits, daher ist ein globales Rate Limiting notwendig.
Kurzzeitig eine hohe Anzahl an Requests möglich, aber danach antwortet die API schnell mit 429-Fehlern (Too Many Requests).
Daher beobachtet diese Funktion die letzten Requests und passt das Intervall dynamisch an, bei 429-Fehlern wird das Intervall auf bis zu 10 Sekunden erhöht.
Das Ziel ist es möglichst keine 429-Fehler zu erhalten, um die Performance zu optimieren.
Wir verwenden eine Round-Robin-Queue für Sessions, um Requests effizient zu verarbeiten.

*/
interface QueuedRequest {
  id: string
  sessionId?: string  // Session ID für Abbruch-Prüfung
  execute: () => Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  timestamp: number
}

class GlobalRateLimiter {
  private sessionQueues = new Map<string, QueuedRequest[]>() // Separate Queue pro Session
  private sessionRoundRobin: string[] = [] // Round-Robin Liste der Sessions
  private currentSessionIndex = 0 // Aktueller Index im Round-Robin
  private lastApiCallStart = 0 // Wann der letzte API-Call GESTARTET wurde
  private minInterval = 1000 // Adaptive: Startet bei 1.0 Sekunden zwischen API-Call STARTS
  private activeRequests = 0
  private readonly maxConcurrentRequests = 3 // Max 3 parallele Requests für bessere Performance
  
  // Interne Cancel-Session Verwaltung
  private cancelledSessions = new Set<string>() // Cancelled Sessions
  
  // Konfiguration - konsolidiert für bessere Wartbarkeit
  private readonly config = {
    baseInterval: 1000, // Basis-Intervall (1 Sekunde)
    burstInterval: 2000, // Nach Burst-Limit: min. 2 Sekunden
    burstLimitCount: 15, // Burst-Limit: 15 Requests (korrigiert von Kommentar)
    burstLimitWindow: 30 * 1000, // 30 Sekunden (reduziert für bessere Performance)
    sustainedInterval: Number(process.env.RL_SUSTAINED_INTERVAL_MS ?? 2000), // 2 Sekunden
    sustainedLimitCount: Number(process.env.RL_SUSTAINED_COUNT ?? 25), // 25 Requests in 60 Sekunden (reduziert)
    maxInterval: 6000, // Maximum 8 Sekunden (reduziert von 10s)
    maxRetries: 3,
    cleanupInterval: 15000, // 15 Sekunden (erhöht für weniger CPU-Last)
    sessionCancelTimeout: 3 * 60 * 1000, // 3 Minuten (reduziert)
    completedSessionTimeout: 30 * 1000 // 30 Sekunden (reduziert)
  }
  
  // Request-Tracking für DB-API Limits
  private requestHistory: number[] = [] // Timestamps der letzten Requests
  private processingTimer: ReturnType<typeof setTimeout> | null = null
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Starte regelmäßigen Cleanup abgebrochener Sessions
    this.cleanupTimer = setInterval(() => {
      this.cleanupCancelledSessions()
    }, this.config.cleanupInterval)
  }

  async addToQueue<T>(requestId: string, apiCall: () => Promise<T>, sessionId?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestId,
        sessionId,
        execute: apiCall,
        resolve,
        reject,
        timestamp: Date.now()
      }
      
      // Verwende 'default' als sessionId falls keine angegeben
      const effectiveSessionId = sessionId || 'default'
      
      // Erstelle Queue für Session falls nicht vorhanden
      if (!this.sessionQueues.has(effectiveSessionId)) {
        this.sessionQueues.set(effectiveSessionId, [])
        this.sessionRoundRobin.push(effectiveSessionId)
        logDebug(LOG_SCOPE, "Session added to round-robin queue", { sessionId: effectiveSessionId })
      }
      
      // Füge Request zur Session-Queue hinzu
      this.sessionQueues.get(effectiveSessionId)!.push(queuedRequest)
      
      const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
      logDebug(LOG_SCOPE, "Request queued", {
        requestId,
        sessionId: effectiveSessionId,
        queueSize: totalRequests,
        activeSessions: this.sessionQueues.size,
      })
      
      // Starte Verarbeitung falls noch nicht aktiv
      this.scheduleNextProcessing()
    })
  }

  private scheduleNextProcessing() {
    // Wenn bereits ein Timer läuft oder keine Anfragen in den Queues, mache nichts
    const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    if (this.processingTimer || totalRequests === 0 || this.activeRequests >= this.maxConcurrentRequests) {
      return
    }

    // Bestimme aktuelles Rate-Limit basierend auf Request-Historie
    this.updateRateLimit()

    // Berechne wann der nächste Request starten kann
    const now = Date.now()
    const timeSinceLastStart = now - this.lastApiCallStart
    const delay = Math.max(0, this.minInterval - timeSinceLastStart)

    logDebug(LOG_SCOPE, "Next request processing scheduled", {
      delayMs: delay,
      activeRequests: this.activeRequests,
      maxConcurrentRequests: this.maxConcurrentRequests,
      intervalMs: this.minInterval,
    })
    this.processingTimer = setTimeout(() => {
      this.processingTimer = null
      this.processNextRequest()
    }, delay)
  }

  private async processNextRequest() {
    // Prüfe ob wir verarbeiten können
    const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    if (totalRequests === 0 || this.activeRequests >= this.maxConcurrentRequests) {
      return
    }

    // Cleanup abgebrochene Sessions BEVOR wir Round-Robin machen
    this.cleanupCancelledSessions()

    // Round-Robin: Finde nächste Session mit Requests
    let request: QueuedRequest | null = null
    let attempts = 0
    const maxAttempts = this.sessionRoundRobin.length
    
    while (!request && attempts < maxAttempts) {
      // Cleanup: Entferne leere Sessions aus Round-Robin
      this.sessionRoundRobin = this.sessionRoundRobin.filter(sessionId => {
        const queue = this.sessionQueues.get(sessionId)
        if (!queue || queue.length === 0) {
          this.sessionQueues.delete(sessionId)
          return false
        }
        return true
      })
      
      // Wenn keine Sessions mehr vorhanden, beende
      if (this.sessionRoundRobin.length === 0) {
        return
      }
      
      // Normalisiere Index falls außerhalb des Bereichs
      if (this.currentSessionIndex >= this.sessionRoundRobin.length) {
        this.currentSessionIndex = 0
      }
      
      const currentSessionId = this.sessionRoundRobin[this.currentSessionIndex]
      const sessionQueue = this.sessionQueues.get(currentSessionId)
      
      if (sessionQueue && sessionQueue.length > 0) {
        // Prüfe Session-Abbruch BEVOR Request aus Queue genommen wird
        if (currentSessionId !== 'default' && this.isSessionCancelledSync(currentSessionId)) {
          // Entferne Session aus Round-Robin und Queue
          this.sessionQueues.delete(currentSessionId)
          this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== currentSessionId)
          if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
            this.currentSessionIndex = 0
          }
          attempts++
          continue
        }
        
        request = sessionQueue.shift()!
        logDebug(LOG_SCOPE, "Round-robin request selected", {
          sessionId: currentSessionId,
          remainingSessionRequests: sessionQueue.length,
        })
      }
      
      // Gehe zur nächsten Session
      this.currentSessionIndex = (this.currentSessionIndex + 1) % this.sessionRoundRobin.length
      attempts++
    }
    
    if (!request) {
      logWarn(LOG_SCOPE, "No queued request found during round-robin selection", { attempts })
      return
    }
    
    // Prüfe Session-Abbruch vor Ausführung (finale Prüfung)
    if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
      request.reject(new Error(`Session ${request.sessionId} was cancelled`))
      // Verarbeite nächsten Request
      this.scheduleNextProcessing()
      return
    }
    
    const totalRequestsAfter = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    logDebug(LOG_SCOPE, "API request started from queue", {
      requestId: request.id,
      queueSize: totalRequestsAfter,
      activeRequests: this.activeRequests,
    })
    
    // Setze Zeitstempel und erhöhe aktive Requests
    this.lastApiCallStart = Date.now()
    this.activeRequests++

    // Tracking für Rate Limit Logik
    this.trackRequest(this.lastApiCallStart)

    // Führe Request aus (async, damit wir den nächsten planen können)
    this.executeRequestWithRetry(request)
      .catch(() => { /* rejection handled via request.reject() */ })
      .finally(() => {
        this.activeRequests--
        const totalRequestsCompleted = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
        logDebug(LOG_SCOPE, "API request completed", {
          requestId: request!.id,
          queueSize: totalRequestsCompleted,
          activeRequests: this.activeRequests,
        })
        
        // Plane nächsten Request falls Queue nicht leer
        this.scheduleNextProcessing()
      })

    // Plane bereits den nächsten Request (falls vorhanden)
    this.scheduleNextProcessing()
  }

    // Vereinfachte Funktion: Cleanup abgebrochene Sessions (nur synchrone Prüfung)
  private cleanupCancelledSessions() {
    const sessionsToRemove: string[] = []
    
    // Prüfe alle Sessions auf Abbruch (nur synchron für bessere Performance im Dev-Modus)
    for (const sessionId of this.sessionQueues.keys()) {
      if (sessionId !== 'default' && this.isSessionCancelledSync(sessionId)) {
        sessionsToRemove.push(sessionId)
      }
    }
    
    // Entferne abgebrochene Sessions
    for (const sessionId of sessionsToRemove) {
      const queue = this.sessionQueues.get(sessionId)
      if (queue) {
        const requestCount = queue.length
        
        // Lehne alle Requests der Session ab
        for (const request of queue) {
          request.reject(new Error(`Session ${sessionId} was cancelled`))
        }
        
        // Entferne Session aus Maps und Round-Robin
        this.sessionQueues.delete(sessionId)
        this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
        
        // Adjustiere currentSessionIndex falls nötig
        if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
          this.currentSessionIndex = 0
        }
        
        logDebug(LOG_SCOPE, "Cancelled session removed from queue", {
          sessionId,
          rejectedRequests: requestCount,
        })
      }
    }
    
    if (sessionsToRemove.length > 0) {
      logDebug(LOG_SCOPE, "Cancelled sessions cleanup completed", {
        removedSessions: sessionsToRemove.length,
      })
    }
  }

  private async executeRequestWithRetry(request: QueuedRequest, retryCount = 0) {
    const maxRetries = this.config.maxRetries
    
    // Prüfe Session BEFORE executing request
    if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
      request.reject(new Error(`Session ${request.sessionId} was cancelled`))
      return
    }
    
    try {
      // Wrapper um request.execute() mit periodischer Session-Abbruch-Prüfung
      const executeWithCancellation = async () => {
        // Starte den ursprünglichen Request
        const requestPromise = request.execute().catch((e) => { 
          // Attach a catch immediately to avoid unhandledRejection logs, then rethrow
          throw e 
        })
        
        // Periodenprüfung ob Session abgebrochen wurde (alle 500ms)
        const checkCancellation = () => {
          return new Promise<never>((_, reject) => {
            const checkInterval = setInterval(() => {
              if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
                clearInterval(checkInterval)
                reject(new Error(`Session ${request.sessionId} was cancelled during execution`))
              }
            }, 500) // Alle 500ms prüfen
            
            // Cleanup wenn Request fertig ist
            requestPromise.finally(() => {
              clearInterval(checkInterval)
            })
          })
        }
        
        // Race zwischen Request und Cancellation Check
        return Promise.race([requestPromise, checkCancellation()])
      }
      
      const result: any = await executeWithCancellation()

      // Sentinel-Erkennung: request.execute() kann ein Objekt mit __httpStatus zurückgeben
      if (result && typeof result === 'object' && '__httpStatus' in result) {
        const status = Number((result as any).__httpStatus)
        const msg = (result as any).__errorText || ''

        if (status === 429) {
          logWarn(LOG_SCOPE, "Rate limit response received", {
            requestId: request.id,
            status,
          })
          // Sofort auf Max-Intervall springen
          this.onRateLimitHit(true)

          // Retry-Logik
          if (retryCount < maxRetries) {
            const retryDelay = this.calculateRetryDelay(retryCount)
            logInfo(LOG_SCOPE, "Request re-queued after rate limit response", {
              requestId: request.id,
              retryDelayMs: retryDelay,
              retryAttempt: retryCount + 1,
              maxRetries,
            })
            setTimeout(() => {
              if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
                request.reject(new Error(`Session ${request.sessionId} was cancelled`))
                return
              }
              const retryRequest: QueuedRequest = { ...request, timestamp: Date.now() }
              const effectiveSessionId = request.sessionId || 'default'
              if (!this.sessionQueues.has(effectiveSessionId)) {
                this.sessionQueues.set(effectiveSessionId, [])
                this.sessionRoundRobin.push(effectiveSessionId)
              }
              this.sessionQueues.get(effectiveSessionId)!.unshift(retryRequest)
              const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
              logDebug(LOG_SCOPE, "Rate-limited request reinserted at front of session queue", {
                requestId: request.id,
                sessionId: effectiveSessionId,
                queueSize: totalRequests,
              })
              this.scheduleNextProcessing()
            }, retryDelay)
            return
          } else {
            logWarn(LOG_SCOPE, "Request failed after rate limit retries", {
              requestId: request.id,
              maxRetries,
            })
            request.reject(new Error('HTTP 429'))
            return
          }
        }

        // Andere HTTP-Fehler-Sentinels: sauber ablehnen
        request.reject(new Error(`HTTP ${status}: ${msg}`))
        return
      }
      
      // Finale Session-Prüfung vor resolve
      if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
        request.reject(new Error(`Session ${request.sessionId} was cancelled`))
        return
      }
      
      // Erfolgreicher Request - Rate Limit kann langsam reduziert werden
      this.onRequestSuccess()
      request.resolve(result)
      
    } catch (error) {
      const isRateLimitError = error instanceof Error && 
        (error.message.includes('429') || error.message.includes('Too Many Requests'))
      
      if (isRateLimitError) {
        logWarn(LOG_SCOPE, "Rate limit error received", {
          requestId: request.id,
        })
        // Sofort auf Max-Intervall springen
        this.onRateLimitHit(true)
        
        // Retry bei 429-Fehlern - Request geht ZURÜCK in die Session-Queue
        if (retryCount < maxRetries) {
          const retryDelay = this.calculateRetryDelay(retryCount)
          logInfo(LOG_SCOPE, "Request re-queued after rate limit error", {
            requestId: request.id,
            retryDelayMs: retryDelay,
            retryAttempt: retryCount + 1,
            maxRetries,
          })
          
          setTimeout(() => {
            // Prüfe Session nochmal vor Re-Queue
            if (request.sessionId && this.isSessionCancelledSync(request.sessionId)) {
              request.reject(new Error(`Session ${request.sessionId} was cancelled`))
              return
            }
            
            // Erstelle neuen Request für Retry und füge ihn in die richtige Session-Queue GANZ VORNE ein
            const retryRequest: QueuedRequest = {
              ...request,
              timestamp: Date.now()
            }
            const effectiveSessionId = request.sessionId || 'default'
            if (!this.sessionQueues.has(effectiveSessionId)) {
              this.sessionQueues.set(effectiveSessionId, [])
              this.sessionRoundRobin.push(effectiveSessionId)
            }
            // GANZ VORNE einreihen (unshift)
            this.sessionQueues.get(effectiveSessionId)!.unshift(retryRequest)
            const totalRequests = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
            logDebug(LOG_SCOPE, "Rate-limited request reinserted at front of session queue", {
              requestId: request.id,
              sessionId: effectiveSessionId,
              queueSize: totalRequests,
            })
            this.scheduleNextProcessing()
          }, retryDelay)
          return
        } else {
          // Nach allen Retry-Versuchen - Request endgültig fehlgeschlagen (aber NICHT unhandled)
          logWarn(LOG_SCOPE, "Request failed after rate limit retries", {
            requestId: request.id,
            maxRetries,
          })
        }
      }
      
      // Alle Retries aufgebraucht oder anderer Fehler
      request.reject(error)
    }
  }

  private onRateLimitHit(forceMax: boolean = false) {
    // Sofort auf Max-Intervall springen, wenn gefordert
    const target = forceMax ? this.config.maxInterval : Math.min(this.minInterval * 1.5, this.config.maxInterval)
    
    logWarn(LOG_SCOPE, "Rate limit interval increased", {
      previousIntervalMs: this.minInterval,
      nextIntervalMs: Math.round(target),
    })
    this.minInterval = Math.round(target)
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private onRequestSuccess() {
    // Nach jedem erfolgreichen Request Intervall um 20% reduzieren, wenn über Basiswert
    if (this.minInterval > this.config.baseInterval) {
      const newInterval = Math.max(this.minInterval * 0.8, this.config.baseInterval)
      if (newInterval < this.minInterval) {
        logDebug(LOG_SCOPE, "Rate limit interval reduced after successful request", {
          previousIntervalMs: this.minInterval,
          nextIntervalMs: Math.round(newInterval),
        })
        this.minInterval = Math.round(newInterval)
      }
    }
    
    // Update metrics
    metricsCollector.updateRateLimitInterval(this.minInterval)
  }

  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 2s, 4s, 8s
    return Math.min(2000 * Math.pow(2, retryCount), 8000)
  }

  // Neue Methode: Request-Tracking für intelligente Rate-Limits
  private trackRequest(timestamp: number) {
    this.requestHistory.push(timestamp)
    
    // Behalte nur Requests der letzten 2 Minuten
    const twoMinutesAgo = timestamp - (2 * 60 * 1000)
    this.requestHistory = this.requestHistory.filter(t => t > twoMinutesAgo)
  }

  // Neue Methode: Intelligente Rate-Limit Bestimmung
  private updateRateLimit() {
    const now = Date.now()
    
    // Cleanup alte Requests aus Historie
    const twoMinutesAgo = now - (2 * 60 * 1000)
    this.requestHistory = this.requestHistory.filter(t => t > twoMinutesAgo)
    
    // Prüfe Burst-Limit innerhalb des Fensters (z.B. 15 in 30s)
    const burstAgo = now - this.config.burstLimitWindow
    const requestsInBurst = this.requestHistory.filter(t => t > burstAgo).length
    
    // Prüfe Sustained-Limit innerhalb von 60 Sekunden (z.B. 30 in 60s)
    const sixtySecondsAgo = now - (60 * 1000)
    const requestsIn60Seconds = this.requestHistory.filter(t => t > sixtySecondsAgo).length
    
    let targetInterval = this.minInterval // Start mit aktuellem Intervall
    let limitReason = ""
    
    // Sustained-Limit hat Priorität (strengeres Limit)
    if (requestsIn60Seconds >= this.config.sustainedLimitCount) {
      const threshold = this.config.sustainedInterval
      // Nur erhöhen, niemals senken bei Limits
      if (threshold > this.minInterval) {
        targetInterval = threshold
        limitReason = `Sustained limit: ${requestsIn60Seconds}/${this.config.sustainedLimitCount} requests in 60s`
      } else {
        // Bereits über dem Schwellenwert – nichts ändern
        logDebug(LOG_SCOPE, "Sustained limit reached; keeping current interval", {
          intervalMs: this.minInterval,
          thresholdMs: threshold,
          requestsIn60Seconds,
        })
        return
      }
    } else if (requestsInBurst >= this.config.burstLimitCount) {
      const threshold = this.config.burstInterval
      // Nur erhöhen, niemals senken bei Limits
      if (threshold > this.minInterval) {
        targetInterval = threshold
        const windowSec = Math.round(this.config.burstLimitWindow / 1000)
        limitReason = `Burst limit: ${requestsInBurst}/${this.config.burstLimitCount} requests in ${windowSec}s`
      } else {
        // Bereits über dem Schwellenwert – nichts ändern
        logDebug(LOG_SCOPE, "Burst limit reached; keeping current interval", {
          intervalMs: this.minInterval,
          thresholdMs: threshold,
          requestsInBurst,
        })
        return
      }
    } else {
      // Langsam zurück zum Basis-Intervall wenn unter den Limits
      if (this.minInterval > this.config.baseInterval) {
        targetInterval = Math.max(this.minInterval * 0.9, this.config.baseInterval)
        limitReason = "Slowly reducing interval"
      } else {
        // Kein Update nötig - bereits am Base-Intervall
        return
      }
    }
    
    // Update nur wenn sich etwas geändert hat (min. 50ms)
    if (Math.abs(targetInterval - this.minInterval) > 50) {
      logInfo(LOG_SCOPE, "Rate limit interval adjusted", {
        previousIntervalMs: this.minInterval,
        nextIntervalMs: Math.round(targetInterval),
        reason: limitReason,
        requestsInBurstWindow: requestsInBurst,
        burstWindowSeconds: Math.round(this.config.burstLimitWindow / 1000),
        requestsIn60Seconds,
        trackedRequests: this.requestHistory.length,
      })
      this.minInterval = Math.round(targetInterval)
      // Update metrics
      metricsCollector.updateRateLimitInterval(this.minInterval)
    }
  }

  // Prüfe ob Session abgebrochen wurde (synchrone Version bevorzugen)
  public isSessionCancelledSync(sessionId: string): boolean {
    return this.cancelledSessions.has(sessionId)
  }
  public cancelSession(sessionId: string, reason: string = 'user_request'): void {
    // Spezielle Behandlung für abgeschlossene Suchen - kein Cancel-Log
    if (reason === 'search_completed') {
      this.cancelledSessions.add(sessionId)
      
      // Entferne Session aus Queues ohne Logging (da erfolgreich abgeschlossen)
      const queue = this.sessionQueues.get(sessionId)
      if (queue && queue.length > 0) {
        // Lehne alle verbleibenden Requests ab (falls vorhanden)
        for (const request of queue) {
          request.reject(new Error(`Session ${sessionId} was completed`))
        }
        
        // Entferne Session komplett
        this.sessionQueues.delete(sessionId)
        this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
        
        if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
          this.currentSessionIndex = 0
        }
      }
      
      // Auto-cleanup nach 1 Minute (kürzer für completed sessions)
      setTimeout(() => {
        this.cancelledSessions.delete(sessionId)
      }, this.config.completedSessionTimeout)
      
      return
    }
    
    // Prüfe ob Session bereits als completed markiert wurde - dann ignoriere weitere Cancels
    if (this.cancelledSessions.has(sessionId)) {
      logDebug(LOG_SCOPE, "Duplicate session cancellation ignored", {
        sessionId,
        reason,
      })
      return
    }
    
    const logCancellation = reason === "user_request" ? logInfo : logDebug
    logCancellation(LOG_SCOPE, "🛑 Session cancellation requested", {
      sessionId,
      reason,
    })
    
    // Record metrics
    metricsCollector.recordSessionCancellation(reason)
    
    this.cancelledSessions.add(sessionId)
    
    // Sofort alle Requests dieser Session aus den Queues entfernen
    const queue = this.sessionQueues.get(sessionId)
    if (queue) {
      const requestCount = queue.length
      
      // Lehne alle wartenden Requests ab
      for (const request of queue) {
        request.reject(new Error(`Session ${sessionId} was cancelled`))
      }
      
      // Entferne Session komplett
      this.sessionQueues.delete(sessionId)
      this.sessionRoundRobin = this.sessionRoundRobin.filter(id => id !== sessionId)
      
      // Index anpassen
      if (this.currentSessionIndex >= this.sessionRoundRobin.length && this.sessionRoundRobin.length > 0) {
        this.currentSessionIndex = 0
      }
      
      logDebug(LOG_SCOPE, "Pending requests cancelled for session", {
        sessionId,
        cancelledRequests: requestCount,
      })
    }
    
    // Auto-cleanup nach 5 Minuten (nur für das cancelled-Set)
    setTimeout(() => {
      this.cancelledSessions.delete(sessionId)
      logDebug(LOG_SCOPE, "Cancelled session marker cleaned up", { sessionId })
    }, this.config.sessionCancelTimeout)
  }

  getQueueStatus(sessionId?: string) {
    // Berechne Gesamt-Queue-Größe über alle Sessions
    const totalQueueSize = Array.from(this.sessionQueues.values()).reduce((sum, queue) => sum + queue.length, 0)
    
    // Finde Position des Users in der Round-Robin Abarbeitung
    let ownPosition: number | null = null
    let sessionQueueSize = 0
    
    if (sessionId) {
      const sessionQueue = this.sessionQueues.get(sessionId)
      if (sessionQueue && sessionQueue.length > 0) {
        sessionQueueSize = sessionQueue.length
        
        // Schätze Position basierend auf Round-Robin
        // Position = Anzahl Sessions vor mir + meine eigene Position in der Session-Queue
        const sessionIndex = this.sessionRoundRobin.indexOf(sessionId)
        if (sessionIndex !== -1) {
          // Berechne wie viele Requests vor mir sind (Round-Robin Logik)
          const sessionsBeforeMe = sessionIndex < this.currentSessionIndex ? 
            (this.sessionRoundRobin.length - this.currentSessionIndex + sessionIndex) : 
            (sessionIndex - this.currentSessionIndex)
          
          ownPosition = sessionsBeforeMe // Erste eigene Anfrage ist nach X anderen Sessions dran
        }
      }
    }
    
    // Anzahl unterschiedlicher Sessions in den Queues
    const totalUsers = this.sessionQueues.size
    const hasOwnRequest = sessionQueueSize > 0
    
    // Geschätzte Wartezeit basierend auf Round-Robin
    const waitingRequests = ownPosition !== null ? ownPosition : 0
    const estimatedWaitTime = hasOwnRequest ? waitingRequests * (this.minInterval / 1000) : 0
    
    const result = {
      queueSize: totalQueueSize,
      activeRequests: this.activeRequests,
      lastApiCall: this.lastApiCallStart,
      currentInterval: this.minInterval,
      // Neue benutzerfreundliche Werte für Round-Robin
      waitingRequests, // Wie viele Sessions vor mir warten
      totalUsers, // Wie viele unterschiedliche Sessions in den Queues
      hasOwnRequest, // Ob ich überhaupt Requests in der Queue habe
      estimatedWaitTime, // Geschätzte Wartezeit in Sekunden
      sessionQueueSize, // Wie viele eigene Requests in der Queue sind
      sessionPosition: ownPosition // Position in der Round-Robin Liste
    }
    
    // Update queue metrics
    metricsCollector.updateQueueMetrics(
      result.queueSize,
      result.activeRequests,
      this.sessionQueues.size
    )
    
    return result
  }
}

// Globale Instanz des Rate Limiters
export const globalRateLimiter = new GlobalRateLimiter()
