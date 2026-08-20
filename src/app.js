import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import { initDb, getPosts, getPost, savePost, getStats, logMetric, addTopicsToPool, getUnconsumedTopicPool, consumeTopicFromPool } from './database.js';
import { initGemini, getTrendingPsychologyTopics } from './gemini.js';
import { fetchActiveGroqModel, groqAuditCandidate, groqInterpretLogs } from './groq.js';
import { isImageProviderConfigured, generateImage } from './images.js';
import { generateCandidate, generateBatchTopics, checkUniqueness, scoreQuality, refinePostContent } from './content.js';
import { composePost } from './composer.js';
import { validateCandidateJSON, validateGeneratedImage, validateFinalPostPNG } from './validation.js';
import { tiktokRouter } from './integrations/tiktok/routes.js';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

// Ensure directories exist
const publicPath = path.join(process.cwd(), 'public');
const generatedPath = process.env.VERCEL ? '/tmp/generated' : path.join(process.cwd(), 'generated');

app.use(express.static(publicPath));
app.use('/generated', express.static(generatedPath));
app.use('/api/tiktok', tiktokRouter);

// Lazy DB & Gemini initialization middleware for Vercel Serverless
let initialized = false;
async function ensureInit() {
  if (!initialized) {
    try {
      if (process.env.VERCEL) {
        await fs.mkdir('/tmp/generated/images', { recursive: true });
        await fs.mkdir('/tmp/generated/posts', { recursive: true });
      } else {
        await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
        await fs.mkdir(path.join(process.cwd(), 'generated', 'images'), { recursive: true });
        await fs.mkdir(path.join(process.cwd(), 'generated', 'posts'), { recursive: true });
      }
    } catch (e) {}

    await initDb();
    initGemini();
    initialized = true;
  }
}

app.use(async (req, res, next) => {
  await ensureInit();
  next();
});

let isGenerating = false;
let progressLogs = [];
let scheduleState = {
  interval: 'off',
  count: 5,
  lastRun: null,
  nextRun: null
};

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  progressLogs.push(entry);
  if (progressLogs.length > 200) progressLogs.shift();
  console.log(entry);
}

app.get('/api/health', async (req, res) => {
  let groqModel = 'groq/compound';
  // Avoid idle groq API calls on health check
  // groqModel = await fetchActiveGroqModel();
  res.json({
    status: 'ok',
    gemini: !!process.env.GEMINI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    groqModel: groqModel || 'groq/compound',
    imageProvider: isImageProviderConfigured(),
    database: true,
    vercel: !!process.env.VERCEL
  });
});

app.get('/api/posts', requireAuth, async (req, res) => {
  try {
    const posts = await getPosts(req.user.open_id);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/posts/:id', async (req, res) => {
  try {
    const { deletePost } = await import('./database.js');
    const success = await deletePost(req.params.id);
    if (!success) return res.status(404).json({ error: "Post not found or could not be deleted" });
    await logMetric('post_deleted', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/approve', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.open_id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.status = 'APPROVED';
    await savePost(post, req.user.open_id);
    await logMetric('post_approved', post.id);
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/reject', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.open_id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.status = 'REJECTED';
    await savePost(post, req.user.open_id);
    await logMetric('post_rejected', post.id);
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/refine', requireAuth, async (req, res) => {
  try {
    const post = await getPost(req.params.id, req.user.open_id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    
    addLog(`🔧 AI Quality Refinement requested for topic "${post.topic}"...`);
    const refinedCandidate = await refinePostContent(post, req.body.instruction || '');
    
    Object.assign(post, refinedCandidate);
    post.quality_score = await scoreQuality(post);
    
    if (post.image_path) {
      const finalImagePath = await composePost(post, post.image_path);
      post.final_image_path = finalImagePath;
    }
    
    await savePost(post, req.user.open_id);
    await logMetric('post_refined', post.id);
    addLog(`✨ Post "${post.topic}" successfully refined and re-composed!`);
    res.json(post);
  } catch (err) {
    addLog(`❌ Post refinement failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats = await getStats(req.user.open_id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groq/insights', async (req, res) => {
  try {
    const stats = await getStats();
    const insights = await groqInterpretLogs(progressLogs, stats);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    addLog("🌐 Executing Google Search Grounding for live trending psychology research...");
    const trendingData = await getTrendingPsychologyTopics();
    await logMetric('trending_search_executed', { count: trendingData.trends?.length || 0 });
    res.json(trendingData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress', (req, res) => {
  res.json({
    isGenerating,
    logs: progressLogs,
    schedule: scheduleState
  });
});

app.get('/api/schedule', (req, res) => {
  res.json(scheduleState);
});

app.post('/api/schedule', (req, res) => {
  const { interval, count } = req.body;
  scheduleState.interval = interval || 'off';
  if (count && count >= 1 && count <= 20) {
    scheduleState.count = parseInt(count, 10);
  }
  res.json(scheduleState);
});

async function ensureTopicPoolFilled(requiredCount = 5, niche = 'Psychology') {
  let pool = await getUnconsumedTopicPool();
  if (pool.length >= requiredCount) {
    return pool;
  }

  addLog(`📦 Topic pool low (${pool.length} available). Requesting 20 fresh unique topics for ${niche} in single Gemini batch call...`);
  
  const existingPosts = await getPosts();
  const existingTopics = existingPosts.map(p => p.topic).filter(Boolean);
  
  try {
    const newTopicsBatch = await generateBatchTopics(existingTopics, 20, niche);
    await addTopicsToPool(newTopicsBatch);
    addLog(`✅ Successfully pre-audited & stored ${newTopicsBatch.length} unique topics for ${niche} in local topic pool!`);
    await logMetric('topics_pool_replenished', { count: newTopicsBatch.length });
  } catch (err) {
    addLog(`⚠️ Topic batch pre-generation notice: ${err.message}`);
  }

  return await getUnconsumedTopicPool();
}

async function runGenerationBatch(targetCount = 10, seedTopic = null, userId = null, niche = 'Psychology') {
  if (isGenerating) return;
  isGenerating = true;
  
  addLog(`🚀 Starting batch generation of ${targetCount} posts for niche: ${niche}...`);
  await logMetric('batch_started', { count: targetCount, seedTopic });
  
  try {
    let successCount = 0;

    if (!seedTopic) {
      await ensureTopicPoolFilled(targetCount, niche);
    }
    
    for (let i = 0; i < targetCount; i++) {
      const postNumber = i + 1;
      addLog(`\n--- Post ${postNumber}/${targetCount} ---`);
      
      let attempts = 0;
      let candidate = null;
      let uniqueInfo = null;
      let qualityScore = 0;
      let poolItem = null;
      let targetTopicName = seedTopic;

      const post = {
        id: uuidv4(),
        status: 'GENERATING',
        created_at: new Date().toISOString()
      };
      
      await savePost(post, userId);
      
      while (attempts < 10) {
        attempts++;
        
        if (!seedTopic && !poolItem) {
          const currentPool = await getUnconsumedTopicPool();
          if (currentPool.length > 0) {
            poolItem = currentPool[0];
            targetTopicName = poolItem.topic;
          } else {
            await ensureTopicPoolFilled(5, niche);
            continue;
          }
        }
        
        addLog(`🧠 Post ${postNumber}/${targetCount} [Attempt ${attempts}/10]: Generating content for "${targetTopicName || 'Unique Topic'}"...`);
        
        try {
          const existingPosts = await getPosts();
          const existingTopics = existingPosts.map(p => p.topic).filter(Boolean);
          
          candidate = await generateCandidate(existingTopics, targetTopicName, niche);
          addLog(`💡 Concept generated: "${candidate.topic}" (${candidate.category})`);
          
          uniqueInfo = await checkUniqueness(candidate);
          if (!uniqueInfo.isUnique) {
            addLog(`❌ Post ${postNumber}/${targetCount} Rejected: ${uniqueInfo.reason || 'Duplicate topic/content'}`);
            await logMetric('repetition_blocked', { topic: candidate.topic, reason: uniqueInfo.reason });
            
            if (!seedTopic && poolItem) {
               await consumeTopicFromPool(poolItem.id);
               poolItem = null;
               targetTopicName = null;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }
          addLog(`✓ Uniqueness verified (Similarity: ${(uniqueInfo.similarityScore * 100).toFixed(1)}%)`);
          
          qualityScore = await scoreQuality(candidate);
          if (qualityScore < 80) {
            addLog(`❌ Post ${postNumber}/${targetCount} Rejected: Low Quality (${qualityScore}/100)`);
            await logMetric('low_quality_rejected', { topic: candidate.topic, score: qualityScore });
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }

          addLog(`🤖 Groq Supervisor: Auditing candidate topic & scientific clarity...`);
          const groqAudit = await groqAuditCandidate(candidate, existingTopics);
          if (!groqAudit.approved) {
            addLog(`❌ Groq Audit Rejected: ${groqAudit.audit_notes}`);
            await logMetric('groq_audit_rejected', { topic: candidate.topic, notes: groqAudit.audit_notes });
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }
          
          addLog(`⭐ Quality & Groq audit passed (${qualityScore}/100 - ${groqAudit.audit_notes})`);
          break;
        } catch (err) {
          addLog(`⚠️ Candidate generation notice: ${err.message}`);
          await logMetric('api_error', { message: err.message });
          
          const msgLower = (err.message || '').toLowerCase();
          if (msgLower.includes(' 429 ') || msgLower.includes('quota') || msgLower.includes('rate limit')) {
            await logMetric('api_429', { message: err.message });
            let waitSeconds = 15;
            const match = err.message.match(/retry in ([0-9.]+)s/i) || err.message.match(/retryDelay"?:\s*"([0-9]+)s?"/i);
            if (match && match[1]) {
              waitSeconds = Math.ceil(parseFloat(match[1])) + 2;
            }
            addLog(`⏳ Quota limit hit. Intelligently pausing pipeline for ${waitSeconds}s as requested by API...`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
          } else {
            addLog(`💥 Fatal API error: ${err.message}. Aborting retries for this attempt.`);
            break;
          }
          if (attempts === 10) throw err;
        }
      }

      if (poolItem) {
        await consumeTopicFromPool(poolItem.id);
      }
      
      if (!candidate || !uniqueInfo.isUnique || qualityScore < 80) {
        post.status = 'FAILED';
        post.error = "Failed to generate unique, high-quality content after 10 attempts";
        await savePost(post);
        await logMetric('post_failed', { id: post.id });
        addLog(`💥 Post ${postNumber}/${targetCount} marked FAILED (Max retries reached).`);
        continue;
      }
      
      Object.assign(post, candidate, {
        similarity_score: uniqueInfo.similarityScore,
        quality_score: qualityScore
      });
      
      let imgAttempts = 0;
      let bgImagePath = null;
      addLog(`🎨 Post ${postNumber}/${targetCount}: Generating dynamic mood-matched background image...`);
      
      while (imgAttempts < 3) {
        imgAttempts++;
        try {
          bgImagePath = await generateImage(candidate.image_prompt);
          await validateGeneratedImage(bgImagePath);
          addLog(`✓ Background image saved & validated (${bgImagePath})`);
          break;
        } catch (err) {
          addLog(`⚠️ Image generation retry (${imgAttempts}/3): ${err.message}`);
          if (imgAttempts === 3) {
            post.status = 'FAILED';
            post.error = `Image generation failed: ${err.message}`;
            await savePost(post, userId);
            await logMetric('image_failed', { id: post.id, error: err.message });
            addLog(`💥 Post ${postNumber}/${targetCount} image generation failed.`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }
      
      if (!bgImagePath) continue;
      post.image_path = bgImagePath;
      
      try {
        addLog(`🖼️ Post ${postNumber}/${targetCount}: Composing 1080x1920 PNG post...`);
        const finalImagePath = await composePost(post, bgImagePath);
        await validateFinalPostPNG(finalImagePath);
        
        post.final_image_path = finalImagePath;
        post.status = 'READY';
        await savePost(post, userId);
        await logMetric('post_success', { id: post.id, topic: post.topic });
        successCount++;
        addLog(`✅ Post ${postNumber}/${targetCount} SUCCESS! Final PNG ready.`);
      } catch (err) {
        addLog(`💥 Post ${postNumber}/${targetCount} Composition error: ${err.message}`);
        post.status = 'FAILED';
        post.error = `Composition failed: ${err.message}`;
        await savePost(post, userId);
        await logMetric('composition_failed', { id: post.id, error: err.message });
      }
    }
    
    addLog(`\n🎉 Batch complete! ${successCount}/${targetCount} posts ready.`);
    await logMetric('batch_completed', { successCount, targetCount });
  } catch (err) {
    addLog(`💥 Batch generation fatal error: ${err.message}`);
  } finally {
    isGenerating = false;
  }
}

app.post('/api/generate', requireAuth, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: "GEMINI_API_KEY is not configured" });
  }
  if (!isImageProviderConfigured()) {
    return res.status(400).json({ error: "IMAGE PROVIDER NOT AVAILABLE" });
  }
  if (isGenerating) {
    return res.status(409).json({ error: "Generation already in progress" });
  }
  
  const count = parseInt(req.body.count || 10, 10);
  const targetCount = (count >= 1 && count <= 20) ? count : 10;
  
  // The 'topic' from the UI is meant to be the broad niche for the batch, not an exact post title.
  // We'll pass it as 'niche', and leave 'seedTopic' null so the pool generates sub-topics.
  const niche = req.body.topic || 'Psychology';
  
  progressLogs = [];
  const userId = req.user.open_id;
  runGenerationBatch(targetCount, null, userId, niche);
  
  res.json({ message: `Generation started for ${targetCount} posts`, expectedCount: targetCount });
});

export default app;
