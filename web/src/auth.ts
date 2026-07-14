// Entra SSO client — DORMANT until VITE_AUTH_PROVIDER=entra plus
// VITE_ENTRA_TENANT_ID / VITE_ENTRA_CLIENT_ID are set (docs/SSO.md).
// In dev mode every export is an inert no-op and MSAL never initializes.
import {
  PublicClientApplication, type AccountInfo, type AuthenticationResult,
} from '@azure/msal-browser';

export const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined) ?? 'dev';
export const isEntra = AUTH_PROVIDER === 'entra';

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined;

let msal: PublicClientApplication | null = null;
let initialized: Promise<void> | null = null;

function client(): PublicClientApplication {
  if (!isEntra || !tenantId || !clientId) {
    throw new Error('Entra auth not configured — set VITE_ENTRA_TENANT_ID / VITE_ENTRA_CLIENT_ID');
  }
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
  }
  return msal;
}

/** Resolve the signed-in account, completing a redirect if one is in flight. */
export async function initAuth(): Promise<AccountInfo | null> {
  if (!isEntra) return null;
  const app = client();
  if (!initialized) initialized = app.initialize();
  await initialized;
  const result = await app.handleRedirectPromise();
  if (result?.account) app.setActiveAccount(result.account);
  const active = app.getActiveAccount() ?? app.getAllAccounts()[0] ?? null;
  if (active) app.setActiveAccount(active);
  return active;
}

export function signIn(): void {
  void client().loginRedirect({ scopes: ['openid', 'profile', 'email'] });
}

export function signOut(): void {
  void client().logoutRedirect();
}

/** ID token for the API's Authorization header; silent refresh, redirect fallback. */
export async function getIdToken(): Promise<string | null> {
  if (!isEntra) return null;
  const app = client();
  const account = app.getActiveAccount();
  if (!account) return null;
  try {
    const r: AuthenticationResult = await app.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account,
    });
    return r.idToken;
  } catch {
    signIn(); // interaction required — restart the flow
    return null;
  }
}
