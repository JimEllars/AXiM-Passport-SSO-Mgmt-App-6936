# AXiM Passport

AXiM Passport is the browser-facing SSO handoff application for approved AXiM applications. It supports Google OAuth through Supabase and Ethereum SIWE authentication, then returns a signed, 60-second JWT to the requested approved callback.

## Cloudflare architecture

| Component | Production resource |
| --- | --- |
| Frontend | Cloudflare Pages project `axim-passport` |
| API | Worker `axim-passport-api` (`https://axim-passport-api.axim.us.com`) |
| Authentication state | `AuthState` Durable Object |
| Bot protection | Managed Turnstile widget `axim-passport` |
| Public hostname | `https://passport.axim.us.com` |

The Worker uses a Durable Object, rather than Workers KV, for short-lived OAuth state and SIWE nonces. Its atomic consume operation prevents a nonce or OAuth state value from being reused.
Until the custom domain is mapped, the Pages hostname is also an approved frontend origin for wallet-flow staging. Google OAuth completes only after the custom hostname is active because its callback is intentionally fixed to the Passport domain.


## Infrastructure Requirements

Before traffic can be routed to the SSO gateway, a CNAME record for the Passport custom domain (e.g., `passport.axim.us.com`) MUST be mapped to the Cloudflare Pages target (`<project>.pages.dev`) in the Cloudflare DNS dashboard.

## Required Cloudflare configuration

The Worker requires these secrets:

```text
TURNSTILE_SECRET_KEY
JWT_SECRET
SUPABASE_ANON_KEY
```

Set a secret interactively without placing it in a file or shell history:

```powershell
Set-Location passport-edge-worker
npx wrangler secret put SUPABASE_ANON_KEY --name axim-passport-api
```

`SUPABASE_URL`, `PASSPORT_ORIGIN`, approved callback origins, the wallet chain, and the expected Turnstile action are versioned in `passport-edge-worker/wrangler.jsonc`. Before changing an approved application, update `ALLOWED_REDIRECT_ORIGINS` and redeploy the Worker.

## Required Supabase configuration

Enable Google in the Supabase project's Auth provider settings, configure the Google client ID and secret there, and add this redirect URL:

```text
https://passport.axim.us.com/api/v1/auth/google/callback
```

## Required Pages domain configuration

In Cloudflare Pages, add `passport.axim.us.com` as a custom domain for the `axim-passport` project. The Cloudflare token used for this deployment does not have DNS write permission, so the domain mapping must be approved through the Cloudflare dashboard or by an account token with DNS edit access. The Turnstile widget already permits both the custom hostname and the Pages fallback hostname.

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

There are two primary deployment workflows:
1. **Edge Worker Deployment**: Triggers when files inside the `passport-edge-worker/` directory change on the `main` branch.
2. **Frontend Pages Deployment**: Triggers when frontend files (e.g., `src/`, `package.json`, `index.html`) change on the `main` branch.

## Deployment Log
For a record of production secret injections and DNS verifications, please see [DEPLOYMENT_LOG.md](DEPLOYMENT_LOG.md).
