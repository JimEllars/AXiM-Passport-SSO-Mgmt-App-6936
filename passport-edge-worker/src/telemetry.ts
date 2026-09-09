import { Env } from './index';

interface TelemetryPayload {
  action?: string;
  latencyMs?: number;
  statusCode?: number;
  clientIp?: string;
  colo?: string;
  country?: string;
  rayId?: string;
  timestamp?: string;
  auth_method?: string;
  status?: string;
  turnstile_passed?: boolean;
  userId?: string;
  clientAppId?: string;
  [key: string]: any;
}

export async function dispatchCoreTelemetry(env: Env, eventType: string, payload: TelemetryPayload, traceId?: string) {
  const structuredPayload = {
    timestamp: payload.timestamp || new Date().toISOString(),
    environment: env.ENVIRONMENT || 'production',
    userId: payload.userId || 'anonymous',
    clientAppId: payload.clientAppId || 'axim-passport-sso',
    status: payload.status || (payload.statusCode ? payload.statusCode.toString() : '200'),
    latencyMs: payload.latencyMs || payload.duration || 0,
    cfRay: payload.rayId || 'unknown',

    // Legacy fields mapped for backward compatibility
    rayId: payload.rayId || 'unknown',
    clientIp: payload.clientIp || 'unknown',
    colo: payload.colo || 'unknown',
    country: payload.country || 'unknown',
    action: payload.action || eventType,
    statusCode: payload.statusCode || 200,
    ...payload,
  };

  try {
    const logData = {
      timestamp: structuredPayload.timestamp,
      environment: structuredPayload.environment,
      userId: structuredPayload.userId,
      clientAppId: structuredPayload.clientAppId,
      status: structuredPayload.status,
      latencyMs: structuredPayload.latencyMs,
      cfRay: structuredPayload.cfRay,
      app_id: 'axim-passport-sso',
      event_type: eventType,
      payload: structuredPayload,
      trace_id: traceId,
    };

    // Fallback structured logger (Cloudflare Logpush compatible)
    console.log(JSON.stringify(logData));

    // Cloudflare Analytics Engine
    if (env.ANALYTICS && typeof env.ANALYTICS.writeDataPoint === 'function') {
       env.ANALYTICS.writeDataPoint({
         blobs: [
           structuredPayload.action,
           structuredPayload.colo,
           structuredPayload.country,
           traceId || '',
           structuredPayload.auth_method || '',
           structuredPayload.status || ''
         ],
         doubles: [
           structuredPayload.latencyMs,
           structuredPayload.statusCode,
           structuredPayload.turnstile_passed ? 1 : 0
         ],
         indexes: [structuredPayload.cfRay]
       });
    }

    if (env.AXIM_CORE_API_URL && env.AXIM_INTERNAL_KEY) {
      const url = `${env.AXIM_CORE_API_URL}/api/v1/telemetry/micro-app`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': env.AXIM_INTERNAL_KEY,
        },
        body: JSON.stringify(logData),
      });
    }
  } catch (err) {
    // silently fail
  }
}
