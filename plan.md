1. **Hardening Google and Apple OAuth token verification against public JWKS endpoints.**
   - In `passport-edge-worker/src/index.ts`, update `finishGoogle` to fetch Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`) and verify the `id_token` using `jsonwebtoken` or equivalent Web Crypto logic, extracting the verified email, name, and avatar. Wait, edge workers might not have `jsonwebtoken` package, let's use a lightweight solution or `jose` package if we can install it, or manual Web Crypto. Actually, the prompt says "Verify Google id_token against Google's public JSON Web Key Sets ... Verify Apple id_token against Apple's public key endpoints". Wait, Supabase returns the auth_code which we currently exchange for a token via Supabase: `fetch(new URL('/auth/v1/token?grant_type=pkce', env.SUPABASE_URL))`. Wait, if we use Supabase to exchange the code, the token returned is a Supabase session, not the raw Google `id_token` unless Supabase provides it in `result.session.provider_token` or `result.session.provider_refresh_token`? The prompt says "In `POST /api/v1/auth/login-google`: Fetch Google JWKS from https://www.googleapis.com/oauth2/v3/certs ... Verify signature...". There is no `POST /api/v1/auth/login-google`, we have `GET /api/v1/auth/google/callback` (`finishGoogle`) and `GET /api/v1/auth/google`. We should update `finishGoogle`? Ah, if we look at Phase A: "In POST /api/v1/auth/login-google: Fetch Google JWKS". Wait, maybe we need to create `POST /api/v1/auth/login-google` and `POST /api/v1/auth/login-apple` or update the current ones. Currently we use `startGoogle` and `finishGoogle` where Supabase does the OAuth. If we are instructed to change this to `POST /api/v1/auth/login-google`... we'll look at it.

2. **Integrating EmailIt API for passwordless OTP dispatching with KV dead-letter queue buffering.**
   - Create a Dead Letter Queue (DLQ) in `REVOCATION_KV` or a new KV (wait, instructions say `env.PASSPORT_DLQ_KV`, we need to add `PASSPORT_DLQ_KV` to `wrangler.jsonc` and `Env`).
   - In `passport-edge-worker/src/emailService.ts` update `sendEmailOtp(email, otpCode)` to call EmailIt. Wait, in `index.ts` `startEmailOtp` calls Supabase `/auth/v1/otp`. We should change `startEmailOtp` to generate the 6-digit OTP code, store it in `env.PASSPORT_AUTH_KV` (which is `AUTH_STATE` Durable Object in our implementation, wait, there's no `PASSPORT_AUTH_KV` - we have `AUTH_STATE` which is a DO or just use it. Wait, the prompt says `env.PASSPORT_AUTH_KV` - I should add it to `wrangler.jsonc`).
   - Send the OTP via `emailService.ts` to `https://api.emailit.com/v1/email/send`.

3. **Hooking authentication threat telemetry directly into Asguard SOC and AXiM Core.**
   - Update `passport-edge-worker/src/telemetry.ts` to send successful login telemetry to `POST https://api.axim.us.com/functions/v1/satellite-telemetry` (replacing the current `/api/v1/telemetry/micro-app`).
   - For threat alerts, dispatch to `POST https://asguard.axim.us.com/api/v1/threats/ingress`.

4. **Implementing the scheduled daily identity & security executive briefing with embedded 1-click HITL session revocation buttons.**
   - Add a Cloudflare Cron Trigger in `wrangler.jsonc` for `0 12 * * *`.
   - Implement `scheduled(event, env, ctx)` handler in `index.ts` to aggregate stats from KV/DO, generate HMAC signed tokens in `env.PASSPORT_REVOCATION_KV`, and send email via EmailIt to James Ellars.
   - Implement `GET /api/v1/auth/admin-action` for the 1-click execution.

5. **Cross-App Handshake Verification**
   - Update `src/services/passportClient.js` for automatic sanitization, silent session checking, etc.
