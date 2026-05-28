import { promises as fs } from "fs"
import path from "path"
import { gunzipSync } from "zlib"
import Database from "better-sqlite3"
import { logInfo, logWarn } from "@/lib/shared/logger"

const LOG_SCOPE = "direktverbindungen.db"
const REMOTE_DB_URL = "https://gitlab.com/jschae23/trainscanner.guru/-/raw/master/data/direct-connections.db"
const MAX_BYTES = 180 * 1024 * 1024
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 45_000

const DATA_DIR = path.join(process.cwd(), "data")
const CACHE_DB_FILE = path.join(DATA_DIR, "direct-connections.db")
const TEMP_DB_FILE = path.join(DATA_DIR, "direct-connections.db.tmp")
const BUNDLED_DB_FILE = path.join(process.cwd(), "public", "direct-connections.db")

let db: Database.Database | null = null
let dbPath: string | null = null
let refreshPromise: Promise<void> | null = null
let overviewJsonCache: string | null = null

function isHttpsAllowedRemote(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" &&
      parsed.hostname === "gitlab.com" &&
      parsed.pathname === "/jschae23/trainscanner.guru/-/raw/master/data/direct-connections.db"
  } catch {
    return false
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function activeDbPath(): Promise<string> {
  if (await fileExists(CACHE_DB_FILE)) return CACHE_DB_FILE
  return BUNDLED_DB_FILE
}

async function shouldRefreshCache(): Promise<boolean> {
  try {
    const stat = await fs.stat(CACHE_DB_FILE)
    return Date.now() - stat.mtimeMs > REFRESH_INTERVAL_MS
  } catch {
    return true
  }
}

function closeOpenDatabase() {
  if (db) {
    db.close()
    db = null
    dbPath = null
  }
  overviewJsonCache = null
}

async function downloadRemoteDb(): Promise<void> {
  if (!isHttpsAllowedRemote(REMOTE_DB_URL)) {
    throw new Error("Remote DB URL is not allowlisted")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(REMOTE_DB_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "trainscanner.guru direct-connections updater",
      },
    })

    if (!response.ok) {
      throw new Error(`Remote returned HTTP ${response.status}`)
    }

    const contentLength = response.headers.get("content-length")
    if (contentLength && Number(contentLength) > MAX_BYTES) {
      throw new Error(`Remote DB is too large: ${contentLength} bytes`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error("Remote response body is not readable")
    }

    await fs.mkdir(DATA_DIR, { recursive: true })
    const file = await fs.open(TEMP_DB_FILE, "w")
    let receivedBytes = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        receivedBytes += value.byteLength
        if (receivedBytes > MAX_BYTES) {
          throw new Error(`Remote DB exceeded ${MAX_BYTES} bytes`)
        }
        await file.write(value)
      }
    } finally {
      await file.close()
    }

    if (receivedBytes === 0) {
      throw new Error("Remote DB was empty")
    }

    closeOpenDatabase()
    await fs.rename(TEMP_DB_FILE, CACHE_DB_FILE)
    logInfo(LOG_SCOPE, "Direct connections DB refreshed", { bytes: receivedBytes })
  } finally {
    clearTimeout(timeout)
    try {
      await fs.unlink(TEMP_DB_FILE)
    } catch {}
  }
}

async function refreshCacheIfNeeded(): Promise<void> {
  if (!(await shouldRefreshCache())) return
  if (!refreshPromise) {
    refreshPromise = downloadRemoteDb().finally(() => {
      refreshPromise = null
    })
  }

  try {
    await refreshPromise
  } catch (error) {
    logWarn(LOG_SCOPE, "Could not refresh direct connections DB; serving fallback if available", {
      error: error instanceof Error ? error.message : error,
    })
  }
}

export async function getDirectConnectionsDb(): Promise<Database.Database> {
  await refreshCacheIfNeeded()

  const nextPath = await activeDbPath()
  if (!db || dbPath !== nextPath) {
    closeOpenDatabase()
    db = new Database(nextPath, { readonly: true, fileMustExist: true })
    dbPath = nextPath
  }

  return db
}

export function readOverviewJson(database: Database.Database): string {
  if (overviewJsonCache) return overviewJsonCache

  const row = database
    .prepare("SELECT data_compressed FROM main_data WHERE id = 1")
    .get() as { data_compressed: Buffer } | undefined
  if (!row) {
    throw new Error("Main direct connection data missing")
  }

  overviewJsonCache = gunzipSync(row.data_compressed).toString("utf-8")
  return overviewJsonCache
}
