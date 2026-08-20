import { tiktokApiFetch } from './client.js';
import { getValidAccessToken } from './tokens.js';
import { getCreatorInfo } from './creator.js';
import { savePost } from '../../database.js';

export async function publishPhotoToTikTok(post, privacyLevel, disableComment, autoAddMusic) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error("Not connected to TikTok");

  // Validate we have a final image path
  if (!post.final_image_path) {
    throw new Error("No final image generated for this post");
  }

  // Generate public URL (assumes the server is accessible on the internet)
  // Vercel deployment handles this, local might need ngrok, but we assume KitContent domain for prod
  const baseUrl = process.env.PUBLIC_URL || 'https://kitcontent.lexshub.xyz';
  let imageUrl = `${baseUrl}/${post.final_image_path}`;
  if (!imageUrl.startsWith('http')) imageUrl = `https://${imageUrl}`;

  // Make sure privacy level is allowed by creator info
  const creatorInfo = await getCreatorInfo();
  const allowedPrivacy = creatorInfo.privacy_level_options || ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'];
  if (!allowedPrivacy.includes(privacyLevel)) {
    throw new Error(`Privacy level '${privacyLevel}' is not supported for this creator.`);
  }

  // Construct caption
  // Max 2200 chars for TikTok description
  let description = `${post.body || ''}\n\n${(post.hashtags || []).join(' ')}`;
  if (description.length > 2000) {
    description = description.substring(0, 2000);
  }

  const payload = {
    post_info: {
      title: post.hook || "Generated Post",
      description: description,
      privacy_level: privacyLevel,
      disable_comment: disableComment,
      auto_add_music: autoAddMusic
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: 0,
      photo_images: [imageUrl]
    },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO"
  };

  try {
    const response = await tiktokApiFetch('/v2/post/publish/content/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if ((response.error && response.error.code !== 'ok' && response.error.code !== 0) || (response.data && response.data.error_code !== 0)) {
      throw new Error(response.error.message || (response.data && response.data.error_message) || JSON.stringify(response));
    }

    const data = response.data || response;
    
    if (data && data.publish_id) {
      post.tiktok_publish_id = data.publish_id;
      post.tiktok_status = "PUBLISHING";
      post.tiktok_published_at = new Date().toISOString();
      post.tiktok_error = null;
      await savePost(post);
      return data;
    } else {
      throw new Error("TikTok did not return a publish_id");
    }
  } catch (err) {
    post.tiktok_status = "FAILED";
    post.tiktok_error = err.message;
    await savePost(post);
    throw err;
  }
}
