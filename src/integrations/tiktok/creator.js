import { tiktokApiFetch } from './client.js';
import { getValidAccessToken } from './tokens.js';

export async function getCreatorInfo(openId) {
  const accessToken = await getValidAccessToken(openId);
  if (!accessToken) throw new Error("Not connected to TikTok");

  const response = await tiktokApiFetch('/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  const hasDataError = response.data && 'error_code' in response.data && response.data.error_code !== 0;
  if ((response.error && response.error.code !== 'ok' && response.error.code !== 0) || hasDataError) {
    throw new Error(response.error_description || (response.data && response.data.error_message) || JSON.stringify(response));
  }

  return response.data || response;
}
