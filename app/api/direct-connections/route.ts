import { NextResponse } from "next/server"
import { logError } from "@/lib/shared/logger"
import { getDirectConnectionsDb, readOverviewJson } from "./direct-connections-db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LOG_SCOPE = "direktverbindungen.data"

export async function GET() {
  try {
    const database = await getDirectConnectionsDb()
    const overviewJson = readOverviewJson(database)

    return new NextResponse(overviewJson, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    })
  } catch (error) {
    logError(LOG_SCOPE, "Direct connections data unavailable", error)
    return NextResponse.json(
      { error: "Direct connections data unavailable" },
      { status: 503 }
    )
  }
}
