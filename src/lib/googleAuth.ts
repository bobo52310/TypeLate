import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { load } from "@tauri-apps/plugin-store";
import { fetch } from "@tauri-apps/plugin-http";
import { logInfo, logError } from "@/lib/logger";

const STORE_NAME = "settings.json";
const TOKEN_KEY = "googleDriveTokens";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const SCOPES = "https://www.googleapis.com/auth/drive.appdata";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  userEmail: string;
}

/**
 * Generate a random string for PKCE code_verifier (43-128 chars)
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/**
 * Compute S256 code_challenge from code_verifier
 */
async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Start the full OAuth 2.0 PKCE flow.
 * 1. Start local TCP listener (Rust)
 * 2. Open browser for Google consent
 * 3. Wait for redirect with auth code
 * 4. Exchange code for tokens
 * 5. Fetch user email
 * 6. Store tokens
 */
export async function startOAuthFlow(clientId: string): Promise<StoredTokens> {
  if (!clientId.trim()) throw new Error("OAuth Client ID is required");

  logInfo("googleAuth", "Starting OAuth PKCE flow...");

  // 1. Generate PKCE params
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  // 2. Start local listener
  const port: number = await invoke("start_oauth_listener");
  const redirectUri = `http://127.0.0.1:${port}`;

  // 3. Build authorization URL and open in browser
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  await shellOpen(authUrl);

  // 4. Wait for the auth code
  const code: string = await invoke("await_oauth_code");

  // 5. Exchange code for tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!tokenData.access_token || !tokenData.refresh_token) {
    throw new Error("Token response missing access_token or refresh_token");
  }

  // 6. Fetch user email
  const userEmail = await fetchUserEmail(tokenData.access_token);

  // 7. Store tokens
  const tokens: StoredTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    userEmail,
  };

  await storeTokens(tokens);
  logInfo("googleAuth", `OAuth flow completed for ${userEmail}`);

  return tokens;
}

/**
 * Get stored tokens (or null if not connected)
 */
export async function getStoredTokens(): Promise<StoredTokens | null> {
  const store = await load(STORE_NAME);
  return (await store.get<StoredTokens>(TOKEN_KEY)) ?? null;
}

/**
 * Store tokens to persistent settings
 */
async function storeTokens(tokens: StoredTokens): Promise<void> {
  const store = await load(STORE_NAME);
  await store.set(TOKEN_KEY, tokens);
  await store.save();
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getValidAccessToken(clientId: string): Promise<string> {
  const tokens = await getStoredTokens();
  if (!tokens) throw new Error("Not connected to Google Drive");

  // Refresh if expiring within 60 seconds
  if (Date.now() > tokens.expiresAt - 60_000) {
    return await refreshAccessToken(clientId, tokens);
  }

  return tokens.accessToken;
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(
  clientId: string,
  tokens: StoredTokens,
): Promise<string> {
  logInfo("googleAuth", "Refreshing access token...");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    // Refresh token revoked or expired — clear stored tokens
    logError("googleAuth", "Refresh token failed, clearing stored tokens");
    await clearStoredTokens();
    throw new Error("AUTH_EXPIRED");
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  const updatedTokens: StoredTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await storeTokens(updatedTokens);
  return data.access_token;
}

/**
 * Fetch the authenticated user's email
 */
async function fetchUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) throw new Error("Failed to fetch user info");

  const data = (await response.json()) as { email: string };
  return data.email;
}

/**
 * Revoke tokens and clear local storage
 */
export async function revokeTokens(): Promise<void> {
  const tokens = await getStoredTokens();
  if (tokens) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${tokens.refreshToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // Revocation failure is non-critical
      logError("googleAuth", "Token revocation request failed (non-critical)");
    }
  }
  await clearStoredTokens();
  logInfo("googleAuth", "Disconnected from Google Drive");
}

/**
 * Clear stored tokens
 */
async function clearStoredTokens(): Promise<void> {
  const store = await load(STORE_NAME);
  await store.delete(TOKEN_KEY);
  await store.save();
}
