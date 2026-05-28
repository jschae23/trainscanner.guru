interface Trip {
  preis: number
  abfahrtsZeitpunkt: string
  ankunftsZeitpunkt: string
  abfahrtsOrt: string
  ankunftsOrt: string
  info: string
  umstiegsAnzahl?: number
  isCheapestPerInterval?: boolean
}

interface RecommendParams {
  alpha: number // Gewichtung Preis (0.6)
  beta: number  // Gewichtung Dauer (0.25)
  gamma: number // Gewichtung Umstiege (0.15)
  directPctTolerance: number // Toleranz für Direktverbindungen (0.10 = 10%)
  directMaxExtraPct: number  // Max Aufpreis für Direktverbindung (0.20 = 20%)
  nonDirectMaxExtraPct: number // Max Aufpreis für Nicht-Direkt (0.15 = 15%)
  nonDirectMinSavePct: number  // Min Zeitersparnis für teure Nicht-Direkt (0.15 = 15%)
}

interface TripWithDuration extends Trip {
  durationMin: number
  direct: boolean
}

interface ScoredTrip {
  trip: TripWithDuration
  priceNorm: number
  durNorm: number
  transPen: number
  directBonus: number
  score: number
  autopick: boolean
  durationMin: number
}

interface Recommendation {
  trip: TripWithDuration
  explanation: {
    reason: string
    priceNorm: number
    durNorm: number
    transPen: number
    directBonus: number
    score: number
    isDirect: boolean
    isAutopick: boolean
  }
}

// Standard-Profil für ausgewogene Empfehlungen
const DEFAULT_PROFILE: RecommendParams = {
  alpha: 0.45,              // 45% Preis (weniger preissensitiv)
  beta: 0.30,               // 30% Dauer
  gamma: 0.25,              // 25% Umstiege (Komfort)
  directPctTolerance: 0.15, // 15% längere Fahrt für Direktverbindung OK
  directMaxExtraPct: 0.40,  // Max 40% mehr für Direktverbindung
  nonDirectMaxExtraPct: 0.15, // Max 15% mehr für Nicht-Direkt
  nonDirectMinSavePct: 0.15 // Mind. 15% Zeitersparnis für teure Nicht-Direkt
}

const PRICE_EPS = 0.01;           // Preise gelten als "gleich", wenn innerhalb 1 Cent
const SMALL_DURATION_THRESHOLD = 15; // Minuten: unterhalb dessen schlagen weniger Umstiege minimale Zeitvorteile

function calculateDurationMinutes(trip: Trip): number {
  const dep = new Date(trip.abfahrtsZeitpunkt)
  const arr = new Date(trip.ankunftsZeitpunkt)
  return Math.round((arr.getTime() - dep.getTime()) / 60000)
}

function isDirect(trip: Trip): boolean {
  return (trip.umstiegsAnzahl || 0) === 0
}

// flachere, diskrete Umstiegsstrafe
function transferPenalty(k: number): number {
  if (k <= 0) return 0.00
  if (k === 1) return 0.10
  if (k === 2) return 0.25
  if (k === 3) return 0.35
  return 0.50
}

// Spezial-Tie-Breaker-Regel: gleicher Preis + kleine Zeitdifferenz → weniger Umstiege gewinnt
function preferFewerTransfersWhenSamePriceAndSmallTime(a: TripWithDuration, b: TripWithDuration): number | null {
  const samePrice = Math.abs(a.preis - b.preis) <= PRICE_EPS
  const smallTimeDiff = Math.abs(a.durationMin - b.durationMin) < SMALL_DURATION_THRESHOLD
  if (samePrice && smallTimeDiff) {
    const ua = a.umstiegsAnzahl || 0
    const ub = b.umstiegsAnzahl || 0
    if (ua !== ub) return ua - ub
  }
  return null
}

// Spezielle Funktion für Bestpreis-Auswahl: Wählt unter den günstigsten Fahrten die beste aus
export function recommendBestPrice(trips: Trip[]): Trip | null {
  if (trips.length === 0) return null
  
  // Zuerst alle Fahrten mit dem günstigsten Preis finden
  const minPrice = Math.min(...trips.map(t => t.preis))
  const cheapestTrips = trips.filter(t => t.preis === minPrice)
  
  if (cheapestTrips.length === 1) {
    return cheapestTrips[0]
  }
  
  // Unter den günstigsten Fahrten die beste auswählen basierend auf Dauer und Umstiege
  const tripsWithDuration = cheapestTrips.map(t => ({
    ...t,
    durationMin: calculateDurationMinutes(t),
    direct: isDirect(t)
  }))
  
  // Sortiere nach: 1. Direktverbindungen bevorzugen, 2. Kürzeste Dauer, 3. Früheste Abfahrt
  const sorted = tripsWithDuration.sort((a, b) => {
    // Direktverbindungen haben Priorität
    if (a.direct !== b.direct) {
      return a.direct ? -1 : 1
    }
    
    // Bei gleicher "Direktheit": nach Reisedauer sortieren
    if (a.durationMin !== b.durationMin) {
      return a.durationMin - b.durationMin
    }
    
    // Bei gleicher Dauer: nach Anzahl Umstiege
    const aTransfers = a.umstiegsAnzahl || 0
    const bTransfers = b.umstiegsAnzahl || 0
    if (aTransfers !== bTransfers) {
      return aTransfers - bTransfers
    }
    
    // Zuletzt: früheste Abfahrt bevorzugen
    return new Date(a.abfahrtsZeitpunkt).getTime() - new Date(b.abfahrtsZeitpunkt).getTime()
  })
  
  return sorted[0]
}

export function recommendOne(trips: Trip[], profile: RecommendParams = DEFAULT_PROFILE): Recommendation | null {
  if (trips.length === 0) return null
  
  // Dauer in Minuten berechnen für alle Trips
  const tripsWithDuration: TripWithDuration[] = trips.map(t => ({
    ...t,
    durationMin: calculateDurationMinutes(t),
    direct: isDirect(t)
  }))
  
  // Pareto-Front bestimmen
  const paretoFront: TripWithDuration[] = []
  for (const t of tripsWithDuration) {
    const dominated = tripsWithDuration.some(u => 
      u !== t &&
      u.preis <= t.preis && 
      u.durationMin <= t.durationMin && 
      (u.umstiegsAnzahl || 0) <= (t.umstiegsAnzahl || 0) &&
      (u.preis < t.preis || u.durationMin < t.durationMin || (u.umstiegsAnzahl || 0) < (t.umstiegsAnzahl || 0))
    )
    if (!dominated) paretoFront.push(t)
  }
  if (paretoFront.length === 0) return null
  
  // Normierungsbasen
  const minPrice = Math.min(...paretoFront.map(t => t.preis))
  const maxPrice = Math.max(...paretoFront.map(t => t.preis))
  const minDur = Math.min(...paretoFront.map(t => t.durationMin))
  const maxDur = Math.max(...paretoFront.map(t => t.durationMin))
  
  const priceSpan = Math.max(1e-9, maxPrice - minPrice)
  const durSpan = Math.max(1e-9, maxDur - minDur)
  
  // Scoring
  const scored: ScoredTrip[] = []
  for (const t of paretoFront) {
    const priceNorm = (t.preis - minPrice) / priceSpan
    const durNorm = (t.durationMin - minDur) / durSpan
    
    const transfers = t.umstiegsAnzahl || 0
    const transPen = transferPenalty(transfers)
    
    // Direct-Bonus
    const directBonus = (t.direct && t.durationMin <= (1 + profile.directPctTolerance) * minDur) ? -0.05 : 0.0
    
    const score = profile.alpha * priceNorm + profile.beta * durNorm + profile.gamma * transPen + directBonus
    
    // Autopick für sehr gute Direktverbindungen
    const minPriceTrip = paretoFront.find(trip => trip.preis === minPrice)
    const minPriceIsDirect = minPriceTrip?.direct || false
    
    let autopick = false
    if (t.direct) {
      if (!minPriceIsDirect) {
        // Günstigste Verbindung ist nicht direkt -> normale Direktverbindungs-Regeln
        autopick = t.preis <= minPrice * (1 + profile.directMaxExtraPct) && 
                   t.durationMin <= (1 + profile.directPctTolerance) * minDur
      } else {
        // Günstigste Verbindung ist bereits direkt -> viel strenger bewerten
        const timeSavedMin = minDur - t.durationMin
        const priceIncreasePercent = (t.preis - minPrice) / minPrice
        
        // Für Direktverbindung vs Direktverbindung: nur bei sehr gutem Zeit/Preis-Verhältnis
        if (t.preis <= minPrice * 1.10) {
          // Bis 10% Aufpreis: immer OK
          autopick = true
        } else if (timeSavedMin >= 60 && priceIncreasePercent <= 0.20) {
          // 11-20% Aufpreis: nur wenn mindestens 1 Stunde Zeitersparnis
          autopick = true
        } else if (timeSavedMin >= 90 && priceIncreasePercent <= 0.25) {
          // 21-25% Aufpreis: nur wenn mindestens 1,5 Stunden Zeitersparnis
          autopick = true
        }
        // Sonst: nicht als "optimal" bewerben
      }
    }
    
    // Guard gegen teure Nicht-Direkt ohne spürbare Zeiteinsparung
    let guardOk = true
    if (!t.direct) {
      const priceDiff = (t.preis - minPrice) / minPrice
      const savePct = (minDur - t.durationMin) / minDur
      // Zusätzlicher Guard: Ein weiterer Umstieg wird nur akzeptiert, wenn die Fahrt mind. 7% schneller ist
      const minDurationSavePct = 0.07 // 7%
      if ((t.umstiegsAnzahl || 0) > 2 && savePct < minDurationSavePct) {
        guardOk = false
      }
      if (priceDiff > profile.nonDirectMaxExtraPct && savePct < profile.nonDirectMinSavePct) {
        guardOk = false
      }
      // NEU: Bei jedem Aufpreis muss die Verbindung mindestens 5 Minuten schneller sein
      if (t.preis > minPrice && t.durationMin > minDur - 5) {
        guardOk = false
      }
    }
    
    // Zusätzlicher Guard: Dynamische Komfort-Aufpreisschwelle
    const maxAllowedPrice = minPrice * allowedComfortPriceFactor(minPrice)
    if (t.preis > maxAllowedPrice) {
      guardOk = false
    }
    
    if (guardOk) {
      scored.push({
        trip: t,
        priceNorm,
        durNorm,
        transPen,
        directBonus,
        score,
        autopick,
        durationMin: t.durationMin
      })
    }
  }
  if (scored.length === 0) return null

  // Vergleichsfunktion mit der neuen "gleiches Geld, wenig Zeit → weniger Umstiege" Regel
  const cmpWithHumanRule = (a: ScoredTrip, b: ScoredTrip): number => {
    // harte Regel zuerst
    const human = preferFewerTransfersWhenSamePriceAndSmallTime(a.trip, b.trip)
    if (human !== null && human !== 0) return human

    // sonst normale Sortierung
    // Score -> Umstiege -> Dauer -> Preis -> Abfahrt
    if (Math.abs(a.score - b.score) > 1e-9) return a.score - b.score
    const ua = a.trip.umstiegsAnzahl || 0
    const ub = b.trip.umstiegsAnzahl || 0
    if (ua !== ub) return ua - ub
    if (a.durationMin !== b.durationMin) return a.durationMin - b.durationMin
    if (Math.abs(a.trip.preis - b.trip.preis) > PRICE_EPS) return a.trip.preis - b.trip.preis
    return new Date(a.trip.abfahrtsZeitpunkt).getTime() - new Date(b.trip.abfahrtsZeitpunkt).getTime()
  }

  // Auswahl
  const autos = scored.filter(x => x.autopick)
  let winner: ScoredTrip
  let isAutopick = false
  
  if (autos.length > 0) {
    // Autopicks: Preis -> Dauer -> Umstiege -> Abfahrt, aber mit der neuen Regel davor
    const autoCmp = (a: ScoredTrip, b: ScoredTrip): number => {
      const human = preferFewerTransfersWhenSamePriceAndSmallTime(a.trip, b.trip)
      if (human !== null && human !== 0) return human
      if (Math.abs(a.trip.preis - b.trip.preis) > PRICE_EPS) return a.trip.preis - b.trip.preis
      if (a.durationMin !== b.durationMin) return a.durationMin - b.durationMin
      const ua = a.trip.umstiegsAnzahl || 0
      const ub = b.trip.umstiegsAnzahl || 0
      if (ua !== ub) return ua - ub
      return new Date(a.trip.abfahrtsZeitpunkt).getTime() - new Date(b.trip.abfahrtsZeitpunkt).getTime()
    }
    winner = autos.sort(autoCmp)[0]
    isAutopick = true
  } else {
    winner = scored.sort(cmpWithHumanRule)[0]
  }
  
  // Erklärung generieren
  let reason = ""
  if (isAutopick) {
    reason = "Optimale Direktverbindung mit gutem Preis-Leistungs-Verhältnis"
  } else {
    // falls die harte Regel gegriffen hat, Hinweis ergänzen
    const alt = scored.length > 1 ? scored[1] : null
    const humanApplied = alt
      ? preferFewerTransfersWhenSamePriceAndSmallTime(winner.trip, alt.trip) !== null
      : false
    if (humanApplied && Math.abs(winner.trip.preis - (alt?.trip.preis ?? winner.trip.preis)) <= PRICE_EPS) {
      reason = "Gleicher Preis, kaum Zeitunterschied – weniger Umstiege bevorzugt"
    } else if (winner.trip.direct) {
      reason = "Beste Direktverbindung im Verhältnis zu Preis und Reisezeit"
    } else if (winner.transPen <= 0.15) {
      reason = "Sehr gutes Verhältnis von Preis, Reisezeit und Umstieg"
    } else {
      reason = "Bester Kompromiss zwischen Preis, Reisezeit und Umstiegen"
    }
  }
  
  return {
    trip: winner.trip,
    explanation: {
      reason,
      priceNorm: winner.priceNorm,
      durNorm: winner.durNorm,
      transPen: winner.transPen,
      directBonus: winner.directBonus,
      score: winner.score,
      isDirect: winner.trip.direct,
      isAutopick
    }
  }
}

// Dynamische Komfort-Aufpreisschwelle je nach Preisniveau
function allowedComfortPriceFactor(minPrice: number): number {
  if (minPrice < 30) return 1.60 // bis zu 60% Aufpreis erlaubt
  if (minPrice < 60) return 1.40 // bis zu 40% Aufpreis erlaubt
  return 1.25 // ab 60€ nur noch 25% Aufpreis erlaubt
}
