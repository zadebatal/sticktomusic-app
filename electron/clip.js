/**
 * clip.js — Local CLIP inference for semantic media search.
 * Uses @huggingface/transformers with onnxruntime-node for zero-cost,
 * offline image/text embedding. Models auto-download on first use (~350MB)
 * and are cached in the Electron app data directory.
 *
 * Follows the same lazy-loading pattern as transnet.js.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Model cache directory — persists across app restarts
const CACHE_DIR = path.join(app.getPath('userData'), 'models', 'clip');

let pipeline = null;
let tokenizer = null;
let processor = null;
let visionModel = null;
let textModel = null;
let loadPromise = null;

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

/**
 * Lazy-load the CLIP pipeline. Downloads model on first call (~350MB),
 * then loads from cache on subsequent calls (<2s).
 */
async function ensureLoaded() {
  if (pipeline) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    console.log('[clip] Loading CLIP model (first time downloads ~350MB)...');
    console.log('[clip] Cache dir:', CACHE_DIR);

    // Ensure cache directory exists
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    // Dynamic import for ESM module
    const { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection } =
      await import('@huggingface/transformers');

    // Set cache directory
    const env = (await import('@huggingface/transformers')).env;
    env.cacheDir = CACHE_DIR;
    // Use onnxruntime-node backend (not WASM)
    env.backends.onnx.wasm.numThreads = 1;

    // Load all components
    [tokenizer, processor, textModel, visionModel] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, { cache_dir: CACHE_DIR }),
      AutoProcessor.from_pretrained(MODEL_ID, { cache_dir: CACHE_DIR }),
      CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { cache_dir: CACHE_DIR }),
      CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { cache_dir: CACHE_DIR }),
    ]);

    pipeline = true; // Mark as loaded
    console.log('[clip] CLIP model loaded successfully');
  })();

  return loadPromise;
}

/**
 * Encode an image file to a 512-d embedding vector.
 * @param {string} imagePath — path to image file (JPEG/PNG)
 * @returns {Promise<number[]>} — 512-dimensional unit vector
 */
async function encodeImage(imagePath) {
  await ensureLoaded();
  const { RawImage } = await import('@huggingface/transformers');

  const image = await RawImage.read(imagePath);
  const imageInputs = await processor(image);
  const { image_embeds } = await visionModel(imageInputs);

  // Normalize to unit vector
  const embedding = Array.from(image_embeds.data);
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map((v) => v / norm);
}

/**
 * Encode a text query to a 512-d embedding vector.
 * @param {string} text — search query (e.g., "dance moves")
 * @returns {Promise<number[]>} — 512-dimensional unit vector
 */
async function encodeText(text) {
  await ensureLoaded();

  const textInputs = await tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);

  // Normalize to unit vector
  const embedding = Array.from(text_embeds.data);
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map((v) => v / norm);
}

/**
 * Cosine similarity between two unit vectors.
 * Since vectors are pre-normalized, this is just the dot product.
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Check if CLIP model is loaded and ready.
 */
function isReady() {
  return !!pipeline;
}

module.exports = { ensureLoaded, encodeImage, encodeText, cosineSimilarity, isReady };
