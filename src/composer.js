import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import fs from 'fs/promises';
import path from 'path';

export async function composePost(post, bgImagePath) {
  const width = 1080;
  const height = 1920;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  try {
    const bg = await loadImage(bgImagePath);
    const scale = Math.max(canvas.width / bg.width, canvas.height / bg.height);
    const x = (canvas.width / 2) - (bg.width / 2) * scale;
    const y = (canvas.height / 2) - (bg.height / 2) * scale;
    ctx.drawImage(bg, x, y, bg.width * scale, bg.height * scale);
  } catch (err) {
    throw new Error(`Failed to load background image for composition: ${err.message}`);
  }

  // Dark overlay for readability
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, width, height);

  // Typography Settings
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top'; // This makes vertical positioning predictable
  ctx.fillStyle = '#FFFFFF';
  
  const margin = 120;
  const maxWidth = width - (margin * 2);

  // 1. PRE-CALCULATE TEXT HEIGHT TO CENTRALLY PLACE IT
  
  ctx.font = 'bold 72px cursive';
  const hookLines = wrapText(ctx, post.hook, maxWidth);
  const hookBlockHeight = hookLines.length * 80;

  ctx.font = '40px sans-serif';
  const bodyLines = wrapText(ctx, post.body, maxWidth);
  const bodyBlockHeight = bodyLines.length * 50;

  ctx.font = 'italic 44px sans-serif';
  const takeawayLines = wrapText(ctx, post.takeaway, maxWidth);
  const takeawayBlockHeight = takeawayLines.length * 55;

  let totalHeight = hookBlockHeight + bodyBlockHeight + takeawayBlockHeight;
  
  const categoryHeight = post.category ? 60 : 0;
  totalHeight += categoryHeight;
  
  // Add spacing gaps between elements
  const gapAfterHook = 50;
  const gapAfterBody = 50;
  totalHeight += gapAfterHook + gapAfterBody;

  // Calculate balanced starting Y position for perfect vertical center
  // Subtracting the total height from the canvas height and dividing by 2 guarantees equal top and bottom margins!
  let currentY = (height - totalHeight) / 2;

  // 2. RENDER THE TEXT
  
  // Category
  if (post.category) {
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(post.category.toUpperCase(), width / 2, currentY);
    currentY += categoryHeight;
  }

  // Hook (Heading)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 72px cursive';
  for (let line of hookLines) {
    ctx.fillText(line, width / 2, currentY);
    currentY += 80;
  }
  
  currentY += gapAfterHook;

  // Body (Secondary)
  ctx.fillStyle = '#DDDDDD';
  ctx.font = '40px sans-serif';
  for (let line of bodyLines) {
    ctx.fillText(line, width / 2, currentY);
    currentY += 50;
  }

  currentY += gapAfterBody;

  // Takeaway (Closing)
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'italic 44px sans-serif';
  for (let line of takeawayLines) {
    ctx.fillText(line, width / 2, currentY);
    currentY += 55;
  }

  // Branding at bottom
  ctx.fillStyle = '#888888';
  ctx.font = '22px sans-serif';
  ctx.fillText('KITCONTENT', width / 2, height - 80);

  const filename = `post_${post.id}.png`;
  const relativePath = path.join('generated', 'posts', filename);
  const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
  const absolutePath = path.join(baseDir, relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(absolutePath, buffer);

  return relativePath;
}

function wrapText(ctx, text, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const metrics = ctx.measureText(currentLine + " " + word);
    if (metrics.width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}
