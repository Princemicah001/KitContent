import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export async function generateImage(prompt, options = {}) {
  const provider = process.env.IMAGE_PROVIDER || 'pollinations';
  
  if (provider === 'pollinations') {
    return await generatePollinationsImage(prompt, options);
  }
  
  throw new Error(`Unsupported image provider: ${provider}`);
}

async function generatePollinationsImage(prompt, options) {
  const seed = crypto.randomInt(0, 1000000);
  const encodedPrompt = encodeURIComponent(prompt);
  const width = options.width || 1080;
  const height = options.height || 1920;
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image API error: ${response.statusText}`);
  }
  
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('image')) {
    throw new Error("API returned non-image response");
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  if (buffer.length < 1000) {
    throw new Error("Generated image file is unusually small (likely an error)");
  }
  
  const filename = `post_${Date.now()}_${seed}_bg.jpg`;
  const relativePath = path.join('generated', 'images', filename);
  const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
  const absolutePath = path.join(baseDir, relativePath);
  
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  
  return absolutePath;
}

export function isImageProviderConfigured() {
  const provider = process.env.IMAGE_PROVIDER || 'pollinations';
  if (provider === 'pollinations') return true;
  return false;
}
