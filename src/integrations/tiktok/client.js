export async function tiktokApiFetch(endpoint, options = {}) {
  const baseUrl = process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com';
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, options);
  
  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
    } catch (e) {
      errorData = { message: response.statusText };
    }
    
    const errorMsg = errorData.error?.message || errorData.message || `TikTok API error ${response.status}`;
    
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = errorData;
    throw err;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  }
  return await response.text();
}
