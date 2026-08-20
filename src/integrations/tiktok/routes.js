import express from 'express';
import { getAuthorizationUrl, handleCallback, disconnectAccount } from './oauth.js';
import { getCreatorInfo } from './creator.js';
import { publishPhotoToTikTok } from './publishing.js';
import { getTikTokAccount } from '../../database.js';
import { getPost } from '../../database.js';

export const tiktokRouter = express.Router();

tiktokRouter.get('/connect', (req, res) => {
  const { url, state, codeVerifier } = getAuthorizationUrl(req);
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

  try {
    if (error) throw new Error(error_description || error);
    await handleCallback(code, state, savedState, savedVerifier);
    res.redirect('/?tiktok_connected=true');
  } catch (err) {
    console.error("TikTok callback error:", err.message);
    res.redirect(`/?tiktok_error=${encodeURIComponent(err.message)}`);
  }
});

tiktokRouter.get('/status', async (req, res) => {
  try {
    const account = await getTikTokAccount();
    if (!account) {
      return res.json({ connected: false });
    }
    
    // We can also verify token and get creator info here
    try {
      const creatorInfo = await getCreatorInfo();
      res.json({
        connected: true,
        creator: creatorInfo.creator_nickname || creatorInfo.creator_username || "Creator",
        privacy_options: creatorInfo.privacy_level_options || []
      });
    } catch (e) {
      // If we fail to get creator info, token might be expired or revoked
      res.json({ connected: true, error: "Requires Reauthorization" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tiktokRouter.post('/disconnect', async (req, res) => {
  try {
    await disconnectAccount();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

tiktokRouter.post('/publish/:postId', async (req, res) => {
  try {
    const post = await getPost(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const { privacy_level = "SELF_ONLY", disable_comment = false, auto_add_music = true } = req.body;
    
    const result = await publishPhotoToTikTok(post, privacy_level, disable_comment, auto_add_music);
    res.json({ success: true, publish_id: result.publish_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
