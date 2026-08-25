# AXiM Passport: Cloudflare Turnstile Decision

## Decision

Incorporate Cloudflare Turnstile during Phase 1 using Managed mode.

Turnstile should execute after the user selects an authentication method and before Passport calls sensitive authentication endpoints. This reduces automated abuse without adding unnecessary friction to the initial interface.

## Protected Operations

Require a valid Turnstile token for:

- Wallet nonce or SIWE challenge creation
- SIWE signature verification
- Mock or development credential verification
- Handoff-token minting
- Repeated or suspicious Google authentication initiation attempts

Google OAuth still relies on Google and Supabase for identity verification. Turnstile only protects Passport's initiation and token-minting surfaces.

## Required Validation Flow

1. The frontend obtains a short-lived Turnstile response token.
2. The frontend sends that token with the authentication payload.
3. The Cloudflare Worker submits the token to Cloudflare Siteverify.
4. The Worker validates success, hostname, action, and expected metadata.
5. The Worker continues authentication only after validation succeeds.
6. Failed or expired validations return a generic `403` response.
7. The Turnstile secret remains exclusively in Worker secrets.

Never trust client-side Turnstile completion without server-side Siteverify validation.

## Additional Controls

Turnstile is one layer and does not replace:

- Worker rate limiting by IP, account, wallet, and redirect origin
- Exact redirect-origin allowlisting
- Strict CORS and request-origin validation
- SIWE nonce, domain, chain ID, issued-at, and expiration validation
- JWT audience binding to the approved callback
- A 60-second maximum handoff-token lifetime
- Security headers and a restrictive Content Security Policy
- Generic authentication errors that do not reveal whitelist membership
- Audit events without credentials, signatures, tokens, or sensitive payloads

## Replay Protection

Cloudflare KV should not be the sole authority for strict single-use token consumption because KV is eventually consistent.

Use a Durable Object or another strongly consistent atomic store to consume each JWT identifier (`jti`) exactly once. KV may still be used for secondary logging or non-critical expiration records.

## User Experience

Use Turnstile Managed mode and render it only when authentication begins. Preserve accessibility, display a clear retry state, and reset the challenge after failed or expired attempts.