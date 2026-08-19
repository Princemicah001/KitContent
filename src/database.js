import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';

let db;

export async function initDb() {
  if (db) return db;

  const dbDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'data');
  await fs.mkdir(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'kitcontent.db');

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      category TEXT,
      topic TEXT,
      hook TEXT,
      body TEXT,
      takeaway TEXT,
      caption TEXT,
      hashtags TEXT,
      image_prompt TEXT,
      image_path TEXT,
      final_image_path TEXT,
      status TEXT,
      similarity_score REAL,
      quality_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS topic_pool (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT UNIQUE NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'UNCONSUMED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  return db;
}

export function getDb() {
  return db;
}

export async function logMetric(eventType, details = '') {
  if (!db) return;
  try {
    await db.run(
      'INSERT INTO system_analytics (event_type, details) VALUES (?, ?)',
      [eventType, typeof details === 'object' ? JSON.stringify(details) : String(details)]
    );
  } catch (err) {
    console.error('Error logging metric:', err);
  }
}

export async function addTopicsToPool(topics = []) {
  if (!db || !topics.length) return;
  const stmt = await db.prepare('INSERT OR IGNORE INTO topic_pool (topic, category, status) VALUES (?, ?, ?)');
  for (const item of topics) {
    const topicStr = typeof item === 'string' ? item : item.topic;
    const catStr = typeof item === 'object' ? item.category || 'Psychology' : 'Psychology';
    if (topicStr) {
      await stmt.run(topicStr, catStr, 'UNCONSUMED');
    }
  }
  await stmt.finalize();
}

export async function getUnconsumedTopicPool() {
  if (!db) return [];
  const rows = await db.all("SELECT * FROM topic_pool WHERE status = 'UNCONSUMED' ORDER BY id ASC");
  return rows;
}

export async function consumeTopicFromPool(topicId) {
  if (!db) return;
  await db.run("UPDATE topic_pool SET status = 'CONSUMED' WHERE id = ?", [topicId]);
}

export async function savePost(post) {
  const query = `
    INSERT INTO posts (id, category, topic, hook, body, takeaway, caption, hashtags, image_prompt, image_path, final_image_path, status, similarity_score, quality_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      category=excluded.category,
      topic=excluded.topic,
      hook=excluded.hook,
      body=excluded.body,
      takeaway=excluded.takeaway,
      caption=excluded.caption,
      hashtags=excluded.hashtags,
      image_prompt=excluded.image_prompt,
      image_path=excluded.image_path,
      final_image_path=excluded.final_image_path,
      status=excluded.status,
      similarity_score=excluded.similarity_score,
      quality_score=excluded.quality_score,
      updated_at=CURRENT_TIMESTAMP
  `;
  
  await db.run(query, [
    post.id,
    post.category,
    post.topic,
    post.hook,
    post.body,
    post.takeaway,
    post.caption,
    JSON.stringify(post.hashtags || []),
    post.image_prompt,
    post.image_path,
    post.final_image_path,
    post.status,
    post.similarity_score,
    post.quality_score
  ]);
}

export async function getPosts() {
  const posts = await db.all('SELECT * FROM posts ORDER BY created_at DESC');
  return posts.map(p => ({
    ...p,
    hashtags: p.hashtags ? JSON.parse(p.hashtags) : []
  }));
}

export async function getPost(id) {
  const post = await db.get('SELECT * FROM posts WHERE id = ?', [id]);
  if (post) {
    post.hashtags = post.hashtags ? JSON.parse(post.hashtags) : [];
  }
  return post;
}

export async function getStats() {
  const stats = await db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) as ready,
      SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
      AVG(CASE WHEN quality_score IS NOT NULL THEN quality_score ELSE 100 END) as avg_quality,
      AVG(CASE WHEN similarity_score IS NOT NULL THEN similarity_score ELSE 0 END) as avg_similarity
    FROM posts
  `);

  const poolCount = await db.get("SELECT COUNT(*) as count FROM topic_pool WHERE status = 'UNCONSUMED'");

  const metrics = await db.all(`
    SELECT event_type, COUNT(*) as count 
    FROM system_analytics 
    GROUP BY event_type
  `);

  const metricMap = {};
  metrics.forEach(m => {
    metricMap[m.event_type] = m.count;
  });

  const totalAttempts = (stats.total || 0) + (metricMap['repetition_blocked'] || 0) + (metricMap['low_quality_rejected'] || 0) + (metricMap['api_error'] || 0);
  const successRate = totalAttempts > 0 ? (((stats.ready || 0) + (stats.approved || 0)) / totalAttempts * 100).toFixed(1) : 100;
  const authenticityScore = stats.avg_quality ? (stats.avg_quality * (1 - (stats.avg_similarity || 0))).toFixed(1) : 95.0;

  return {
    generated: stats.total || 0,
    ready: stats.ready || 0,
    approved: stats.approved || 0,
    rejected: stats.rejected || 0,
    failed: stats.failed || 0,
    pooled_topics: poolCount.count || 0,
    total_attempts: totalAttempts,
    success_rate: parseFloat(successRate),
    api_failures: metricMap['api_429'] || metricMap['api_error'] || 0,
    repetition_blocked: metricMap['repetition_blocked'] || 0,
    low_quality_rejected: metricMap['low_quality_rejected'] || 0,
    avg_quality: stats.avg_quality ? parseFloat(stats.avg_quality.toFixed(1)) : 95.0,
    authenticity_score: parseFloat(authenticityScore)
  };
}
