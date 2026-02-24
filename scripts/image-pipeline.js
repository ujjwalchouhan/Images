#!/usr/bin/env node
/**
 * Image Pipeline — Optimize (WebP only) → Output to folder → Manifest (one URL per image)
 * GitHub-based: push Images/optimized to GitHub, use jsDelivr or raw URL
 */

import { createReadStream, readdirSync, mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, extname, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(dirname(__filename), '..', '.env') });

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════
const ROOT = join(dirname(__filename), '..');
const IMAGES_DIR = join(ROOT, 'Images');
const OPTIMIZED_DIR = join(ROOT, 'Images', 'optimized');
const MANIFEST_PATH = join(ROOT, 'Images', 'image-manifest.json');
const CACHE_PATH = join(ROOT, 'Images', '.image-cache.json');
const OPTIMIZE_CONCURRENCY = 5;

// Base URL for manifest — set in .env after pushing to GitHub
// Examples: https://cdn.jsdelivr.net/gh/user/repo@main/img-handler/Images/optimized
//           https://raw.githubusercontent.com/user/repo/main/img-handler/Images/optimized
const IMAGES_BASE_URL = (process.env.IMAGES_BASE_URL || '').replace(/\/$/, '');

// Remove source images after successful optimization
const REMOVE_SOURCE = process.env.REMOVE_SOURCE_AFTER_OPTIMIZE === '1' || process.env.REMOVE_SOURCE_AFTER_OPTIMIZE === 'true';

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const EXCLUDE_DIRS = new Set(['optimized']);

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════
function ensureDir(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function readJson(path, fallback = {}) {
  try {
    const data = readFileSync(path, 'utf8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function getFileHash(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function getKeyFromPath(filePath, baseDir) {
  const rel = relative(baseDir, filePath);
  const ext = extname(rel);
  const name = rel.slice(0, -ext.length);
  return name.replace(/[/\\]/g, '_');
}

function toUrl(relPath) {
  if (!IMAGES_BASE_URL) return join('Images', 'optimized', relPath).replace(/\\/g, '/');
  return `${IMAGES_BASE_URL}/${relPath.replace(/\\/g, '/')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1 — Scan
// ═══════════════════════════════════════════════════════════════════════════════
function scanRawImages(dir, files = []) {
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) {
        scanRawImages(full, files);
      }
    } else if (SUPPORTED_EXT.has(extname(e.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2 — Optimize (sharp: WebP only, one output per image)
// ═══════════════════════════════════════════════════════════════════════════════
async function optimizeImage(rawPath) {
  const key = getKeyFromPath(rawPath, IMAGES_DIR);
  const relDir = dirname(relative(IMAGES_DIR, rawPath));
  const outDir = relDir === '.' ? OPTIMIZED_DIR : join(OPTIMIZED_DIR, relDir);
  ensureDir(outDir);

  const baseName = join(outDir, basename(rawPath, extname(rawPath)));
  const finalWebp = baseName + '.webp';

  const meta = await sharp(rawPath).metadata();
  if (!meta.width || !meta.height) throw new Error(`Invalid image: ${rawPath}`);

  await sharp(rawPath)
    .rotate()
    .withMetadata({ strip: true })
    .webp({ quality: 75, effort: 6 })
    .toFile(finalWebp);

  const relWebp = relative(OPTIMIZED_DIR, finalWebp);

  return {
    key,
    url: toUrl(relWebp),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main pipeline
// ═══════════════════════════════════════════════════════════════════════════════
async function run() {
  const startTime = Date.now();

  ensureDir(IMAGES_DIR);
  ensureDir(OPTIMIZED_DIR);

  const cache = readJson(CACHE_PATH, {});
  const manifest = readJson(MANIFEST_PATH, {});

  const rawFiles = scanRawImages(IMAGES_DIR);
  if (rawFiles.length === 0) {
    console.log('📁 No images found in', IMAGES_DIR);
    return;
  }

  console.log('📂 Scanned', rawFiles.length, 'image(s) in', IMAGES_DIR);

  const toProcess = [];
  for (const f of rawFiles) {
    const hash = await getFileHash(f);
    const key = getKeyFromPath(f, IMAGES_DIR);
    const cached = cache[key];
    if (cached?.hash === hash && manifest[key]) {
      continue;
    }
    toProcess.push({ path: f, hash, key });
  }

  const skipped = rawFiles.length - toProcess.length;
  const limit = pLimit(OPTIMIZE_CONCURRENCY);

  const updates = await Promise.all(
    toProcess.map(({ path, hash, key }) =>
      limit(async () => {
        try {
          const result = await optimizeImage(path);
          cache[key] = { hash, processedAt: Date.now() };
          if (REMOVE_SOURCE && existsSync(path)) {
            unlinkSync(path);
            console.log('✅ Optimized & removed:', key);
          } else {
            console.log('✅ Optimized:', key);
          }
          return result;
        } catch (err) {
          console.error('❌ Failed:', key, err.message);
          return null;
        }
      })
    )
  );

  const valid = updates.filter(Boolean);
  // Migrate old manifest (avif/webp) to single URL per image
  const newManifest = {};
  const placeholderBase = 'https://cdn.jsdelivr.net/gh/USER/REPO@Images/img-handler/Images/optimized';
  for (const [k, v] of Object.entries(manifest)) {
    let url = typeof v === 'string' ? v : (v.webp || v.avif || v.url || '');
    if (IMAGES_BASE_URL && url.startsWith(placeholderBase)) {
      url = IMAGES_BASE_URL + url.slice(placeholderBase.length);
    }
    newManifest[k] = url;
  }
  for (const u of valid) {
    newManifest[u.key] = u.url;
  }
  const sorted = Object.fromEntries(
    Object.entries(newManifest).sort(([a], [b]) => a.localeCompare(b))
  );
  writeJson(MANIFEST_PATH, sorted);
  writeJson(CACHE_PATH, cache);

  const reactManifest = process.env.REACT_MANIFEST_OUTPUT;
  if (reactManifest) {
    const dest = join(ROOT, reactManifest);
    ensureDir(dirname(dest));
    copyFileSync(MANIFEST_PATH, dest);
    console.log('📋 Manifest copied to React project');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('✅ Processed:', rawFiles.length);
  console.log('📦 Optimized:', valid.length);
  console.log('⏭️  Skipped:', skipped);
  console.log('⏱️  Time:', elapsed + 's');
  console.log('═══════════════════════════════════════');
  if (!IMAGES_BASE_URL) {
    console.log('');
    console.log('💡 Add IMAGES_BASE_URL to .env for GitHub CDN URLs, e.g.:');
    console.log('   https://cdn.jsdelivr.net/gh/USER/REPO@main/img-handler/Images/optimized');
  }
}

run().catch((err) => {
  console.error('❌ Pipeline failed:', err);
  process.exit(1);
});
