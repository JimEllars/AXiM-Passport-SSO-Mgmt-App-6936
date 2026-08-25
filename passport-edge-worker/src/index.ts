
export interface Env {
	TURNSTILE_SECRET_KEY: string;
    PASSPORT_SESSIONS: KVNamespace;
    JWT_SECRET: string;
}

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
	'Access-Control-Max-Age': '86400',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, cf-turnstile-response',
};

function sanitizeContext(context: any) {
    if (!context) return context;
    const sanitized = { ...context };
    const sensitiveKeys = ['signature', 'token', 'turnstileToken', 'cf_turnstile_response', 'cf-turnstile-response'];
    for (const key of sensitiveKeys) {
        if (key in sanitized) {
            sanitized[key] = '***REDACTED***';
        }
    }
    return sanitized;
}

const logger = {
    info: (message: string, context?: any) => {
        console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), context: sanitizeContext(context) }));
    },
    error: (message: string, context?: any) => {
        console.error(JSON.stringify({ level: 'error', message, timestamp: new Date().toISOString(), context: sanitizeContext(context) }));
    }
};

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
	const formData = new FormData();
	formData.append('secret', secret);
	formData.append('response', token);
	formData.append('remoteip', ip);

	const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
	const result = await fetch(url, {
		body: formData,
		method: 'POST',
	});

	const outcome = await result.json() as any;
	return outcome.success;
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

async function signJWT(payload: any, secret: string): Promise<string> {
    const encoder = new TextEncoder();

    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };

    const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
    const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));

    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(dataToSign)
    );

    const encodedSignature = base64UrlEncode(signatureBuffer);

    return `${dataToSign}.${encodedSignature}`;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (request.method === 'POST') {
			const url = new URL(request.url);

            let body: any = {};
            try {
                body = await request.clone().json();
            } catch (e) {}

            const turnstileToken = request.headers.get('cf-turnstile-response') || body.turnstileToken || body.cf_turnstile_response;
            const ip = request.headers.get('cf-connecting-ip') || '';

            if (url.pathname === '/api/v1/auth/wallet/challenge' || url.pathname === '/api/v1/auth/verify') {
                if (!turnstileToken) {
                    logger.error('Turnstile token missing', { path: url.pathname, ip });
                    return new Response(JSON.stringify({ error: 'Turnstile token missing' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const isTurnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY || 'dummy_secret', ip);

                if (!isTurnstileValid) {
                    logger.error('Turnstile validation failed', { path: url.pathname, ip });
                    return new Response(JSON.stringify({ error: 'Turnstile validation failed' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            }

			if (url.pathname === '/api/v1/auth/wallet/challenge') {
                logger.info('Authentication initiation event (challenge requested)', { path: url.pathname, ip });
                const nonce = crypto.randomUUID().replace(/-/g, '');
                const message = `localhost wants you to sign in with your Ethereum account:\n0x0000000000000000000000000000000000000000\n\nSign in to AXiM Passport.\n\nURI: http://localhost\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

                return new Response(JSON.stringify({ nonce, message }), {
                    status: 200,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
			}

            if (url.pathname === '/api/v1/auth/verify') {
                const whitelist = [
                    '0x1234567890123456789012345678901234567890',
                    '0x0000000000000000000000000000000000000000'
                ];

                const address = body.address || '0x0000000000000000000000000000000000000000';

                const isWhitelisted = whitelist.includes(address.toLowerCase());

                if (!isWhitelisted) {
                    logger.error('Address not whitelisted', { path: url.pathname, address, ip });
                    return new Response(JSON.stringify({ error: 'Address not whitelisted' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                }

                if (body.signature) {
                    const redirectUrl = url.searchParams.get('redirect') || body.redirect || 'default_origin';

                    const jti = crypto.randomUUID();
                    const now = Math.floor(Date.now() / 1000);
                    const exp = now + 60; // 60 seconds expiration

                    const payload = {
                        sub: address.toLowerCase(),
                        aud: redirectUrl,
                        iat: now,
                        exp: exp,
                        jti: jti
                    };

                    const jwtSecret = env.JWT_SECRET || 'default_fallback_secret_for_local_dev';
                    const token = await signJWT(payload, jwtSecret);

                    // Write to KV store for replay protection with 60s TTL
                    if (env.PASSPORT_SESSIONS) {
                        try {
                            await env.PASSPORT_SESSIONS.put(`jti:${jti}`, 'active', { expirationTtl: 60 });
                        } catch (e: any) {
                            logger.error('Failed to write to KV store', { path: url.pathname, error: e.message });
                        }
                    } else {
                        logger.error('KV namespace PASSPORT_SESSIONS is not bound', { path: url.pathname });
                    }

                    logger.info('Authentication success', { path: url.pathname, address, ip, jti });
                    return new Response(JSON.stringify({ token }), {
                        status: 200,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                } else {
                    logger.error('Missing signature', { path: url.pathname, address, ip });
                    return new Response(JSON.stringify({ error: 'Missing signature' }), {
                        status: 400,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                }
            }
		}

		return new Response('Not found', { status: 404, headers: corsHeaders });
	}
};
