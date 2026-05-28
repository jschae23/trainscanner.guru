import { NextRequest, NextResponse } from "next/server"
import { metricsCollector } from "./collector"
import IPCIDR from 'ip-cidr';
import { logError, logInfo, logWarn } from "@/lib/shared/logger";

const LOG_SCOPE = "metrics"

// Security: List of allowed IPs (from ENV, comma separated)
const ALLOWED_METRICS_IPS = process.env.ALLOWED_METRICS_IPS
  ? process.env.ALLOWED_METRICS_IPS.split(',').map(ip => ip.trim()).filter(Boolean)
  : null;

// Security: API Key from environment (checked at runtime)
const getMetricsApiKey = () => process.env.METRICS_API_KEY;

function isIPAllowed(ip: string): boolean {
  if (!ip) return false;
  if (!ALLOWED_METRICS_IPS || ALLOWED_METRICS_IPS.length === 0) return false;

  // Normalize IPv6-mapped IPv4 addresses
  let checkIp = ip;
  if (ip.startsWith('::ffff:')) {
    checkIp = ip.replace('::ffff:', '');
    if (ALLOWED_METRICS_IPS.includes(checkIp)) return true;
  }

  // Exact matches
  if (ALLOWED_METRICS_IPS.includes(checkIp)) return true;

  // CIDR support
  for (const allowed of ALLOWED_METRICS_IPS) {
    if (allowed.includes('/')) {
      const cidr = new IPCIDR(allowed);
      if (cidr.contains(checkIp)) return true;
    }
  }

  return false;
}

function getClientIP(request: NextRequest): string {
  // Try various headers to get real IP
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfIP = request.headers.get('cf-connecting-ip')

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  if (realIP) return realIP
  if (cfIP) return cfIP

  // Fallback to localhost if IP is not available
  return '127.0.0.1'
}

// Erfolgreiche Zugriffe pro Minute zählen
let successfulMetricsRequests = 0;
setInterval(() => {
  if (successfulMetricsRequests > 0) {
    logInfo(LOG_SCOPE, "Metrics endpoint access summary", {
      successfulRequestsLastMinute: successfulMetricsRequests,
    });
    successfulMetricsRequests = 0;
  }
}, 60 * 1000);

export async function GET(request: NextRequest) {
  try {
    // Security Check 1: API Key
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    const urlKey = new URL(request.url).searchParams.get('key')
    
    const providedKey = authHeader?.replace('Bearer ', '') || apiKey || urlKey
    const requiredKey = getMetricsApiKey()
    
    // Wenn kein API Key konfiguriert ist, Endpoint deaktivieren
    if (!requiredKey) {
      logWarn(LOG_SCOPE, "Metrics endpoint disabled because METRICS_API_KEY is not configured")
      return NextResponse.json(
        { error: "Metrics endpoint is disabled - API key not configured" }, 
        { status: 503 }
      )
    }
    
    if (!providedKey || providedKey !== requiredKey) {
      logWarn(LOG_SCOPE, "Unauthorized metrics access attempt", {
        providedKeyPrefix: providedKey ? `${providedKey.slice(0, 10)}...` : "missing",
      })
      return NextResponse.json(
        { error: "Unauthorized - Invalid API key" }, 
        { status: 401 }
      )
    }

    // Security Check 2: IP Address
    const clientIP = getClientIP(request)
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    if (!isDevelopment && !isIPAllowed(clientIP)) {
      logWarn(LOG_SCOPE, "Metrics access denied for client IP", {
        clientIP,
      })
      return NextResponse.json(
        { error: "Forbidden - IP not allowed" }, 
        { status: 403 }
      )
    }

    // Erfolgreiche Zugriffe zählen (nur bei Erfolg)
    successfulMetricsRequests++;

    // Determine response format
    const accept = request.headers.get('accept')
    const format = new URL(request.url).searchParams.get('format')
    
    const wantsPrometheus = accept?.includes('text/plain') || 
                           format === 'prometheus' || 
                           format === 'prom'

    // DEBUG: Output pretty JSON if format=debug
    if (format === 'debug') {
      const debugMetrics = JSON.stringify(metricsCollector.getMetricsJSON(), null, 2)
      return new Response(debugMetrics, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
    }

    if (wantsPrometheus) {
      // Return Prometheus format
      const prometheusMetrics = metricsCollector.exportPrometheusMetrics()
      
      return new Response(prometheusMetrics, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
    } else {
      // Return JSON format
      const jsonMetrics = metricsCollector.getMetricsJSON()
      
      return NextResponse.json(jsonMetrics, {
        status: 200,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      })
    }

  } catch (error) {
    logError(LOG_SCOPE, "Metrics GET endpoint failed", error)
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    )
  }
}

// POST endpoint for external metrics submission (optional)
export async function POST(request: NextRequest) {
  try {
    // Same security checks
    const authHeader = request.headers.get('authorization')
    const apiKey = request.headers.get('x-api-key')
    
    const providedKey = authHeader?.replace('Bearer ', '') || apiKey
    const requiredKey = getMetricsApiKey()
    
    if (!requiredKey) {
      return NextResponse.json(
        { error: "Metrics endpoint is disabled - API key not configured" }, 
        { status: 503 }
      )
    }
    
    if (!providedKey || providedKey !== requiredKey) {
      return NextResponse.json(
        { error: "Unauthorized" }, 
        { status: 401 }
      )
    }

    const clientIP = getClientIP(request)
    const isDevelopment = process.env.NODE_ENV === 'development'
    
    if (!isDevelopment && !isIPAllowed(clientIP)) {
      return NextResponse.json(
        { error: "Forbidden" }, 
        { status: 403 }
      )
    }

    // Accept custom metrics from external sources
    const body = await request.json()
    
    if (body.type === 'increment_counter' && body.name && typeof body.value === 'number') {
      metricsCollector.incrementCounter(body.name, body.value, body.labels)
      return NextResponse.json({ success: true })
    }
    
    if (body.type === 'set_gauge' && body.name && typeof body.value === 'number') {
      metricsCollector.setGauge(body.name, body.value, body.labels)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: "Invalid metric data" }, 
      { status: 400 }
    )

  } catch (error) {
    logError(LOG_SCOPE, "Metrics POST endpoint failed", error)
    return NextResponse.json(
      { error: "Internal server error" }, 
      { status: 500 }
    )
  }
}
