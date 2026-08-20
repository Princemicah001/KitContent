import fs from 'fs/promises';

export function validateCandidateJSON(candidate) {
  const required = ['category', 'topic', 'hook', 'body', 'takeaway', 'caption', 'hashtags', 'image_prompt'];
  for (const field of required) {
    if (!candidate[field] || (typeof candidate[field] === 'string' && candidate[field].trim() === '')) {
      throw new Error(`Invalid candidate JSON: missing or empty required field '${field}'`);
    }
  }
  return true;
}

export async function validateGeneratedImage(filePath) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      throw new Error("Generated image file is 0 bytes");
    }
    if (stats.size < 1000) {
      throw new Error("Generated image file is too small (likely error payload)");
    }
    return true;
  } catch (err) {
    throw new Error(`Image validation failed: ${err.message}`);
  }
}

export async function validateFinalPostPNG(filePath) {
  try {
    const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
    // In ES modules, we should use the imported path module.
    // wait, path is not imported in this file. Let's just do manual join if needed, or import path at top.
    const absolutePath = filePath.startsWith('/') ? filePath : `${baseDir}/${filePath}`;
    const stats = await fs.stat(absolutePath);
    if (stats.size < 5000) {
      throw new Error("Final PNG post file is invalid or too small");
    }
    return true;
  } catch (err) {
    throw new Error(`Post validation failed: ${err.message}`);
  }
}
