type LogLevel = "debug" | "info" | "warn" | "error"
type LogContext = Record<string, unknown>

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T/

function pad(value: number): string {
  return value.toString().padStart(2, "0")
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${pad(day)}.${pad(month)}.${year}`
}

export function formatLogDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return ""
  }

  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    return formatDateParts(year, month, day)
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

export function formatLogDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return ""
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return `${formatLogDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function shouldFormatAsDate(key: string, value: unknown): boolean {
  if (value instanceof Date) {
    return true
  }

  if (typeof value === "number") {
    const lowerKey = key.toLowerCase()
    return lowerKey.endsWith("at") || lowerKey.endsWith("timestamp")
  }

  return typeof value === "string" && (ISO_DATE_RE.test(value) || ISO_DATE_TIME_RE.test(value))
}

function formatContextValue(key: string, value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (shouldFormatAsDate(key, value)) {
    return typeof value === "string" && ISO_DATE_TIME_RE.test(value)
      ? formatLogDateTime(value)
      : formatLogDate(value as Date | string | number)
  }
  if (value instanceof Error) return value.message
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function serializeContext(context?: LogContext): string {
  if (!context) return ""

  const entries = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatContextValue(key, value)}`)

  return entries.length > 0 ? ` | ${entries.join(" ")}` : ""
}

function writeLog(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  const line = `[${formatLogDateTime(new Date())}] [${level.toUpperCase()}] [${scope}] ${message}${serializeContext(context)}`

  if (level === "error") {
    console.error(line)
  } else if (level === "warn") {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export function logDebug(scope: string, message: string, context?: LogContext): void {
  if (process.env.LOG_LEVEL === "debug") {
    writeLog("debug", scope, message, context)
  }
}

export function logInfo(scope: string, message: string, context?: LogContext): void {
  writeLog("info", scope, message, context)
}

export function logWarn(scope: string, message: string, context?: LogContext): void {
  writeLog("warn", scope, message, context)
}

export function logError(scope: string, message: string, error?: unknown, context?: LogContext): void {
  const errorContext =
    error instanceof Error
      ? { error: error.message, ...context }
      : error
        ? { error, ...context }
        : context

  writeLog("error", scope, message, errorContext)
}
