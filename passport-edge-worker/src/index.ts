
export interface Env {
	TURNSTILE_SECRET_KEY: string;
}

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
	'Access-Control-Max-Age': '86400',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, cf-turnstile-response',
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

            if (url.pathname === '/api/v1/auth/wallet/challenge' || url.pathname === '/api/v1/auth/verify') {
                if (!turnstileToken) {
                    return new Response(JSON.stringify({ error: 'Turnstile token missing' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                const ip = request.headers.get('cf-connecting-ip') || '';
                const isTurnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY || 'dummy_secret', ip);

                if (!isTurnstileValid) {
                    return new Response(JSON.stringify({ error: 'Turnstile validation failed' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            }

			if (url.pathname === '/api/v1/auth/wallet/challenge') {
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
                    return new Response(JSON.stringify({ error: 'Address not whitelisted' }), {
                        status: 403,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                }

                if (body.signature) {
                    return new Response(JSON.stringify({ token: 'jwt_placeholder_string' }), {
                        status: 200,
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    });
                } else {
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
