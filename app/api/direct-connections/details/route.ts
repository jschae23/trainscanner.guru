import { NextRequest, NextResponse } from "next/server"
import { gunzipSync } from "zlib"
import Database from "better-sqlite3"
import { logError } from "@/lib/shared/logger"
import { getDirectConnectionsDb } from "../direct-connections-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LOG_SCOPE = "direktverbindungen.details"
const MAX_DAYS = 30

interface DetailsIndex {
  schemaVersion: number
  generatedAt: string
  version: string
  serviceDates: string[]
}

interface DetailPattern {
  d: string
  dep: string
  arr: string
  dur: number
  line?: string | null
  product: "longDistance" | "regional"
}

interface OriginDetails {
  originId: string
  connections: Record<string, DetailPattern[]>
}

function isSafeStationId(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9_.:-]+$/.test(value))
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function todayDateKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function timeSortValue(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2})(?:\+(\d+))?$/)
  if (!match) return Number.MAX_SAFE_INTEGER
  return (Number(match[3] ?? 0) * 24 + Number(match[1])) * 60 + Number(match[2])
}

function readIndex(database: Database.Database): DetailsIndex {
  const rows = database
    .prepare("SELECT key, value FROM metadata")
    .all() as Array<{ key: string; value: string }>
  const metadata = Object.fromEntries(rows.map(row => [row.key, row.value]))

  return {
    schemaVersion: Number(metadata.schemaVersion),
    generatedAt: metadata.generatedAt,
    version: metadata.version,
    serviceDates: JSON.parse(metadata.serviceDates ?? "[]"),
  }
}

function readOriginDetails(database: Database.Database, originId: string): OriginDetails | null {
  const row = database
    .prepare("SELECT data_compressed FROM origin_details WHERE origin_id = ?")
    .get(originId) as { data_compressed: Buffer } | undefined
  if (!row) return null

  return JSON.parse(gunzipSync(row.data_compressed).toString("utf-8")) as OriginDetails
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from")
  const to = request.nextUrl.searchParams.get("to")

  if (!isSafeStationId(from) || !isSafeStationId(to)) {
    return NextResponse.json({ error: "from and to station ids required" }, { status: 400 })
  }

  try {
    const database = await getDirectConnectionsDb()
    const index = readIndex(database)
    const details = readOriginDetails(database, from)
    if (!details) {
      return NextResponse.json({ error: "No detail data for origin" }, { status: 404 })
    }

    const patterns = details.connections[to] ?? []
    if (patterns.length === 0) {
      return NextResponse.json({ error: "No direct connection details for relation" }, { status: 404 })
    }

    const start = request.nextUrl.searchParams.get("start") || todayDateKey()
    const startDate = parseDateOnly(start)
    const availableDates = index.serviceDates
      .filter((dateKey) => parseDateOnly(dateKey) >= startDate)
      .slice(0, MAX_DAYS)

    const dayMap = new Map(
      availableDates.map((dateKey) => [
        dateKey,
        {
          date: dateKey,
          departures: [] as Array<{
            departure: string
            arrival: string
            duration: number
            line?: string | null
            product: "longDistance" | "regional"
          }>,
        },
      ])
    )

    patterns.forEach((pattern) => {
      const mask = BigInt(`0x${pattern.d}`)
      availableDates.forEach((dateKey) => {
        const dateIndex = index.serviceDates.indexOf(dateKey)
        if (dateIndex < 0 || (mask & (BigInt(1) << BigInt(dateIndex))) === BigInt(0)) return
        dayMap.get(dateKey)?.departures.push({
          departure: pattern.dep,
          arrival: pattern.arr,
          duration: pattern.dur,
          line: pattern.line ?? null,
          product: pattern.product,
        })
      })
    })

    const days = Array.from(dayMap.values())
      .map((day) => ({
        ...day,
        departures: day.departures.sort(
          (a, b) => timeSortValue(a.departure) - timeSortValue(b.departure) || a.duration - b.duration
        ),
      }))
      .filter((day) => day.departures.length > 0)

    const departureCount = days.reduce((sum, day) => sum + day.departures.length, 0)

    return NextResponse.json({
      from,
      to,
      generatedAt: index.generatedAt,
      version: index.version,
      horizonStart: availableDates[0] ?? null,
      horizonEnd: availableDates[availableDates.length - 1] ?? null,
      days,
      summary: {
        dayCount: days.length,
        departureCount,
      },
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "SQLITE_CANTOPEN") {
      return NextResponse.json(
        { error: "Direct connection detail data has not been generated yet" },
        { status: 404 }
      )
    }

    logError(LOG_SCOPE, "Could not load direct connection details", error, { from, to })
    return NextResponse.json({ error: "Could not load direct connection details" }, { status: 500 })
  }
}
