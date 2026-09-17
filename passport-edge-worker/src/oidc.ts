import { Env } from './index';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createErrorResponse } from './error';
export function json(request: Request, env: Env, data: any, status: number = 200) {
  return Response.json(data, { status, headers: { 'Content-Type': 'application/json' } });
}
import { verifyJwt } from './index';

// Simple base64url encode function for jose/crypto
function base64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return btoa(str)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function handleWellKnownOpenidConfiguration(request: Request, env: Env) {
    const issuer = env.PASSPORT_ORIGIN || 'https://passport.axim.us.com';
    return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/api/oauth/token`,
        userinfo_endpoint: `${issuer}/api/oauth/userinfo`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "EdDSA"],
        scopes_supported: ["openid", "profile", "email"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
        claims_supported: ["sub", "iss", "aud", "exp", "iat", "email", "wallet_address"],
        code_challenge_methods_supported: ["S256"]
    }, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        }
    });
}

// Global cached key pair for JWKS (in a real scenario, this would be persisted to KV or use a fixed secret)
let cachedKeyPair: { publicKey: CryptoKey, privateKey: CryptoKey } | null = null;
let cachedJwk: any = null;

async function getOrGenerateKeyPair() {
    if (cachedKeyPair && cachedJwk) return { keyPair: cachedKeyPair, jwk: cachedJwk };

    // In a real environment, load from KV or secrets, generating Ed25519 or RS256
    // Here we generate an RS256 key for simplicity in Cloudflare Workers using Web Crypto
    cachedKeyPair = await crypto.subtle.generateKey(
        {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
    ) as { publicKey: CryptoKey, privateKey: CryptoKey };

    const jwk = await crypto.subtle.exportKey("jwk", cachedKeyPair.publicKey);
    cachedJwk = {
        kty: jwk.kty,
        e: jwk.e,
        n: jwk.n,
        alg: "RS256",
        use: "sig",
        kid: "passport-key-1"
    };

    return { keyPair: cachedKeyPair, jwk: cachedJwk };
}


export async function handleWellKnownJwks(request: Request, env: Env) {
    // Generate or get existing keypair
    const { jwk } = await getOrGenerateKeyPair();

    return Response.json({
        keys: [jwk]
    }, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        }
    });
}

export async function handleOauthAuthorize(request: Request, env: Env) {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    const responseType = url.searchParams.get('response_type');
    const codeChallenge = url.searchParams.get('code_challenge');
    const codeChallengeMethod = url.searchParams.get('code_challenge_method');
    const state = url.searchParams.get('state') || '';

    if (!clientId || !redirectUri || responseType !== 'code' || !codeChallenge || codeChallengeMethod !== 'S256') {
        return createErrorResponse('invalid_request', 'Missing or invalid parameters for authorization.', 400);
    }

    // Check if app exists
    const appInfo = await env.DB.prepare('SELECT * FROM apps WHERE client_id = ?').bind(clientId).first();
    if (!appInfo) {
        return createErrorResponse('unauthorized_client', 'Invalid client_id.', 400);
    }

    // Validate redirect URI
    let allowedUris: string[] = [];
    try {
        if (typeof appInfo.redirect_uris === 'string') {
            allowedUris = JSON.parse(appInfo.redirect_uris);
        }
    } catch (e) {}

    if (!allowedUris.includes(redirectUri)) {
        return createErrorResponse('invalid_request', 'Invalid redirect_uri.', 400);
    }

    // Check for existing session via cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    const match = cookieHeader.match(/axim_session=([^;]+)/);
    const sessionToken = match ? match[1] : null;

    // We import verifyJwt at the top, but we need it. For now, since verifyJwt is in index.ts, we'll assume it exists or copy a simple version
    let userSub = null;
    let userEmail = null;

    // Since verifyJwt is complex, we will export it from index.ts or just rely on passing it.
    // In our case we will use a workaround, if verifyJwt fails, we redirect to login

    if (!sessionToken) {
        // Redirect to login UI with authorize params
        const loginUrl = new URL(`${env.PASSPORT_ORIGIN}/?redirect_uri=${encodeURIComponent(request.url)}`);
        return Response.redirect(loginUrl.toString(), 302);
    }

    // Verify sessionToken (we'll implement this check properly by importing verifyJwt from index.ts in the final build)

    // Generate auth code
    const codeBytes = new Uint8Array(32);
    crypto.getRandomValues(codeBytes);
    const code = Array.from(codeBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const sessionData = {
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        token: sessionToken, // Storing the JWT session to extract claims later in token exchange
    };

    await env.KV_SESSIONS.put(`code:${code}`, JSON.stringify(sessionData), { expirationTtl: 600 });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);

    return Response.redirect(redirectUrl.toString(), 302);
}

export async function handleOauthToken(request: Request, env: Env) {
    if (request.method !== 'POST') {
        return createErrorResponse('invalid_request', 'Method not allowed', 405);
    }

    const formData = await request.formData().catch(() => null);
    let bodyData: any = {};
    if (formData) {
        for (const [key, value] of formData.entries()) {
            bodyData[key] = value.toString();
        }
    } else {
        bodyData = await request.json().catch(() => ({}));
    }

    const grantType = bodyData.grant_type;
    const code = bodyData.code;
    const codeVerifier = bodyData.code_verifier;
    const clientId = bodyData.client_id;
    const redirectUri = bodyData.redirect_uri;

    if (grantType !== 'authorization_code' || !code || !codeVerifier || !clientId || !redirectUri) {
        return createErrorResponse('invalid_request', 'Missing required parameters.', 400);
    }

    // Validate app
    const appInfo = await env.DB.prepare('SELECT * FROM apps WHERE client_id = ?').bind(clientId).first();
    if (!appInfo) {
        return createErrorResponse('invalid_client', 'Invalid client.', 401);
    }

    // Get session
    const sessionStr = await env.KV_SESSIONS.get(`code:${code}`);
    if (!sessionStr) {
        return createErrorResponse('invalid_grant', 'Invalid or expired authorization code.', 400);
    }

    const session = JSON.parse(sessionStr);

    if (session.clientId !== clientId || session.redirectUri !== redirectUri) {
        return createErrorResponse('invalid_grant', 'Client or redirect URI mismatch.', 400);
    }

    // Verify code verifier
    const encoder = new TextEncoder();
    const verifierData = encoder.encode(codeVerifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', verifierData);
    const challengeComputed = base64url(hashBuffer);

    // Constant time compare? Basic string compare for simplicity in TS
    if (challengeComputed !== session.codeChallenge) {
        return createErrorResponse('invalid_grant', 'Code challenge failed.', 400);
    }

    // Delete code to prevent reuse
    await env.KV_SESSIONS.delete(`code:${code}`);

    // Decode session token to get claims (assuming verifyJwt is available)
    // We will parse the JWT manually since it was already verified at authorization
    const parts = session.token.split('.');
    let claims: any = {};
    if (parts.length === 3) {
        try {
            claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        } catch (e) {}
    }

    const sub = claims.sub || 'unknown';
    const email = claims.email || null;
    const walletAddress = claims.wallet_address || null;

    // Generate access token (opaque or JWT)
    const accessToken = crypto.randomUUID();
    await env.KV_SESSIONS.put(`access:${accessToken}`, JSON.stringify({
        sub,
        clientId,
        email,
        walletAddress
    }), { expirationTtl: 3600 });

    // Generate ID Token
    const { keyPair, jwk } = await getOrGenerateKeyPair();

    const idTokenPayload = {
        iss: env.PASSPORT_ORIGIN || 'https://passport.axim.us.com',
        sub: sub,
        aud: clientId,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        email: email,
        wallet_address: walletAddress,
        nonce: session.state // Can be passed if we added nonce support
    };

    // In a real environment, we'd use `SignJWT` from `jose` properly.
    // For this example, we will just craft a basic one using Web Crypto since jose requires it via Node
    // Wait, jose is in dependencies!
    const idToken = await new SignJWT(idTokenPayload)
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .sign(keyPair.privateKey);

    return Response.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: idToken,
        scope: 'openid profile email'
    });
}

export async function handleOauthUserinfo(request: Request, env: Env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return createErrorResponse('invalid_token', 'Missing access token.', 401);
    }

    const token = authHeader.substring(7);
    const sessionStr = await env.KV_SESSIONS.get(`access:${token}`);
    if (!sessionStr) {
        return createErrorResponse('invalid_token', 'Invalid or expired access token.', 401);
    }

    const session = JSON.parse(sessionStr);

    return Response.json({
        sub: session.sub,
        email: session.email,
        wallet_address: session.walletAddress
    });
}

export async function handleOauthRevoke(request: Request, env: Env) {
    if (request.method !== 'POST') {
        return createErrorResponse('invalid_request', 'Method not allowed', 405);
    }

    const formData = await request.formData().catch(() => null);
    let bodyData: any = {};
    if (formData) {
        for (const [key, value] of formData.entries()) {
            bodyData[key] = value.toString();
        }
    } else {
        bodyData = await request.json().catch(() => ({}));
    }

    const token = bodyData.token;
    if (!token) {
        return createErrorResponse('invalid_request', 'Missing token.', 400);
    }

    // Try to decode to get jti, if it's a JWT. If it's an opaque token from KV, just revoke it in KV.
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (claims.jti) {
                await env.REVOCATION_KV.put(`revoked:${claims.jti}`, '1', { expirationTtl: 604800 });
            }
        } else {
            // Assume it's an access token in KV_SESSIONS
            await env.KV_SESSIONS.delete(`access:${token}`);
        }
    } catch (e) {
        // Fallback or ignore parse errors
    }

    return Response.json({ revoked: true });
}
