import crypto from 'crypto';
import { tiktokApiFetch } from './client.js';
import { saveTikTokAccount, deleteTikTokAccount } from '../../database.js';

function base64URLEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function getAuthorizationUrl(req) {
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(crypto.createHash('sha256').update(codeVerifier).digest());
  
  // Store state securely in a cookie or session. We'll use a secure HTTP-only cookie.
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3000/api/tiktok/callback';
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.append('client_key', clientKey);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', 'user.info.basic,video.publish');
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('state', state);
  url.searchParams.append('code_challenge', codeChallenge);
  url.searchParams.append('code_challenge_method', 'S256');

  return { url: url.toString(), state, codeVerifier };
}

export async function handleCallback(code, state, savedState, savedVerifier) {
  if (!state || state !== savedState) {
    throw new Error("Invalid authorization state. Potential CSRF attack.");
  }
  if (!code) {
    throw new Error("Missing authorization code.");
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3000/api/tiktok/callback';

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: savedVerifier
  });

  const response = await tiktokApiFetch('/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: body.toString()
  });

  if (response.error || (response.data && response.data.error_code !== 0)) {
    throw new Error(response.error_description || "Failed to exchange token");
  }

  const data = response.data || response; // Sometimes wrapped in 'data' field? Actually TikTok docs say it is in 'data' or top-level. Let's handle both.
  
  const tokenData = response.open_id ? response : response.data;

  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;

  await saveTikTokAccount({
    open_id: tokenData.open_id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: expiresAt,
    scope: tokenData.scope
  });
}

export async function disconnectAccount() {
  // In a full implementation we should revoke the token with TikTok's revoke endpoint.
  // For now we just delete local storage as requested by disconnect.
  await deleteTikTokAccount();
}
