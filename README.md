# AXiM Passport

AXiM Passport is the browser-facing SSO handoff application for approved AXiM applications. It supports Google OAuth through Supabase and Ethereum SIWE authentication, then returns a signed, 60-second JWT to the requested approved callback.

## Cloudflare architecture

| Component | Production resource |
| --- | --- |
| Frontend | Cloudflare Pages project `axim-passport` |
| API | Worker `axim-passport-api` routed at `https://passport.axim.us.com/api/*` |
| Authentication state | `AuthState` Durable Object |
| Bot protection | Managed Turnstile widget `axim-passport` |
| Public hostname | `https://passport.axim.us.com` |

The Worker uses a Durable Object, rather than Workers KV, for short-lived OAuth state and SIWE nonces. Its atomic consume operation prevents a nonce or OAuth state value from being reused.
The Pages hostname is an approved fallback frontend origin. OAuth callbacks use the active Worker host, allowing the Workers.dev failover path to complete authentication while the primary hostname propagates.


## Required Cloudflare configuration

The Worker requires these secrets:

```text
TURNSTILE_SECRET_KEY
JWT_SECRET
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET
AXIM_INTERNAL_KEY
ADMIN_API_KEY
EMAILIT_API_KEY
EMAILIT_WEBHOOK_SECRET
RESEND_API_KEY
ADMIN_ALERT_EMAIL
```

Set a secret interactively without placing it in a file or shell history:

```powershell
Set-Location passport-edge-worker
npx wrangler secret put SUPABASE_ANON_KEY --name axim-passport-api
```

`SUPABASE_URL`, `PASSPORT_ORIGIN`, approved callback origins, the wallet chain, and the expected Turnstile action are versioned in `passport-edge-worker/wrangler.jsonc`. Before changing an approved application, update `ALLOWED_REDIRECT_ORIGINS` and redeploy the Worker.

Secrets are deliberately absent from `wrangler.jsonc`; defining empty values there replaces the secret binding during deployment. The Worker also requires the dedicated `AXIM_PASSPORT_REVOCATION` and `AXIM_PASSPORT_SECURITY_AUDIT` KV namespaces configured in that file.

## Required Supabase configuration

Enable Google in the Supabase project's Auth provider settings, configure the Google client ID and secret there, and add this redirect URL:

```text
https://passport.axim.us.com/api/v1/auth/google/callback
```

## Required routing and failover configuration

1. In Cloudflare Pages, add `passport.axim.us.com` as a custom domain for the `axim-passport` project. This creates and maintains the required DNS record and certificate; do not create a competing manual CNAME.
2. Deploy `passport-edge-worker/wrangler.jsonc`. Its `passport.axim.us.com/api/*` route must remain attached to `axim-passport-api`, so API requests do not fall through to the Pages SPA.
3. Keep the generated Workers.dev URL enabled for `axim-passport-api`. Set it as `VITE_PASSPORT_FALLBACK_EDGE_URL`, and set `VITE_PASSPORT_FALLBACK_URL=https://axim-passport.pages.dev`. The client probes the primary pair before navigation and uses this Pages/Workers.dev pair only when the primary hostname cannot be reached.
4. Add both callback URLs to Supabase Auth Redirect URLs:

```text
https://passport.axim.us.com/api/v1/auth/google/callback
https://axim-passport-api.<your-workers-dev-subdomain>.workers.dev/api/v1/auth/google/callback
https://passport.axim.us.com/api/v1/auth/apple/callback
https://axim-passport-api.<your-workers-dev-subdomain>.workers.dev/api/v1/auth/apple/callback
```

## Deployment

The frontend embeds public build-time values from an untracked `.env.production`. Copy `.env.example`, use the deployed Worker URL and Turnstile site key, then deploy:

```powershell
npm run build
npx wrangler pages deploy .\dist --project-name axim-passport --branch main
```

Deploy the Worker after configuration changes:

```powershell
Set-Location passport-edge-worker
npm run build
npx wrangler deploy
```

## Continuous Deployment

This repository uses GitHub Actions for continuous integration and continuous deployment (CI/CD) to Cloudflare.
The pipelines deploy updates seamlessly with zero downtime, without disrupting active users.

The following GitHub Repository Secrets are required to authenticate with Cloudflare for deployment:
- `CLOUDFLARE_API_TOKEN`: A Cloudflare API token with permissions to edit Pages and Workers.
- `CLOUDFLARE_ACCOUNT_ID`: The Cloudflare account ID where the resources are deployed.
- `VITE_TURNSTILE_SITE_KEY`: The public site key for the production Turnstile widget.

The Pages workflow reads `SUPABASE_API_URL` and `SUPABASE_ANON_PUBLIC_KEY` from GitHub repository variables. Never allow its production build to fall back to mock values.

There are two primary deployment workflows:
1. **Edge Worker Deployment**: Triggers when files inside the `passport-edge-worker/` directory change on the `main` branch.
2. **Frontend Pages Deployment**: Triggers when frontend files (e.g., `src/`, `package.json`, `index.html`) change on the `main` branch.

## Deployment Log
For a record of production secret injections and DNS verifications, please see [DEPLOYMENT_LOG.md](DEPLOYMENT_LOG.md).
