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
  clientId?: string;
  route?: string;
  [key: string]: any;
}

export interface AuditEventPayload {
  traceId?: string;
  eventType: string;
  userId?: string;
  appId?: string;
  ipCountry?: string;
  status: string | number;
  [key: string]: any;
}

export function recordAuditEvent(c: { env: Env, executionCtx: ExecutionContext }, event: AuditEventPayload) {
  c.executionCtx.waitUntil((async () => {
    try {
      const timestamp = new Date().toISOString();
      const traceId = event.traceId || crypto.randomUUID();

      const payload = {
        timestamp,
        traceId,
        userId: event.userId || 'anonymous',
        appId: event.appId || 'axim-passport-sso',
        ipCountry: event.ipCountry || 'unknown',
        ...event
      };

      if (c.env.ANALYTICS && typeof c.env.ANALYTICS.writeDataPoint === 'function') {
        c.env.ANALYTICS.writeDataPoint({
          blobs: [
            payload.eventType,
            payload.userId,
            payload.appId,
            payload.ipCountry,
            payload.status.toString(),
            traceId
          ],
          doubles: [
            typeof payload.status === 'number' ? payload.status : (payload.status === 'success' ? 200 : 400)
          ],
          indexes: [traceId]
        });
      } else {
        console.info(JSON.stringify(payload));
      }
    } catch (e) {
      console.error(JSON.stringify({ type: 'audit_telemetry_error', error: (e as Error).message }));
    }
  })());
}

export async function dispatchCoreTelemetry(env: Env, eventType: string, payload: TelemetryPayload, traceId?: string) {
  const structuredPayload = {
    timestamp: payload.timestamp || new Date().toISOString(),
    environment: env.ENVIRONMENT || 'production',
    userIdHash: payload.userId ? (await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.userId))).toString() : 'anonymous',
    tenantId: 'axim_core',
    userId: payload.userId || 'anonymous',
    clientId: payload.clientId || payload.clientAppId || 'direct',
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
    route: payload.route || 'unknown',
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

    let telemetrySent = false;

    try {
      if (env.PASSPORT_ANALYTICS && typeof env.PASSPORT_ANALYTICS.writeDataPoint === 'function') {
          env.PASSPORT_ANALYTICS.writeDataPoint({
              indexes: [
                  eventType,
                  structuredPayload.clientId
              ],
              blobs: [
                  structuredPayload.route,
                  structuredPayload.statusCode.toString(),
                  structuredPayload.userId,
                  structuredPayload.ipCountry
              ],
              doubles: [
                  structuredPayload.durationMs,
                  structuredPayload.statusCode >= 400 ? 1 : 0
              ]
          });
          telemetrySent = true;
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


    if (!telemetrySent) {
       console.log(JSON.stringify({ type: 'telemetry_fallback', data: logData }));
    }

    // Diagnostic structured log requested by milestone
    const eventLog: any = {
      timestamp: structuredPayload.timestamp,
      request_id: traceId || structuredPayload.rayId,
      colo: structuredPayload.colo,
      status_code: structuredPayload.statusCode,
      event: eventType
    };

    // Add specific fields based on event type for Edge Telemetry
    if (eventType === 'AUTH_ATTEMPT') {
      eventLog.client_id = payload.clientId || payload.clientAppId;
      eventLog.origin = payload.origin;
      eventLog.user_agent = payload.userAgent;
      eventLog.flow_type = payload.flowType;
    } else if (eventType === 'AUTH_FAILURE') {
      eventLog.error_code = payload.errorCode || payload.statusCode;
      eventLog.reason = payload.reason;
      eventLog.origin = payload.origin;
    } else if (eventType === 'M2M_AGENT_ACCESS') {
      eventLog.key_id = payload.keyId || payload.agentId;
      eventLog.permissions = payload.scopes;
      eventLog.target_resource = payload.route || payload.targetResource;

      // Also log into audit_logs table
      try {
        if (env.DB) {
          await env.DB.prepare('INSERT INTO audit_logs (id, user_did, event, ip_address, user_agent, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), 'agent_' + (payload.agentId || 'unknown'), 'M2M_AGENT_ACCESS', structuredPayload.clientIp, 'agent', JSON.stringify({ scopes: payload.scopes, route: payload.route }), structuredPayload.timestamp)
            .run();
        }
      } catch (e) {
        console.error('Failed to log M2M access to D1', e);
      }
    } else if (eventType === 'FRONTEND_TELEMETRY' || eventType.startsWith('frontend.')) {
      eventLog.client_details = payload.details;

      try {
        if (env.DB) {
           await env.DB.prepare('INSERT INTO audit_logs (id, user_did, event, ip_address, user_agent, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), payload.userId || 'anonymous', eventType, structuredPayload.clientIp, payload.userAgent || 'unknown', JSON.stringify(payload), structuredPayload.timestamp)
            .run();
        }
      } catch (e) {
        console.error('Failed to log frontend telemetry to D1', e);
      }
    }

    console.log(JSON.stringify(eventLog));


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
