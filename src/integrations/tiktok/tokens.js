import { getTikTokAccount, saveTikTokAccount } from '../../database.js';
import { tiktokApiFetch } from './client.js';

export async function getValidAccessToken() {
  const account = await getTikTokAccount();
  if (!account) return null;

  const now = Math.floor(Date.now() / 1000);
  
  // If token is valid for at least 5 more minutes, use it
  if (account.expires_at > now + 300) {
    return account.access_token;
  }

  // Need to refresh
  try {
    const refreshed = await refreshAccessToken(account.refresh_token);
    
    await saveTikTokAccount({
      open_id: refreshed.open_id,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: now + refreshed.expires_in,
      scope: refreshed.scope
    });
    
    return refreshed.access_token;
  } catch (err) {
    console.error("TikTok token refresh failed:", err.message);
    throw new Error("TikTok authorization expired. Please reconnect your account.");
  }
}

async function refreshAccessToken(refreshToken) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const response = await tiktokApiFetch('/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: body.toString()
  });

  const hasDataError = response.data && 'error_code' in response.data && response.data.error_code !== 0;
  if ((response.error && response.error.code !== 'ok' && response.error.code !== 0) || hasDataError) {
    throw new Error(response.error_description || response.message || "Failed to refresh token");
  }

  return response.data || response; // TikTok might wrap in 'data' depending on endpoint
}
