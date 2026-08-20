import express from 'express';
import { getAuthorizationUrl, handleCallback, disconnectAccount } from './oauth.js';
import { getCreatorInfo } from './creator.js';
import { publishPhotoToTikTok } from './publishing.js';
import { getTikTokAccount, createSession, getSession, deleteSession, deleteTikTokAccount, getPost } from '../../database.js';

export const tiktokRouter = express.Router();

tiktokRouter.get('/connect', (req, res) => {
  let protocol = req.headers['x-forwarded-proto'] || req.protocol;
  if (protocol.includes(',')) protocol = protocol.split(',')[0].trim();
  // Force HTTPS if on Render
  if (req.get('host').includes('onrender.com')) protocol = 'https';
  
  const host = req.get('host');
  const dynamicRedirectUri = `${protocol}://${host}/api/tiktok/callback`;
  const { url, state, codeVerifier } = getAuthorizationUrl(req, dynamicRedirectUri);
  // Send state and PKCE code_verifier back in HttpOnly cookies
  const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 10, sameSite: 'lax' };
  res.cookie('tiktok_oauth_state', state, cookieOpts);
  res.cookie('tiktok_code_verifier', codeVerifier, cookieOpts);
  res.redirect(url);
});

tiktokRouter.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const savedState = req.headers.cookie?.split('tiktok_oauth_state=')[1]?.split(';')[0];
  const savedVerifier = req.headers.cookie?.split('tiktok_code_verifier=')[1]?.split(';')[0];
  let protocol = req.headers['x-forwarded-proto'] || req.protocol;
  if (protocol.includes(',')) protocol = protocol.split(',')[0].trim();
  if (req.get('host').includes('onrender.com')) protocol = 'https';
  
  const host = req.get('host');
  const dynamicRedirectUri = `${protocol}://${host}/api/tiktok/callback`;

  try {
    if (error) throw new Error(error_description || error);
    const openId = await handleCallback(code, state, savedState, savedVerifier, dynamicRedirectUri);
    const sessionId = await createSession(openId);
    
    // Set session cookie
    const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7, sameSite: 'lax' };
    res.cookie('session_id', sessionId, cookieOpts);
    
    res.redirect('/?tiktok_connected=true');
  } catch (err) {
    console.error("TikTok callback error:", err.message);
    res.redirect(`/?tiktok_error=${encodeURIComponent(err.message)}`);
  }
});

tiktokRouter.get('/status', async (req, res) => {
  try {
    const cookies = req.headers.cookie;
    if (!cookies) return res.json({ connected: false });
    
    const sessionId = cookies.split('session_id=')[1]?.split(';')[0];
    if (!sessionId) return res.json({ connected: false });
    
    const session = await getSession(sessionId);
    if (!session) return res.json({ connected: false });
    
    const account = await getTikTokAccount(session.open_id);
    if (!account) {
      return res.json({ connected: false });
    }
    
    // We can also verify token and get creator info here
    try {
      const creatorInfo = await getCreatorInfo(session.open_id);
      res.json({
        connected: true,
        creator: creatorInfo.creator_nickname || creatorInfo.creator_username || "Creator",
        privacy_options: creatorInfo.privacy_level_options || []
      });
    } catch (e) {
      console.error("getCreatorInfo Error:", e.message);
      // If we fail to get creator info, token might be expired or revoked or missing scopes
      res.json({ connected: true, error: "Requires Reauthorization: " + e.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tiktokRouter.post('/disconnect', async (req, res) => {
  try {
    const cookies = req.headers.cookie;
    if (cookies) {
      const sessionId = cookies.split('session_id=')[1]?.split(';')[0];
      if (sessionId) {
        const session = await getSession(sessionId);
        if (session) {
          await deleteTikTokAccount(session.open_id);
          await deleteSession(sessionId);
        }
      }
    }
    res.clearCookie('session_id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tiktokRouter.post('/publish/:postId', async (req, res) => {
  try {
    const cookies = req.headers.cookie;
    if (!cookies) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = cookies.split('session_id=')[1]?.split(';')[0];
    if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });
    const session = await getSession(sessionId);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    
    const post = await getPost(req.params.postId, session.open_id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const { privacy_level = "SELF_ONLY", disable_comment = false, auto_add_music = true } = req.body;
    
    let protocol = req.headers['x-forwarded-proto'] || req.protocol;
    if (protocol.includes(',')) protocol = protocol.split(',')[0].trim();
    if (req.get('host').includes('onrender.com')) protocol = 'https';
    const host = req.get('host');
    const dynamicBaseUrl = `${protocol}://${host}`;
    
    const payloadLog = {
      post_info: {
        title: post.hook || "Generated Post",
        privacy_level: privacy_level,
        disable_comment: disable_comment,
        auto_add_music: auto_add_music,
        brand_content_toggle: false,
        brand_organic_toggle: false
      },
      source_info: { source: "PULL_FROM_URL", photo_images: [`${dynamicBaseUrl}/${post.final_image_path}`] }
    };
    
    try {
      const result = await publishPhotoToTikTok(post, privacy_level, disable_comment, auto_add_music, dynamicBaseUrl, session.open_id);
      res.json({ success: true, publish_id: result.publish_id });
    } catch (publishErr) {
      res.status(500).json({ error: publishErr.message, payload: payloadLog });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tiktokRouter.get('/debug-url', (req, res) => {
  let protocol = req.headers['x-forwarded-proto'] || req.protocol;
  if (protocol.includes(',')) protocol = protocol.split(',')[0].trim();
  if (req.get('host').includes('onrender.com')) protocol = 'https';
  
  const host = req.get('host');
  const dynamicRedirectUri = `${protocol}://${host}/api/tiktok/callback`;
  const finalUri = dynamicRedirectUri;
  
  res.send(`
    <h3>TikTok Debug</h3>
    <p><strong>Host:</strong> ${host}</p>
    <p><strong>Protocol:</strong> ${protocol}</p>
    <p><strong>Generated URI:</strong> ${dynamicRedirectUri}</p>
    <p><strong>Environment TIKTOK_REDIRECT_URI:</strong> ${process.env.TIKTOK_REDIRECT_URI || 'Not Set'}</p>
    <p><strong>Final URI sent to TikTok:</strong> ${finalUri}</p>
    <hr>
    <p>You MUST copy the <b>Final URI sent to TikTok</b> exactly as it is shown above and paste it into the Redirect URI whitelist in your TikTok Developer Portal!</p>
  `);
});
