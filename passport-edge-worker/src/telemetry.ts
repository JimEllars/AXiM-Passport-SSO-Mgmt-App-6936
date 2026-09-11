import { Env } from './index';

interface TelemetryPayload {
  auth_latency_ms?: number;
  status_code?: number;
  turnstile_verification_result?: string;
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
    userIdHash: payload.userId ? (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.userId))).toString() : 'anonymous',
    tenantId: 'axim_core',
    userId: payload.userId || 'anonymous',
    clientId: payload.clientId || payload.clientAppId || 'axim-passport-sso',
    status: payload.status || (payload.statusCode ? payload.statusCode.toString() : '200'),
    latencyMs: payload.latencyMs || payload.duration || 0,
    cfRay: payload.rayId || 'unknown',

    eventType: eventType,
    durationMs: payload.latencyMs || payload.duration || 0,
    errorCode: payload.errorCode || (payload.statusCode && payload.statusCode >= 400 ? payload.statusCode.toString() : ''),
    userAgentHash: payload.userAgent ? (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.userAgent))).toString() : 'unknown',
    ipCountry: payload.country || 'unknown',
    xCorrelationId: payload.correlationId || traceId || '',

    rayId: payload.rayId || 'unknown',
    clientIp: payload.clientIp || 'unknown',
    colo: payload.colo || 'unknown',
    action: payload.action || eventType,
    statusCode: payload.statusCode || 200,
    ...payload,
  };

  try {
    const logData = {
      timestamp: structuredPayload.timestamp,
      environment: structuredPayload.environment,
      eventType: eventType,
      userIdHash: structuredPayload.userIdHash,
      tenantId: structuredPayload.tenantId,
      durationMs: structuredPayload.durationMs,
      status: structuredPayload.status,
      errorCode: structuredPayload.errorCode,
      userAgentHash: structuredPayload.userAgentHash,
      ipCountry: structuredPayload.ipCountry,
      userId: structuredPayload.userId,
      clientId: structuredPayload.clientId,
      latencyMs: structuredPayload.latencyMs,
      cfRay: structuredPayload.cfRay,
      app_id: 'axim-passport-sso',
      payload: structuredPayload,
      trace_id: traceId,
      correlation_id: structuredPayload.xCorrelationId,
    };


    try {
      if (env.PASSPORT_ANALYTICS && typeof env.PASSPORT_ANALYTICS.writeDataPoint === 'function') {
          env.PASSPORT_ANALYTICS.writeDataPoint({
              blobs: [
                  eventType,
                  structuredPayload.userIdHash,
                  structuredPayload.tenantId,
                  structuredPayload.status,
                  structuredPayload.errorCode,
                  structuredPayload.userAgentHash,
                  structuredPayload.ipCountry,
                  structuredPayload.xCorrelationId,
                  traceId || ''
              ],
              doubles: [
                  structuredPayload.durationMs
              ],
              indexes: [structuredPayload.cfRay]
          });
      }
    } catch (e) {
      console.log(JSON.stringify({ type: 'analytics_error', error: (e as Error).message, data: logData }));
    }

    try {
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
    } catch (e) {
      console.log(JSON.stringify({ type: 'analytics_error', error: (e as Error).message, data: logData }));
    }

    if (!env.PASSPORT_ANALYTICS && !env.ANALYTICS) {
       console.log(JSON.stringify(logData));
    }

    try {
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
    } catch (e) {
       // Silent catch for external API failure
    }
  } catch (err) {
    // Top level failsafe
    console.log(JSON.stringify({ error: (err as Error).message, originalEventType: eventType }));
  }
}
