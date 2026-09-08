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
  [key: string]: any;
}

export async function dispatchCoreTelemetry(env: Env, eventType: string, payload: TelemetryPayload, traceId?: string) {
  const structuredPayload = {
    timestamp: payload.timestamp || new Date().toISOString(),
    rayId: payload.rayId || 'unknown',
    clientIp: payload.clientIp || 'unknown',
    colo: payload.colo || 'unknown',
    country: payload.country || 'unknown',
    action: payload.action || eventType,
    latencyMs: payload.latencyMs || payload.duration || 0,
    statusCode: payload.statusCode || 200,
    ...payload,
  };

  try {
    const logData = {
      app_id: 'axim-passport-sso',
      event_type: eventType,
      timestamp: structuredPayload.timestamp,
      payload: structuredPayload,
      trace_id: traceId,
    };

    // Fallback structured logger
    console.log(JSON.stringify(logData));

    // Cloudflare Analytics Engine
    if (env.ANALYTICS) {
       env.ANALYTICS.writeDataPoint({
         blobs: [
           structuredPayload.action,
           structuredPayload.colo,
           structuredPayload.country,
           traceId || ''
         ],
         doubles: [
           structuredPayload.latencyMs,
           structuredPayload.statusCode
         ],
         indexes: [structuredPayload.rayId]
       });
    }

    const url = `${env.AXIM_CORE_API_URL}/api/v1/telemetry/micro-app`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axim-Signature': env.AXIM_INTERNAL_KEY,
      },
      body: JSON.stringify(logData),
    });
  } catch (err) {
    // silently fail
  }
}
