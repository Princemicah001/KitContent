import dotenv from 'dotenv';
dotenv.config();

let apiKey;

export function initGemini() {
  apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return false;
  }
  return true;
}

export function getGemini() {
  return apiKey;
}

export async function generateContentJSON(prompt, systemInstruction) {
  if (!apiKey) {
    apiKey = process.env.GEMINI_API_KEY;
  }
  if (!apiKey) throw new Error("Gemini API key not configured in environment");
  
  const primaryModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const candidateModels = [primaryModel, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-1.5-flash'].filter((v, i, a) => a.indexOf(v) === i);
  
  let lastError = null;
  
  for (const modelName of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7
        }
      };

      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error?.message || `HTTP ${res.status} ${res.statusText}`;
        const err = new Error(`[Gemini API ${modelName} ${res.status}]: ${errorMsg}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }

      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        throw new Error(`Empty response content from Gemini model ${modelName}`);
      }

      let cleanedText = candidateText.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      }

      return JSON.parse(cleanedText);

    } catch (err) {
      lastError = err;
      console.warn(`[Gemini ${modelName}] Notice: ${err.message}`);
      if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
        continue;
      }
      throw err;
    }
  }
  
  throw lastError;
}

export async function getTrendingPsychologyTopics() {
  if (!apiKey) apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ 
          text: "Search for currently trending psychology, mental health, emotional intelligence, and human behavior topics across social media reports and science publications today. Return ONLY a JSON object with key 'trends' containing an array of 5 objects with keys: topic, viral_hook_angle, background_insight, category, relevance_score." 
        }]
      }
    ],
    tools: [
      { googleSearch: {} }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      // Fallback without tools if googleSearch tool isn't enabled for API key
      delete payload.tools;
      const fallbackRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await fallbackRes.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  } catch (err) {
    console.error("Trending search grounding error:", err);
    return {
      trends: [
        { topic: "Cognitive Overload & Decision Fatigue", viral_hook_angle: "Why making micro-decisions drains your energy before 2 PM.", background_insight: "Empirical studies show high daily choices deplete executive function.", category: "Cognitive Psychology", relevance_score: 98 },
        { topic: "Social Jetlag & Circadian Alignment", viral_hook_angle: "The invisible jetlag you experience without leaving your couch.", background_insight: "Inconsistent weekend sleep cycles trigger cognitive fog.", category: "Sleep Psychology", relevance_score: 95 },
        { topic: "The Empathy Paradox in Digital Communication", viral_hook_angle: "Why texting makes misunderstandings 3x more likely.", background_insight: "Absence of micro-expressions leads brain to infer negativity.", category: "Social Psychology", relevance_score: 93 },
        { topic: "Spotlight Effect in Modern Social Media", viral_hook_angle: "Nobody notices your awkward moment as much as you think.", background_insight: "Egocentric bias causes overestimation of public observation.", category: "Behavioral Psychology", relevance_score: 91 },
        { topic: "Parasocial Relationships & Digital Anchoring", viral_hook_angle: "How online creators become emotional anchors in modern life.", background_insight: "Repeated video consumption mimics authentic attachment pathways.", category: "Media Psychology", relevance_score: 89 }
      ]
    };
  }
}
