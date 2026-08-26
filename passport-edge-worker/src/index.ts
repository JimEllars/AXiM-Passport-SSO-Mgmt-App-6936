import { EmailDispatchManager } from './emailService';

import { verifyMessage } from 'viem';

interface Env {
  EMAILIT_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_ALERT_EMAIL: string;
  ALLOWED_REDIRECT_ORIGINS: string;
  AUTH_STATE: DurableObjectNamespace;
  FRONTEND_ORIGINS: string;
  JWT_SECRET: string;
  PASSPORT_ORIGIN: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_URL: string;
  TURNSTILE_ACTION: string;
  TURNSTILE_SECRET_KEY: string;
  WALLET_CHAIN_ID: string;
  SECURITY_AUDIT_LOGS: KVNamespace;
}

interface AuthRecord {
  address?: string;
  chainId?: number;
  codeVerifier?: string;
  expiresAt: number;
  redirectUrl?: string;
}

interface TurnstileResult {
  action?: string;
  hostname?: string;
  success: boolean;
}

const encoder = new TextEncoder();
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' };
const ETHEREUM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HEX_SIGNATURE = /^0x[a-fA-F0-9]{130}$/;

export class AuthState implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const { operation, key, value } = await request.json<{ operation: string; key: string; value?: AuthRecord }>();

    if (operation === 'put' && value) {
      await this.state.storage.put(key, value);
      return new Response(null, { status: 204 });
    }

    if (operation === 'consume') {
      const record = await this.state.storage.get<AuthRecord>(key);
      if (!record || record.expiresAt < Date.now()) {
        await this.state.storage.delete(key);
        return Response.json({ record: null });
      }

      await this.state.storage.delete(key);
      return Response.json({ record });
    }

    return new Response('Invalid state operation', { status: 400 });
  }
}


async function sendUnauthorizedAlert(env: Env, ctx: ExecutionContext, identifier: string, method: string) {
  if (!env.EMAILIT_API_KEY || !env.RESEND_API_KEY || !env.ADMIN_ALERT_EMAIL) return;
  const emailService = new EmailDispatchManager(env.EMAILIT_API_KEY, env.RESEND_API_KEY);

  ctx.waitUntil(
    emailService.send({
      from: 'System Alerts <alerts@axim.us.com>',
      to: env.ADMIN_ALERT_EMAIL,
      subject: 'Unauthorized Access Attempt Blocked',
      text: `An unauthorized access attempt was blocked.\n\nMethod: ${method}\nIdentifier: ${identifier}`,
      html: `<p>An unauthorized access attempt was blocked.</p><p><strong>Method:</strong> ${method}<br/><strong>Identifier:</strong> ${identifier}</p>`,
    }).catch(console.error)
  );
}

function log(event: string, metadata: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...metadata }));
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function originFrom(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function approvedRedirect(env: Env, value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    const approvedOrigins = env.ALLOWED_REDIRECT_ORIGINS.split(',')
      .map((origin) => originFrom(origin.trim()))
      .filter((origin): origin is string => origin !== null);
    return url.protocol === 'https:' && approvedOrigins.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

function frontendOrigins(env: Env): string[] {
  return env.FRONTEND_ORIGINS.split(',')
    .map((origin) => originFrom(origin.trim()))
    .filter((origin): origin is string => origin !== null);
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });

  const origin = request.headers.get('Origin');
  if (origin && frontendOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...corsHeaders(request, env), ...JSON_HEADERS } });
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) return null;

  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function stateRequest(env: Env, operation: 'put' | 'consume', key: string, value?: AuthRecord): Promise<AuthRecord | null> {
  const id = env.AUTH_STATE.idFromName('global-auth-state');
  const response = await env.AUTH_STATE.get(id).fetch('https://auth-state.internal', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ operation, key, value }),
  });

  if (!response.ok) throw new Error('Authentication state is unavailable');
  if (operation === 'put') return null;
  return (await response.json<{ record: AuthRecord | null }>()).record;
}

async function verifyTurnstile(token: unknown, request: Request, env: Env): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) return false;

  const result = await response.json<TurnstileResult>();
  return result.success
    && result.action === env.TURNSTILE_ACTION
    && frontendOrigins(env).some((origin) => result.hostname === new URL(origin).hostname);
}

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

async function mintHandoffToken(subject: string, redirectUrl: string, env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: subject, aud: redirectUrl, iat: now, exp: now + 60, jti: crypto.randomUUID() }, env.JWT_SECRET);
}

async function codeChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
}

async function startWalletChallenge(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const { address, chainId, redirect, turnstileToken } = body;
  const redirectUrl = approvedRedirect(env, redirect);
  const requiredChainId = Number(env.WALLET_CHAIN_ID);

  if (!redirectUrl || typeof address !== 'string' || !ETHEREUM_ADDRESS.test(address) || chainId !== requiredChainId) {
    return json(request, env, { error: 'Invalid authentication request' }, 400);
  }
  if (!await verifyTurnstile(turnstileToken, request, env)) {
    return json(request, env, { error: 'Authentication could not be verified' }, 403);
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  await stateRequest(env, 'put', `wallet:${nonce}`, {
    address: address.toLowerCase(),
    chainId: requiredChainId,
    expiresAt: Date.now() + 5 * 60 * 1000,
    redirectUrl,
  });

  const passport = new URL(env.PASSPORT_ORIGIN);
  const message = `${passport.host} wants you to sign in with your Ethereum account:\n${address.toLowerCase()}\n\nSign in to AXiM Passport.\n\nURI: ${passport.origin}\nVersion: 1\nChain ID: ${requiredChainId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  log('wallet_challenge_created', { chainId: requiredChainId });
  return json(request, env, { nonce, message });
}

async function verifyWallet(request: Request, env: Env, ctx: ExecutionContext, body: Record<string, unknown>): Promise<Response> {
  const redirectUrl = approvedRedirect(env, body.redirect);
  const credential = body.credential;
  if (!redirectUrl || typeof credential !== 'object' || credential === null) {
    return json(request, env, { error: 'Invalid authentication request' }, 400);
  }

  const { address, chainId, message, nonce, signature } = credential as Record<string, unknown>;
  if (
    typeof address !== 'string' || !ETHEREUM_ADDRESS.test(address)
    || typeof signature !== 'string' || !HEX_SIGNATURE.test(signature)
    || typeof message !== 'string' || typeof nonce !== 'string'
    || chainId !== Number(env.WALLET_CHAIN_ID)
  ) {
    return json(request, env, { error: 'Invalid authentication request' }, 400);
  }
  if (!await verifyTurnstile(body.turnstileToken, request, env)) {
    return json(request, env, { error: 'Authentication could not be verified' }, 403);
  }

  const state = await stateRequest(env, 'consume', `wallet:${nonce}`);
  if (!state || state.address !== address.toLowerCase() || state.chainId !== chainId || state.redirectUrl !== redirectUrl) {
    return json(request, env, { error: 'Authentication could not be verified' }, 403);
  }

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
  if (!valid) {
    await sendUnauthorizedAlert(env, ctx, address as string, 'Wallet');
    return json(request, env, { error: 'Authentication could not be verified' }, 403);
  }

  const token = await mintHandoffToken(address.toLowerCase(), redirectUrl, env);
  log('wallet_authenticated', { chainId: Number(env.WALLET_CHAIN_ID) });
  return json(request, env, { token });
}

async function startGoogle(request: Request, env: Env, url: URL): Promise<Response> {
  const redirectUrl = approvedRedirect(env, url.searchParams.get('redirect'));
  if (!redirectUrl || !await verifyTurnstile(url.searchParams.get('turnstile_token'), request, env)) {
    return new Response('Authentication could not be verified', { status: 403 });
  }

  const state = crypto.randomUUID();
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await stateRequest(env, 'put', `google:${state}`, {
    codeVerifier: verifier,
    expiresAt: Date.now() + 5 * 60 * 1000,
    redirectUrl,
  });

  const callback = new URL('/api/v1/auth/google/callback', env.PASSPORT_ORIGIN);
  callback.searchParams.set('state', state);
  const authorize = new URL('/auth/v1/authorize', env.SUPABASE_URL);
  authorize.searchParams.set('provider', 'google');
  authorize.searchParams.set('redirect_to', callback.toString());
  authorize.searchParams.set('code_challenge', await codeChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 's256');
  return Response.redirect(authorize.toString(), 302);
}

async function finishGoogle(env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const stateKey = url.searchParams.get('state');
  if (!code || !stateKey) return new Response('Authentication could not be verified', { status: 403 });

  const state = await stateRequest(env, 'consume', `google:${stateKey}`);
  if (!state?.codeVerifier || !state.redirectUrl) return new Response('Authentication could not be verified', { status: 403 });

  const response = await fetch(new URL('/auth/v1/token?grant_type=pkce', env.SUPABASE_URL), {
    method: 'POST',
    headers: { ...JSON_HEADERS, apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ auth_code: code, code_verifier: state.codeVerifier }),
  });
  if (!response.ok) {
    await sendUnauthorizedAlert(env, ctx, 'Unknown Google User', 'Google SSO');
    return new Response('Authentication could not be verified', { status: 403 });
  }

  const result = await response.json<{ user?: { id?: string } }>();
  if (!result.user?.id) {
    // If we had the email here we would use it, but we might only have state/code.
    // We'll use 'Unknown Email (Google)' or if there's an email in result.user we could use that.
    const identifier = (result.user as any)?.email || result.user?.id || 'Unknown Google User';
    await sendUnauthorizedAlert(env, ctx, identifier, 'Google SSO');
    return new Response('Authentication could not be verified', { status: 403 });
  }

  const handoff = new URL(state.redirectUrl);
  handoff.searchParams.set('token', await mintHandoffToken(result.user.id, state.redirectUrl, env));
  log('google_authenticated');
  return Response.redirect(handoff.toString(), 302);
}


async function handleTelemetry(request: Request, env: Env, body: Record<string, unknown>): Promise<Response> {
  const { event, timestamp, ...payload } = body;

  // Sanitize payload just in case frontend missed something
  delete payload.token;
  delete payload.turnstileToken;
  delete payload.credential;

  if (typeof event === 'string') {
    log(event, payload as Record<string, string | number | boolean>);

    if (event === 'unauthorized_access') {
      const identifier = payload.address || payload.method || 'unknown';
      const key = `alert:${timestamp || new Date().toISOString()}:${identifier}`;
      await env.SECURITY_AUDIT_LOGS.put(key, JSON.stringify({ event, timestamp, payload }), { expirationTtl: 30 * 24 * 60 * 60 });
    }
  }

  return json(request, env, { success: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request, env) });

    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (!origin || !frontendOrigins(env).includes(origin)) return new Response('Forbidden', { status: 403 });

      const body = await parseJson(request);
      if (!body) return json(request, env, { error: 'Invalid request body' }, 400);
      if (url.pathname === '/api/v1/auth/wallet/challenge') return startWalletChallenge(request, env, body);
      if (url.pathname === '/api/v1/auth/verify') return verifyWallet(request, env, ctx, body);
      if (url.pathname === '/api/v1/telemetry') return handleTelemetry(request, env, body);
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/auth/google') return startGoogle(request, env, url);
    if (request.method === 'GET' && url.pathname === '/api/v1/auth/google/callback') return finishGoogle(env, ctx, url);
    return new Response('Not found', { status: 404 });
  },
};
