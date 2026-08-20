import { generateContentJSON } from './gemini.js';
import { getDb, getPosts } from './database.js';

function getSystemPrompt(niche = 'Psychology') {
  return `
You are an expert content creator.
Generate original, visually consistent social media post content focused on ${niche}.

RULES:
- Do not invent scientific studies or statistics.
- Do not fabricate experts.
- Do not create fake quotations.
- Do not present speculation as fact.
- Do not use absolute claims unless universally true.
- Prefer cautious language (e.g., "research suggests", "one possible explanation").
- Avoid repetitive openings ("Did you know...", "Here are 5...").
- Keep tone intelligent, empathetic, and professional.

IMAGE PROMPT REQUIREMENT:
- Dynamically match the VISUAL & ARTISTIC STYLE directly to the EMOTIONAL TONE and core theme of the concept:
  - Bright, vivid, golden natural sunlight for joy, growth, or clarity.
  - Dark, atmospheric, moody cinematic lighting for solitude, focus, or deep reflection.
  - Minimalist vector illustration or geometric art for logic, decisions, or mental models.
  - Clear, crisp photorealistic portrait/landscape for real-world social interaction or empathy.
- Do NOT restrict images to antique, vintage, or 35mm film styles unless specifically relevant.
- Always end the image_prompt with: "high resolution, vertical 9:16 composition, rich lighting, artistic depth, no text."

LENGTH RULES (STRICT MAXIMUMS - DO NOT EXCEED TO PREVENT UI OVERFLOW):
- hook: 5-12 words max
- body: 15-30 words max
- takeaway: 8-15 words max
- caption: 15-40 words

JSON FORMAT EXACTLY:
{
  "category": "${niche}",
  "topic": "String",
  "hook": "String",
  "body": "String",
  "takeaway": "String",
  "caption": "String",
  "hashtags": ["#tag1", "#tag2"],
  "image_prompt": "Descriptive visual scene matching the emotion..."
}
`;
}

function normalizeTopic(topicStr) {
  if (!topicStr) return '';
  return topicStr
    .toLowerCase()
    .replace(/\b(the|a|an|effect|bias|phenomenon|rule|syndrome|law|theory|principle)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

export async function checkUniqueness(candidate) {
  const existingPosts = await getPosts();
  const candNorm = normalizeTopic(candidate.topic);
  const candidateText = `${candidate.topic} ${candidate.hook} ${candidate.body} ${candidate.takeaway}`;
  
  let maxSimilarity = 0;
  
  for (const post of existingPosts) {
    if (!post.topic) continue;
    const existNorm = normalizeTopic(post.topic);
    
    // Strict Topic Deduplication: Check normalized topic match
    if (candNorm && existNorm && (candNorm === existNorm || candNorm.includes(existNorm) || existNorm.includes(candNorm))) {
      return {
        isUnique: false,
        similarityScore: 1.0,
        reason: `Topic '${candidate.topic}' duplicates previously generated concept '${post.topic}'`
      };
    }

    const candFiltered = candidate.topic.toLowerCase().replace(/\b(the|a|an|effect|bias|phenomenon|rule|syndrome|law|theory|principle)\b/g, '');
    const existFiltered = post.topic.toLowerCase().replace(/\b(the|a|an|effect|bias|phenomenon|rule|syndrome|law|theory|principle)\b/g, '');
    
    const topicSim = calculateSimilarity(candFiltered, existFiltered);
    if (topicSim > 0.55) {
      return {
        isUnique: false,
        similarityScore: topicSim,
        reason: `Topic '${candidate.topic}' is conceptually too similar to '${post.topic}' (${(topicSim * 100).toFixed(0)}% match)`
      };
    }
    
    const existingText = `${post.topic} ${post.hook} ${post.body} ${post.takeaway}`;
    const sim = calculateSimilarity(candidateText, existingText);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
    }
  }
  
  const threshold = 0.45;
  
  return {
    isUnique: maxSimilarity < threshold,
    similarityScore: maxSimilarity,
    reason: maxSimilarity >= threshold ? `Content text similarity too high (${(maxSimilarity * 100).toFixed(0)}%)` : undefined
  };
}

export async function scoreQuality(candidate) {
  let score = 100;
  
  const hookWords = candidate.hook.split(' ').length;
  if (hookWords > 15) score -= 10;
  
  const bodyWords = candidate.body.split(' ').length;
  if (bodyWords > 35) score -= 10;
  
  const lowerHook = candidate.hook.toLowerCase();
  if (lowerHook.includes("psychology says") || lowerHook.includes("did you know")) {
    score -= 20;
  }
  
  return Math.max(50, score);
}

export async function generateBatchTopics(existingTopics = [], count = 20, niche = 'Psychology') {
  const cleanTopicsList = existingTopics.filter(Boolean);
  let avoidTopicsPrompt = "";
  if (cleanTopicsList.length > 0) {
    avoidTopicsPrompt = `\nDO NOT repeat any of these previously covered topics:\n- ${cleanTopicsList.join('\n- ')}`;
  }

  const prompt = `Generate a JSON object with a 'topics' array containing AT LEAST ${count} COMPLETELY UNIQUE ${niche} concepts.${avoidTopicsPrompt}
Each item in the array must be an object with keys:
{
  "topics": [
    { "topic": "Concept Name", "category": "${niche}" }
  ]
}`;

  const res = await generateContentJSON(prompt, getSystemPrompt(niche));
  const rawList = res.topics || [];
  
  const uniqueBatch = [];
  const existingSet = new Set(existingTopics.map(t => normalizeTopic(t)));

  for (const item of rawList) {
    const topicStr = typeof item === 'string' ? item : item.topic;
    if (!topicStr) continue;
    const norm = normalizeTopic(topicStr);
    if (!existingSet.has(norm)) {
      existingSet.add(norm);
      uniqueBatch.push({
        topic: topicStr,
        category: item.category || niche
      });
    }
  }

  return uniqueBatch;
}

export async function generateCandidate(existingTopics = [], targetTopic = null, niche = 'Psychology') {
  let topicInstruction = "";
  if (targetTopic) {
    topicInstruction = `\nFOCUS SPECIFICALLY on the concept: "${targetTopic}". Do NOT change the topic title.`;
  } else if (existingTopics.length > 0) {
    topicInstruction = `\nDO NOT generate content about any of the following previously covered topics:\n- ${existingTopics.slice(0, 30).join('\n- ')}`;
  }

  const prompt = `Generate one unique ${niche} social media post.${topicInstruction}
Return ONLY a JSON object with EXACTLY these keys:
{
  "category": "${niche}",
  "topic": "${targetTopic || 'Unique Topic Name'}",
  "hook": "5-12 word short punchy hook sentence",
  "body": "15-30 word extremely concise informative text explaining the concept",
  "takeaway": "8-15 word short actionable or reflective takeaway",
  "caption": "15-40 word caption for social media",
  "hashtags": ["#${niche.replace(/\s+/g, '')}"],
  "image_prompt": "Descriptive visual scene matching the emotion (can be bright, dark cinematic, illustrative, photorealistic, minimalist depending on mood)... vertical 9:16 composition, high resolution, no text."
}`;

  const candidate = await generateContentJSON(prompt, getSystemPrompt(niche));
  
  candidate.category = candidate.category || niche;
  candidate.topic = targetTopic || candidate.topic || candidate.title || "Human Behavior";
  candidate.hook = candidate.hook || candidate.title || candidate.headline || "";
  candidate.body = candidate.body || candidate.content || candidate.explanation || candidate.description || "";
  candidate.takeaway = candidate.takeaway || candidate.takeAway || candidate.call_to_action || candidate.conclusion || candidate.insight || candidate.hook;
  candidate.caption = candidate.caption || candidate.postCaption || candidate.summary || candidate.call_to_action || candidate.hook;
  candidate.hashtags = candidate.hashtags || candidate.tags || ["#psychology", "#humanbehavior"];
  candidate.image_prompt = candidate.image_prompt || candidate.imagePrompt || candidate.prompt || "Dramatic moody cinematic atmosphere matching concept emotion, high resolution, vertical 9:16 composition, no text.";
  
  if (!candidate.image_prompt.toLowerCase().includes("vertical") && !candidate.image_prompt.toLowerCase().includes("9:16")) {
    candidate.image_prompt += ", vertical 9:16 composition, high resolution, no text.";
  }

  const required = ['category', 'topic', 'hook', 'body', 'takeaway', 'caption', 'hashtags', 'image_prompt'];
  for (const field of required) {
    if (!candidate[field] || (typeof candidate[field] === 'string' && candidate[field].trim() === '')) {
      console.error("Raw Gemini output was:", candidate);
      throw new Error(`Candidate missing required field: ${field}`);
    }
  }
  
  return candidate;
}

export async function refinePostContent(post, userInstruction = "") {
  const prompt = `You are a master social media editor. Refine and enhance this psychology post to improve engagement, punchiness, and scientific accuracy.
Current Post:
Topic: "${post.topic}"
Hook: "${post.hook}"
Body: "${post.body}"
Takeaway: "${post.takeaway}"
Caption: "${post.caption}"
${userInstruction ? `User Feedback: "${userInstruction}"` : ''}

Return ONLY a JSON object with updated keys:
{
  "category": "${post.category || 'Psychology'}",
  "topic": "${post.topic}",
  "hook": "Refined 5-12 word hook",
  "body": "Refined 15-30 word body",
  "takeaway": "Refined 8-15 word takeaway",
  "caption": "Refined 15-40 word caption",
  "hashtags": ${JSON.stringify(post.hashtags || ["#psychology", "#humanbehavior"])},
  "image_prompt": "${post.image_prompt || 'Vertical 9:16 background image prompt'}"
}`;

  return await generateContentJSON(prompt, SYSTEM_PROMPT);
}
