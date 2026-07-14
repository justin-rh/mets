# Microsoft Entra SSO — activation guide

The integration is **built and dormant**. Everything runs in `dev` auth mode
(the acting-as switcher) until the env vars below are set. Activating is a
config swap — no code changes.

## What's already in place

- **Server** (`server/src/services/auth/entra.ts`): validates Microsoft ID
  tokens (signature via tenant JWKS, issuer, audience, expiry) and maps them
  to METS users — `entra_id` match first, then email (stamping `entra_id` on
  first SSO login), else auto-provisions a **requester**. Roles live in the
  users table, never in the token, so all RBAC is unchanged. With
  `AUTH_PROVIDER=entra`, every request without a valid Bearer token gets 401
  (`/api/health` stays open for probes).
- **Web** (`web/src/auth.ts` + the AuthGate in `main.tsx`): MSAL
  Authorization Code + PKCE, "Sign in with Microsoft" screen, silent token
  refresh, sign-out in the header (replaces the dev user switcher). In dev
  mode MSAL never initializes.

## Activation checklist

1. **App registration** (needs Entra Application Administrator — currently
   the blocker):
   - Entra admin center → App registrations → New registration
   - Name `METS`, single tenant, platform **Single-page application**
   - Redirect URI — must be HTTPS or localhost:
     - `https://mets.masterelectronics.com` (set up local TLS via `mkcert`
       and switch Vite to https), or
     - `http://localhost:5173` for testing without TLS
   - No client secret (public client + PKCE). Default `openid profile email`
     scopes need no admin consent.
2. **Copy two values** from the registration overview: Application (client)
   ID and Directory (tenant) ID.
3. **Server env** (repo-root `.env`):
   ```sh
   AUTH_PROVIDER=entra
   ENTRA_TENANT_ID=<directory-id>
   ENTRA_CLIENT_ID=<application-id>
   ```
4. **Web env** (`web/.env.local`):
   ```sh
   VITE_AUTH_PROVIDER=entra
   VITE_ENTRA_TENANT_ID=<directory-id>
   VITE_ENTRA_CLIENT_ID=<application-id>
   ```
5. Restart `npm run dev`. First visit shows "Sign in with Microsoft"; after
   the redirect, the API resolves you to your METS user.

## First-login behavior

- Existing users (matching company email) sign in as themselves — role,
  queues, and skills intact; their `entra_id` is stamped for future logins.
- Unknown tenant users are provisioned as requesters and land in the portal.
  Grant agent/admin roles in the users table (an Admin UI for this is a
  small follow-up).

## Production upgrade notes

- Swap ID-token auth for access tokens: add an "Expose an API" scope
  (`api://<client-id>/access`) and request it in `auth.ts` — one line each
  side (`audience` check changes to the API client ID).
- The 401 response drives the SPA back through `signIn()`; token lifetime is
  ~1h with silent refresh.
- The demo video should stay on `AUTH_PROVIDER=dev` — the acting-as
  switcher is a feature there.
