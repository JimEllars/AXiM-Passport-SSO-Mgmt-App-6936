import { Env } from './index';
export async function dispatchCoreTelemetry(env: Env, eventType: string, payload: any, traceId?: string) {
  try {
    const url = `${env.AXIM_CORE_API_URL}/api/v1/telemetry/micro-app`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axim-Signature': env.AXIM_INTERNAL_KEY,
      },
      body: JSON.stringify({
        app_id: 'axim-passport-sso',
        event_type: eventType,
        timestamp: new Date().toISOString(),
        payload,
        trace_id: traceId,
      }),
    });
  } catch (err) {
    // silently fail
  }
}
