import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { initDb, getPosts, getPost, savePost, getStats, logMetric, addTopicsToPool, getUnconsumedTopicPool, consumeTopicFromPool } from './database.js';
import { initGemini, getTrendingPsychologyTopics } from './gemini.js';
import { fetchActiveGroqModel, groqAuditCandidate, groqInterpretLogs } from './groq.js';
import { isImageProviderConfigured, generateImage } from './images.js';
import { generateCandidate, generateBatchTopics, checkUniqueness, scoreQuality, refinePostContent } from './content.js';
import { composePost } from './composer.js';
import { validateCandidateJSON, validateGeneratedImage, validateFinalPostPNG } from './validation.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/generated', express.static('generated'));

let isGenerating = false;
let progressLogs = [];
let scheduleState = {
  interval: 'off',
  count: 5,
  lastRun: null,
  nextRun: null
};
let scheduleTimer = null;

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  progressLogs.push(entry);
  if (progressLogs.length > 200) progressLogs.shift();
  console.log(entry);
}

app.get('/api/health', async (req, res) => {
  let groqModel = 'groq/compound';
  try {
    groqModel = await fetchActiveGroqModel();
  } catch (e) {
    console.warn("Groq model check:", e.message);
  }
  res.json({
    status: 'ok',
    gemini: !!process.env.GEMINI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    groqModel: groqModel || 'groq/compound',
    imageProvider: isImageProviderConfigured(),
    database: true
  });
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await getPosts();
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

app.post('/api/posts/:id/approve', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.status = 'APPROVED';
    await savePost(post);
    await logMetric('post_approved', post.id);
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/reject', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    post.status = 'REJECTED';
    await savePost(post);
    await logMetric('post_rejected', post.id);
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/posts/:id/refine', async (req, res) => {
  try {
    const post = await getPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    
    addLog(`🔧 AI Quality Refinement requested for topic "${post.topic}"...`);
    const refinedCandidate = await refinePostContent(post, req.body.instruction || '');
    
    Object.assign(post, refinedCandidate);
    post.quality_score = await scoreQuality(post);
    
    if (post.image_path) {
      const finalImagePath = await composePost(post, post.image_path);
      post.final_image_path = finalImagePath;
    }
    
    await savePost(post);
    await logMetric('post_refined', post.id);
    addLog(`✨ Post "${post.topic}" successfully refined and re-composed!`);
    res.json(post);
  } catch (err) {
    addLog(`❌ Post refinement failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
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
  
  if (!['off', '1h', '6h', '12h', '24h'].includes(interval)) {
    return res.status(400).json({ error: "Invalid schedule interval" });
  }
  
  scheduleState.interval = interval;
  if (count && count >= 1 && count <= 20) {
    scheduleState.count = parseInt(count, 10);
  }
  
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  
  if (interval === 'off') {
    scheduleState.nextRun = null;
    addLog("🗓️ Generation schedule turned OFF.");
    return res.json(scheduleState);
  }
  
  let ms = 3600000;
  if (interval === '6h') ms = 6 * 3600000;
  if (interval === '12h') ms = 12 * 3600000;
  if (interval === '24h') ms = 24 * 3600000;
  
  scheduleState.nextRun = new Date(Date.now() + ms).toISOString();
  addLog(`🗓️ Scheduled generation set to '${interval}' (${scheduleState.count} posts/batch). Next run at ${new Date(scheduleState.nextRun).toLocaleTimeString()}`);
  
  scheduleTimer = setInterval(async () => {
    addLog(`⏰ Scheduled batch trigger activated (${scheduleState.count} posts)...`);
    scheduleState.lastRun = new Date().toISOString();
    scheduleState.nextRun = new Date(Date.now() + ms).toISOString();
    await runGenerationBatch(scheduleState.count);
  }, ms);
  
  res.json(scheduleState);
});

async function ensureTopicPoolFilled(requiredCount = 5) {
  let pool = await getUnconsumedTopicPool();
  if (pool.length >= requiredCount) {
    return pool;
  }

  addLog(`📦 Topic pool low (${pool.length} available). Requesting 20 fresh unique topics in single Gemini batch call...`);
  
  const existingPosts = await getPosts();
  const existingTopics = existingPosts.map(p => p.topic).filter(Boolean);
  
  try {
    const newTopicsBatch = await generateBatchTopics(existingTopics, 20);
    await addTopicsToPool(newTopicsBatch);
    addLog(`✅ Successfully pre-audited & stored ${newTopicsBatch.length} unique topics in local topic pool!`);
    await logMetric('topics_pool_replenished', { count: newTopicsBatch.length });
  } catch (err) {
    addLog(`⚠️ Topic batch pre-generation notice: ${err.message}`);
  }

  return await getUnconsumedTopicPool();
}

async function runGenerationBatch(targetCount = 10, seedTopic = null) {
  if (isGenerating) return;
  isGenerating = true;
  
  addLog(`🚀 Starting batch generation of ${targetCount} posts...`);
  await logMetric('batch_started', { count: targetCount, seedTopic });
  
  try {
    let successCount = 0;

    if (!seedTopic) {
      await ensureTopicPoolFilled(targetCount);
    }
    
    for (let i = 0; i < targetCount; i++) {
      const postNumber = i + 1;
      addLog(`\n--- Post ${postNumber}/${targetCount} ---`);
      
      let attempts = 0;
      let candidate = null;
      let uniqueInfo = null;
      let qualityScore = 0;
      let poolItem = null;

      if (!seedTopic) {
        const currentPool = await getUnconsumedTopicPool();
        if (currentPool.length > 0) {
          poolItem = currentPool[0];
        }
      }
      
      const targetTopicName = seedTopic || (poolItem ? poolItem.topic : null);

      const post = {
        id: uuidv4(),
        status: 'GENERATING',
        created_at: new Date().toISOString()
      };
      
      await savePost(post);
      
      while (attempts < 10) {
        attempts++;
        addLog(`🧠 Post ${postNumber}/${targetCount} [Attempt ${attempts}/10]: Generating content for "${targetTopicName || 'Unique Topic'}"...`);
        
        try {
          const existingPosts = await getPosts();
          const existingTopics = existingPosts.map(p => p.topic).filter(Boolean);
          
          candidate = await generateCandidate(existingTopics, targetTopicName);
          addLog(`💡 Concept generated: "${candidate.topic}" (${candidate.category})`);
          
          uniqueInfo = await checkUniqueness(candidate);
          if (!uniqueInfo.isUnique) {
            addLog(`❌ Post ${postNumber}/${targetCount} Rejected: ${uniqueInfo.reason || 'Duplicate topic/content'}`);
            await logMetric('repetition_blocked', { topic: candidate.topic, reason: uniqueInfo.reason });
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
          
          if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('rate')) {
            await logMetric('api_429', { message: err.message });
            let waitSeconds = 20;
            const match = err.message.match(/retry in ([0-9.]+)s/i) || err.message.match(/retryDelay"?:\s*"([0-9]+)s?"/i);
            if (match && match[1]) {
              waitSeconds = Math.ceil(parseFloat(match[1])) + 2;
            }
            addLog(`⏳ Quota limit hit. Intelligently pausing pipeline for ${waitSeconds}s as requested by API...`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
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
            await savePost(post);
            await logMetric('image_failed', { id: post.id, error: err.message });
            addLog(`💥 Post ${postNumber}/${targetCount} image generation failed.`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
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
        await savePost(post);
        await logMetric('post_success', { id: post.id, topic: post.topic });
        successCount++;
        addLog(`✅ Post ${postNumber}/${targetCount} SUCCESS! Final PNG ready.`);
      } catch (err) {
        addLog(`💥 Post ${postNumber}/${targetCount} Composition error: ${err.message}`);
        post.status = 'FAILED';
        post.error = `Composition failed: ${err.message}`;
        await savePost(post);
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

app.post('/api/generate', async (req, res) => {
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
  
  progressLogs = [];
  runGenerationBatch(targetCount, req.body.topic || null);
  
  res.json({ message: `Generation started for ${targetCount} posts`, expectedCount: targetCount });
});

const PORT = process.env.PORT || 3000;
async function start() {
  await initDb();
  initGemini();
  app.listen(PORT, () => {
    console.log(`KitContent Server running on port ${PORT}`);
    fetchActiveGroqModel().then(m => console.log(`Groq Supervisor active: ${m}`)).catch(e => {});
  });
}

start();
