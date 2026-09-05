import { dispatchCoreTelemetry } from './telemetry';
import { EmailDispatchManager } from './emailService';

import { verifyMessage } from 'viem';

export interface Env {
  AXIM_CORE_API_URL: string;
  AXIM_INTERNAL_KEY: string;
  EMAILIT_API_KEY: string;
  EMAILIT_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  ADMIN_ALERT_EMAIL: string;
  ADMIN_API_KEY: string;
  ALLOWED_REDIRECT_ORIGINS: string;
  AUTH_STATE: DurableObjectNamespace;
  FRONTEND_ORIGINS: string;
  JWT_SECRET: string;
  PASSPORT_ORIGIN: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_URL: string;
  TURNSTILE_ACTION: string;
  TURNSTILE_SECRET_KEY: string;
  WALLET_CHAIN_ID: string;
  SECURITY_AUDIT_LOGS: KVNamespace;
  REVOCATION_KV: KVNamespace;
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

const AUTHORIZED_IDENTITIES: string[] = [
  "admin@axim.us.com",
  "test@axim.us.com",
  "0x1234567890123456789012345678901234567890"
];
const HEX_SIGNATURE = /^0x[a-fA-F0-9]{130}$/;

const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const RATE_LIMIT_MAX_REQUESTS = 10;

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const ipRequestCounts = new Map<string, { count: number; expiresAt: number }>();
let lastCleanup = Date.now();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (now - lastCleanup > 60000) {
    for (const [key, value] of ipRequestCounts.entries()) {
      if (value.expiresAt < now) {
        ipRequestCounts.delete(key);
      }
    }
    lastCleanup = now;
  }
  const record = ipRequestCounts.get(ip);
  if (!record || record.expiresAt < now) {
    ipRequestCounts.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count += 1;
  return true;
}

// Simple cleanup function (could be called occasionally or in an alarm, but for edge workers with short lifespan, Map is fine)


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

    if (operation === 'consumeToken') {
      const exists = await this.state.storage.get(key);
      if (exists) {
        return Response.json({ success: false });
      }

      await this.state.storage.put(key, Date.now() + 60000);

      // Cleanup tokens using alarms
      const currentAlarm = await this.state.storage.getAlarm();
      if (!currentAlarm) {
        await this.state.storage.setAlarm(Date.now() + 60000);
      }

      return Response.json({ success: true });
    }

    if (operation === 'logout') {
      await this.state.storage.delete(`session:${key}`);
      // Also maybe delete the sub as key, just to be thorough if they used `key` directly
      await this.state.storage.delete(key);
      return Response.json({ success: true });
    }

    return new Response('Invalid state operation', { status: 400 });
  }

  async alarm() {
    const map = await this.state.storage.list();
    const now = Date.now();
    for (const [key, val] of map.entries()) {
      if (typeof val === 'number' && val < now) {
        await this.state.storage.delete(key);
      }
    }
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

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const isValid = await crypto.subtle.verify('HMAC', key, (base64UrlDecode(sigB64) as unknown as BufferSource), encoder.encode(`${headerB64}.${bodyB64}`));
    if (!isValid) return null;

    const bodyStr = new TextDecoder().decode(base64UrlDecode(bodyB64));
    return JSON.parse(bodyStr);
  } catch (e) {
    return null;
  }
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
  if (origin) {
    const isFrontendOrigin = frontendOrigins(env).includes(origin);
    const isAllowedRedirectOrigin = env.ALLOWED_REDIRECT_ORIGINS.split(',').map(o => originFrom(o.trim())).includes(origin);
    if (isFrontendOrigin || isAllowedRedirectOrigin) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
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

async function stateRequest(env: Env, operation: 'put' | 'consume' | 'consumeToken' | 'logout', key: string, value?: AuthRecord): Promise<any> {
  const id = env.AUTH_STATE.idFromName('global-auth-state');
  const response = await env.AUTH_STATE.get(id).fetch('https://auth-state.internal', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ operation, key, value }),
  });

  if (!response.ok) throw new Error('Authentication state is unavailable');
  if (operation === 'put') return null;
  if (operation === 'consumeToken') return (await response.json<{ success: boolean }>()).success;
  if (operation === 'logout') return (await response.json<{ success: boolean }>()).success;
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

async function resolveUniversalId(address: string, env: Env): Promise<string> {
  const adminHeaders = {
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  };

  const email = `${address.toLowerCase()}@wallet.local`;

  const searchUrl = new URL('/auth/v1/admin/users', env.SUPABASE_URL);
  const searchRes = await fetch(searchUrl.toString(), {
    headers: adminHeaders
  });

  if (searchRes.ok) {
    const data = await searchRes.json() as any;
    const existingUser = data.users?.find((u: any) => u.email === email);
    if (existingUser) {
      return existingUser.id;
    }
  }

  const createUrl = new URL('/auth/v1/admin/users', env.SUPABASE_URL);
  const createRes = await fetch(createUrl.toString(), {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { address: address.toLowerCase() }
    })
  });

  if (createRes.ok) {
    const data = await createRes.json() as any;
    return data.id || data.user?.id;
  }

  throw new Error('Failed to resolve universal ID for wallet address');
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
    return json(request, env, { error: 'Authentication could not be verified' }, 401);
  }

  if (!AUTHORIZED_IDENTITIES.includes((address as string).toLowerCase()) && !AUTHORIZED_IDENTITIES.includes(address as string)) {
    const emailManager = new EmailDispatchManager(env.EMAILIT_API_KEY, env.RESEND_API_KEY);
    ctx.waitUntil(emailManager.send({
      from: "System Alerts <alerts@axim.us.com>",
      to: env.ADMIN_ALERT_EMAIL,
      subject: "Unauthorized Access Attempt Blocked",
      html: `<p>Blocked Web3 login attempt for address: ${address}</p>`,
    }).catch(console.error));
    ctx.waitUntil(dispatchCoreTelemetry(env, 'auth.blocked', { address, reason: 'unauthorized_identity' }));
    return json(request, env, { error: 'Forbidden' }, 403);
  }

  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message: message as string,
    signature: signature as `0x${string}`,
  });
  if (!valid || !(message as string).includes(nonce as string)) {
    await sendUnauthorizedAlert(env, ctx, address as string, 'Wallet');
    return json(request, env, { error: 'Authentication could not be verified' }, 401);
  }

  let uuid;
  try {
    uuid = await resolveUniversalId(address as string, env);
  } catch (error) {
    return json(request, env, { error: 'Authentication could not be verified' }, 401);
  }

  const token = await mintHandoffToken(uuid, redirectUrl, env);
  log('wallet_authenticated', { chainId: Number(env.WALLET_CHAIN_ID) });
  ctx.waitUntil(dispatchCoreTelemetry(env, 'auth.success', { address, chainId }));
  return json(request, env, { token });
}

async function consumeTokenEndpoint(request: Request, env: Env, ctx: ExecutionContext, body: Record<string, unknown>): Promise<Response> {
  const { token, origin } = body;

  if (typeof token !== 'string' || typeof origin !== 'string') {
    return json(request, env, { error: 'Invalid request' }, 400);
  }

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) {
    return json(request, env, { error: 'Invalid token' }, 403);
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return json(request, env, { error: 'Token expired' }, 403);
  }

  // Check aud matches origin
  const audUrl = new URL(payload.aud as string);
  if (audUrl.origin !== origin) {
    return json(request, env, { error: 'Invalid audience' }, 403);
  }

  // Check origin is allowed
  const approved = approvedRedirect(env, origin);
  if (!approved) {
    return json(request, env, { error: 'Invalid origin' }, 403);
  }

  // Consume in DO
  if (typeof payload.jti !== 'string') {
    return json(request, env, { error: 'Invalid token' }, 403);
  }

  const revoked = await env.REVOCATION_KV.get(`revoked:${payload.jti}`);
  if (revoked) {
    log('token_replay_rejected', { jti: payload.jti, reason: 'revoked' });
    return json(request, env, { error: 'Token revoked' }, 403);
  }

  const success = await stateRequest(env, 'consumeToken', `jti:${payload.jti}`);
  if (!success) {
    log('token_replay_rejected', { jti: payload.jti });
    return json(request, env, { error: 'Token already consumed' }, 403);
  }

  log('token_consumed', { aud: typeof payload.aud === 'string' ? payload.aud : 'unknown', sub_prefix: typeof payload.sub === 'string' ? payload.sub.slice(0, 6) : 'unknow' });
  await env.SECURITY_AUDIT_LOGS.put(`alert:${new Date().toISOString()}:token_consumed`, JSON.stringify({ event: 'token_consumed', timestamp: new Date().toISOString() }), { expirationTtl: 30 * 24 * 60 * 60 });
  ctx.waitUntil(dispatchCoreTelemetry(env, 'token.exchanged', { jti: payload.jti, origin, sub: payload.sub }));

  // Fetch user claims from Supabase public.team_profiles
  let role = 'authenticated';
  let department = undefined;
  let wallet_address = undefined;
  let email = undefined;

  try {
    const sbRes = await fetch(env.SUPABASE_URL + '/rest/v1/team_profiles?id=eq.' + payload.sub + '&select=role,department,wallet_address,email', {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
    if (sbRes.ok) {
      const data = await sbRes.json() as any[];
      if (data && data.length > 0) {
        role = data[0].role || 'authenticated';
        department = data[0].department;
        wallet_address = data[0].wallet_address;
        email = data[0].email;
      }
    }
  } catch(e) {
    // ignore
  }

  // Mint new Supabase JWT
  const supabaseTokenPayload = {
    aud: 'authenticated',
    role,
    sub: payload.sub as string,
    email,
    wallet_address,
    department,
    exp: now + 3600 // 1 hour from now
  };
  const supabase_access_token = await signJwt(supabaseTokenPayload, env.SUPABASE_JWT_SECRET);

  return json(request, env, {
    valid: true, sub: payload.sub, aud: payload.aud, exp: payload.exp, supabase_access_token
  });
}


async function logoutEndpoint(request: Request, env: Env, body: Record<string, unknown>, ctx?: ExecutionContext): Promise<Response> {
  if (ctx) {
    ctx.waitUntil(fetch(env.AXIM_CORE_API_URL + '/api/v1/auth/broadcast-revocation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.AXIM_INTERNAL_KEY
      },
      body: JSON.stringify({ sub: body.sub || '' })
    }).catch(() => {}));
  }
  const { token } = body;

  if (typeof token !== 'string') {
    return json(request, env, { error: 'Invalid request' }, 400);
  }

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) {
    return json(request, env, { error: 'Invalid token' }, 403);
  }

  if (typeof payload.sub !== 'string') {
    return json(request, env, { error: 'Invalid token payload' }, 403);
  }

  const origin = request.headers.get('Origin');
  if (!origin || (!frontendOrigins(env).includes(origin) && !env.ALLOWED_REDIRECT_ORIGINS.split(',').map(o => originFrom(o.trim())).includes(origin))) {
    return new Response('Forbidden', { status: 403 });
  }

  // Add token JTI to REVOCATION_KV with TTL matching remaining lifetime
  if (payload.jti) {
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === 'number' ? payload.exp : now + 3600;
    const ttl = Math.max(60, exp - now);
    await env.REVOCATION_KV.put(`revoked:${payload.jti}`, '1', { expirationTtl: ttl });
  }

  await stateRequest(env, 'logout', payload.sub);

  // Dispatch async revocation broadcast to AXiM Core
  const coreUrl = env.AXIM_CORE_API_URL + '/api/v1/auth/broadcast-revocation';
  request.headers.get('ExecutionContext'); // dummy

  // Actually, we use ctx.waitUntil for background tasks, but we don't have ctx here.
  // Wait, let's see if ctx is passed to logoutEndpoint.
  // In handleFetch: if (url.pathname === '/api/v1/auth/logout') return logoutEndpoint(request, env, body, ctx);
  // Let's modify handleFetch to pass ctx to logoutEndpoint!
  // BUT to avoid complex regex, we can just fetch without awaiting if it's safe, OR we can modify handleFetch.
  // Let's modify handleFetch below and add ctx to logoutEndpoint signature.

  log('global_logout', { sub: payload.sub });
  return new Response(JSON.stringify({ success: true, message: 'Global session terminated' }), {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
    }
  });
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

async function finishGoogle(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
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

  const userEmail = (result.user as any)?.email;
  if (!userEmail || (!AUTHORIZED_IDENTITIES.includes(userEmail.toLowerCase()) && !AUTHORIZED_IDENTITIES.includes(userEmail))) {
    const emailManager = new EmailDispatchManager(env.EMAILIT_API_KEY, env.RESEND_API_KEY);
    ctx.waitUntil(emailManager.send({
      from: "System Alerts <alerts@axim.us.com>",
      to: env.ADMIN_ALERT_EMAIL,
      subject: "Unauthorized Access Attempt Blocked",
      html: `<p>Blocked Google login attempt for email: ${userEmail || 'Unknown'}</p>`,
    }).catch(console.error));
    ctx.waitUntil(dispatchCoreTelemetry(env, 'auth.blocked', { email: userEmail || 'Unknown', reason: 'unauthorized_identity' }));
    return new Response('Forbidden', { status: 403 });
  }

  const approvedRedir = approvedRedirect(env, state.redirectUrl);
  if (!approvedRedir) {
    return json(request, env, { error: 'Forbidden' }, 403);
  }

  const handoff = new URL(approvedRedir);
  handoff.searchParams.set('token', await mintHandoffToken(result.user.id, approvedRedir, env));
  log('google_authenticated');
  ctx.waitUntil(dispatchCoreTelemetry(env, 'auth.success', { email: (result.user as any)?.email, userId: result.user.id }));
  return Response.redirect(handoff.toString(), 302);
}



async function handleEmailWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('X-Emailit-Signature');

  if (signatureHeader) {
    const sigParts = signatureHeader.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {} as Record<string, string>);

    const t = sigParts['t'];
    const v1 = sigParts['v1'];

    if (!t || !v1) {
      return new Response('Invalid signature format', { status: 401 });
    }

    const key = await crypto.subtle.importKey('raw', encoder.encode(env.EMAILIT_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${rawBody}`));
    const signatureHex = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (signatureHex !== v1) {
      return new Response('Invalid signature', { status: 401 });
    }
  }

  // Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Normalize event
  // Resend event is usually in payload.type
  // EmailIt event might be in payload.event or payload.type. The prompt says "log the delivery state (e.g., email.delivered or email.bounced)"
  let eventName = payload.type || payload.event || 'unknown';
  if (eventName === 'email.sent') {
    eventName = 'email.delivered';
  }

  // Pass to handleTelemetry
  // Since handleTelemetry expects a Request, env, and body
  const telemetryBody = {
    event: eventName,
    timestamp: new Date().toISOString(),
    ...payload
  };

  // We don't necessarily need to return the exact response from handleTelemetry, but we can call it directly
  // Note that handleTelemetry doesn't mutate, it just logs and returns json success
  log('webhook_received', { event: eventName });

  if (eventName) {
    ctx.waitUntil(dispatchTelemetryUplink(env, eventName, telemetryBody.timestamp as string, payload));
  }

  return json(request, env, { success: true });
}

async function dispatchTelemetryUplink(env: Env, event: string, timestamp: string, payload: any) {
  try {
    const identifier = payload.address || payload.method || event;
    const key = `alert:${timestamp || new Date().toISOString()}:${identifier}`;
    await env.SECURITY_AUDIT_LOGS.put(key, JSON.stringify({ event, timestamp, payload }), { expirationTtl: 30 * 24 * 60 * 60 });
  } catch (error) {
    // fail-safe silent catch
  }
}

async function handleTelemetry(request: Request, env: Env, ctx: ExecutionContext, body: Record<string, unknown>): Promise<Response> {
  const { event, timestamp, ...payload } = body;

  // Sanitize payload just in case frontend missed something
  delete payload.token;
  delete payload.turnstileToken;
  delete payload.credential;

  if (typeof event === 'string') {
    log(event, payload as Record<string, string | number | boolean>);

    ctx.waitUntil(dispatchTelemetryUplink(env, event, timestamp as string, payload));
  }

  return json(request, env, { success: true });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const runCron = async () => {
      // 1. Supabase Check
      const controllerAbort = new AbortController();
      const timeout = setTimeout(() => controllerAbort.abort(), 5000);
      let isSupabaseDown = false;
      let errMessage = '';
      try {
        const res = await fetch(env.SUPABASE_URL + '/rest/v1/', {
          headers: { apikey: env.SUPABASE_ANON_KEY },
          signal: controllerAbort.signal as any
        });
        clearTimeout(timeout);
        if (!res.ok) {
          throw new Error(`Supabase returned ${res.status}`);
        }
      } catch (err: any) {
        clearTimeout(timeout);
        isSupabaseDown = true;
        errMessage = err.message;
      }

      // Compile metrics for daily summary
      let totalLogins = 0;
      let web3Logins = 0;
      let emailLogins = 0;
      let googleLogins = 0;
      let activeSessions = 0;
      let botChallenges = 0;
      let tokenRejections = 0;

      // Query SECURITY_AUDIT_LOGS for last 24h
      try {
        const list = await env.SECURITY_AUDIT_LOGS.list({ prefix: 'alert:' });
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        for (const key of list.keys) {
          const val = await env.SECURITY_AUDIT_LOGS.get(key.name, 'json') as any;
          if (val && val.timestamp) {
            const time = new Date(val.timestamp).getTime();
            if (now - time <= oneDayMs) {
               if (val.event === 'auth.success') {
                 totalLogins++;
                 if (val.payload?.method === 'wallet') web3Logins++;
                 else if (val.payload?.method === 'email') emailLogins++;
                 else if (val.payload?.method === 'google' || !val.payload?.method) googleLogins++;
               }
               if (val.event === 'token_consumed') activeSessions++;
               if (val.event === 'turnstile.blocked' || val.event === 'auth.blocked') botChallenges++;
               if (val.event === 'token_replay_rejected') tokenRejections++;
            }
          }
        }
      } catch (e) {
        // ignore
      }

      const emailManager = new EmailDispatchManager(env.EMAILIT_API_KEY, env.RESEND_API_KEY);

      if (isSupabaseDown) {
        await emailManager.send({
          from: "System Alerts <alerts@axim.us.com>",
          to: env.ADMIN_ALERT_EMAIL,
          subject: "System Degraded: Supabase Unreachable",
          html: `<p>Active monitoring failed to reach Supabase API.</p><p>Error: ${errMessage}</p>`,
        });
      }

      // Dispatch Daily Report
      const htmlReport = `
        <div style="background-color: #0f172a; color: #f8fafc; font-family: sans-serif; padding: 20px;">
          <h2 style="color: #38bdf8;">AXiM Passport SSO - Daily Security Report</h2>
          <hr style="border: 1px solid #1e293b;" />
          <p>Here is the identity and auth security summary for the last 24 hours:</p>
          <ul>
            <li><strong>Total Logins:</strong> ${totalLogins}</li>
            <ul>
               <li>Web3 SIWE: ${web3Logins}</li>
               <li>Email OTP: ${emailLogins}</li>
               <li>Google: ${googleLogins}</li>
            </ul>
            <li><strong>Active/Concurrent Sessions (Tokens Consumed):</strong> ${activeSessions}</li>
            <li><strong>Bot Challenges Mitigated (Turnstile):</strong> ${botChallenges}</li>
            <li><strong>Replayed/Expired Token Rejections:</strong> ${tokenRejections}</li>
          </ul>
        </div>
      `;

      await emailManager.send({
        from: "System Alerts <alerts@axim.us.com>",
        to: "james.ellars@axim.us.com",
        bcc: "jrellars@gmail.com",
        subject: `[AXiM Passport SSO] Daily Identity & Auth Security Report - ${new Date().toISOString().split('T')[0]}`,
        html: htmlReport,
      });

    };
    ctx.waitUntil(runCron());
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await this.handleFetch(request, env, ctx);
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      newHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  },

  async handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request, env) });


    if (request.method === 'GET' && url.pathname === '/api/v1/telemetry/health-stats') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || authHeader !== 'Bearer ' + env.ADMIN_API_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      const list = await env.SECURITY_AUDIT_LOGS.list({ prefix: 'alert:' });
      let rejections = 0;
      let consumptions = 0;

      // The instruction specifies "recent 403 rejections and token consumptions".
      // We will iterate through keys or fetch their values to determine the type.
      // But typically we can just count based on event types if they are in the key name,
      // or we can fetch them. Let's fetch the values to check their event type.

      const values = await Promise.all(list.keys.map(k => env.SECURITY_AUDIT_LOGS.get(k.name, 'json')));

      for (const val of values) {
        if (val) {
          const v = val as any;
          if (v.event === 'unauthorized_access' || v.event === 'rate_limit_exceeded' || v.payload?.status === 403) {
            rejections++;
          }
          if (v.event === 'token_consumed' || v.event === 'token_consume') {
            consumptions++;
          }
        }
      }

      return json(request, env, {
        rejections,
        consumptions
      });
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/v1/health') {

      return json(request, env, { status: 'operational', timestamp: new Date().toISOString() });
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/webhooks/email') {
      return handleEmailWebhook(request, env, ctx);
    }


    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitedPaths = ['/api/v1/auth/verify', '/api/v1/auth/wallet/challenge', '/api/v1/auth/token/consume', '/api/v1/auth/logout'];
    if (rateLimitedPaths.includes(url.pathname)) {
      if (!checkRateLimit(ip)) {
        log('rate_limit_exceeded', { ip, path: url.pathname });
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: {
            ...corsHeaders(request, env),
            ...JSON_HEADERS,
            'Retry-After': '10'
          }
        });
      }
    }

    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');

      const isFrontendOrigin = origin ? frontendOrigins(env).includes(origin) : false;
      const isAllowedRedirectOrigin = origin ? env.ALLOWED_REDIRECT_ORIGINS.split(',').map(o => originFrom(o.trim())).includes(origin) : false;

      if (url.pathname === '/api/v1/auth/token/consume') {
        if (!isAllowedRedirectOrigin) return new Response('Forbidden', { status: 403 });
      } else if (url.pathname === '/api/v1/auth/logout') {
        if (!isFrontendOrigin && !isAllowedRedirectOrigin) return new Response('Forbidden', { status: 403 });
      } else {
        // Default for other POSTs like verify, wallet challenge, telemetry
        if (!isFrontendOrigin) return new Response('Forbidden', { status: 403 });
      }

      const body = await parseJson(request);
      if (!body) return json(request, env, { error: 'Invalid request body' }, 400);
      if (url.pathname === '/api/v1/auth/wallet/challenge') return startWalletChallenge(request, env, body);
      if (url.pathname === '/api/v1/auth/verify') return verifyWallet(request, env, ctx, body);
      if (url.pathname === '/api/v1/auth/token/consume') return consumeTokenEndpoint(request, env, ctx, body);
      if (url.pathname === '/api/v1/auth/logout') return logoutEndpoint(request, env, body, ctx);
      if (url.pathname === '/api/v1/telemetry') return handleTelemetry(request, env, ctx, body);
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/auth/google') return startGoogle(request, env, url);
    if (request.method === 'GET' && url.pathname === '/api/v1/auth/google/callback') return finishGoogle(request, env, ctx, url);
    return new Response('Not found', { status: 404 });
  },
};
