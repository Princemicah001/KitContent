import { tiktokApiFetch } from './client.js';
import { getValidAccessToken } from './tokens.js';

export async function getCreatorInfo() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Not connected to TikTok");

  const response = await tiktokApiFetch('/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.error || (response.data && response.data.error_code !== 0)) {
    throw new Error(response.error_description || "Failed to query creator info");
  }

  return response.data || response;
}
