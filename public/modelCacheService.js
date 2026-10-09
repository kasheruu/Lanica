/**
 * Lanica Furniture Platform - Client-Side 3D Model Cache Service
 * 
 * Features:
 * - Persistent Cache Storage API ('lanica-3d-models-v1')
 * - Independent of Auth State (persists across logins, logouts, and sessions)
 * - Cache Invalidation & Versioning support (URL query parameters or version tokens)
 * - AR Compatibility: feeds Blob URLs to <model-viewer> while preserving remote URLs for native AR (iOS Quick Look / Scene Viewer)
 * - Detailed Stream Progress Tracking (% downloaded)
 * - Storage Hygiene: LRU (Least Recently Used) cleanup (capped at 20 models / 300MB ceiling)
 */

const CACHE_NAME = "lanica-3d-models-v1";
const LRU_REGISTRY_KEY = "lanica_3d_cache_lru_v1";
const MAX_CACHE_ITEMS = 20;
const MAX_CACHE_BYTES = 300 * 1024 * 1024; // 300 MB

/**
 * Gets the LRU registry from localStorage
 */
function getLRURegistry() {
  try {
    const raw = localStorage.getItem(LRU_REGISTRY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Saves the LRU registry to localStorage
 */
function saveLRURegistry(registry) {
  try {
    localStorage.setItem(LRU_REGISTRY_KEY, JSON.stringify(registry));
  } catch (e) {
    console.warn("[3D ModelCache] Failed to save LRU registry:", e);
  }
}

/**
 * Normalizes a URL to serve as a consistent cache key
 */
function normalizeCacheKey(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.href;
  } catch (e) {
    return url;
  }
}

/**
 * Enforces LRU cleanup when cache limits are exceeded.
 */
async function purgeLRUEntries(cache) {
  try {
    const registry = getLRURegistry();
    const keys = Object.keys(registry);
    if (keys.length === 0) return;

    let totalBytes = 0;
    const items = keys.map((key) => {
      const entry = registry[key];
      totalBytes += entry.blobSize || 0;
      return { key, ...entry };
    });

    // Sort by lastAccessed ascending (oldest first)
    items.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0));

    let updatedRegistry = { ...registry };

    while (items.length > 0 && (items.length > MAX_CACHE_ITEMS || totalBytes > MAX_CACHE_BYTES)) {
      const oldest = items.shift();
      console.log(`[3D ModelCache] LRU Evicting cached 3D model: ${oldest.key}`);
      try {
        await cache.delete(oldest.key);
      } catch (err) {
        console.warn(`[3D ModelCache] Error evicting ${oldest.key}:`, err);
      }
      totalBytes -= oldest.blobSize || 0;
      delete updatedRegistry[oldest.key];
    }

    saveLRURegistry(updatedRegistry);
  } catch (err) {
    console.warn("[3D ModelCache] LRU eviction error:", err);
  }
}

/**
 * Loads a 3D model with persistent caching, stream progress reporting, and version invalidation.
 * 
 * @param {string} modelUrl - The remote URL of the 3D model (.glb / .gltf)
 * @param {Object} [options] - Options
 * @param {Function} [options.onProgress] - Progress callback (percentage, loadedBytes, totalBytes)
 * @param {boolean} [options.forceReload] - If true, bypasses existing cache and re-downloads asset
 * @param {string} [options.version] - Version tag to validate cache freshness
 * @param {string} [options.usdzUrl] - Optional USDZ URL for iOS Quick Look AR
 * @returns {Promise<{blobUrl: string, originalUrl: string, usdzUrl: string, isCached: boolean, size: number}>}
 */
export async function loadCachedModel(modelUrl, options = {}) {
  if (!modelUrl || typeof modelUrl !== "string") {
    return { blobUrl: modelUrl, originalUrl: modelUrl, isCached: false, size: 0 };
  }

  // Return data URLs or blob URLs unchanged
  if (modelUrl.startsWith("data:") || modelUrl.startsWith("blob:")) {
    if (options.onProgress) options.onProgress(100, 0, 0);
    return { blobUrl: modelUrl, originalUrl: modelUrl, isCached: true, size: 0 };
  }

  const cacheKey = normalizeCacheKey(modelUrl);
  const version = options.version || new URL(cacheKey, window.location.href).searchParams.get("v") || "";

  try {
    const cache = await caches.open(CACHE_NAME);
    const registry = getLRURegistry();

    const existingMetadata = registry[cacheKey];
    const isVersionMismatch = existingMetadata && version && existingMetadata.version !== version;

    // Check if matching response exists in Cache Storage
    if (!options.forceReload && !isVersionMismatch) {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        console.log(`[3D ModelCache] Fast-loading from local Cache Storage: ${cacheKey}`);
        const blob = await cachedResponse.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Update LRU lastAccessed
        registry[cacheKey] = {
          url: cacheKey,
          blobSize: blob.size,
          lastAccessed: Date.now(),
          version: version || (existingMetadata ? existingMetadata.version : ""),
        };
        saveLRURegistry(registry);

        if (options.onProgress) {
          options.onProgress(100, blob.size, blob.size);
        }

        return {
          blobUrl,
          originalUrl: modelUrl,
          usdzUrl: options.usdzUrl || "",
          isCached: true,
          size: blob.size,
        };
      }
    }

    if (isVersionMismatch) {
      console.log(`[3D ModelCache] Version mismatch for ${cacheKey}. Re-fetching latest model.`);
      await cache.delete(cacheKey);
    }

    console.log(`[3D ModelCache] Fetching fresh 3D model asset: ${modelUrl}`);
    const networkResponse = await fetch(modelUrl, { mode: "cors" });

    if (!networkResponse.ok) {
      throw new Error(`HTTP ${networkResponse.status} - ${networkResponse.statusText}`);
    }

    const contentLength = networkResponse.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let blob;

    // Stream reader for progress reporting if supported
    if (networkResponse.body && typeof ReadableStream !== "undefined") {
      const reader = networkResponse.body.getReader();
      const chunks = [];
      let loadedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.byteLength;

        if (options.onProgress) {
          const pct = totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 50;
          options.onProgress(pct, loadedBytes, totalBytes);
        }
      }

      blob = new Blob(chunks, { type: networkResponse.headers.get("content-type") || "model/gltf-binary" });
    } else {
      blob = await networkResponse.blob();
    }

    if (options.onProgress) {
      options.onProgress(100, blob.size, blob.size);
    }

    // Save fresh response clone in Cache Storage
    const responseToCache = new Response(blob, {
      status: 200,
      statusText: "OK",
      headers: {
        "Content-Type": blob.type || "model/gltf-binary",
        "Content-Length": String(blob.size),
        "X-Lanica-Cache-Time": String(Date.now()),
      },
    });

    await cache.put(cacheKey, responseToCache);

    // Update LRU Registry
    registry[cacheKey] = {
      url: cacheKey,
      blobSize: blob.size,
      lastAccessed: Date.now(),
      version: version || "",
    };
    saveLRURegistry(registry);

    // Enforce storage ceiling cap
    await purgeLRUEntries(cache);

    const blobUrl = URL.createObjectURL(blob);
    return {
      blobUrl,
      originalUrl: modelUrl,
      usdzUrl: options.usdzUrl || "",
      isCached: false,
      size: blob.size,
    };
  } catch (err) {
    console.warn(`[3D ModelCache] Network/Cache error for ${modelUrl}. Falling back to direct URL.`, err);
    if (options.onProgress) options.onProgress(100, 0, 0);
    return {
      blobUrl: modelUrl,
      originalUrl: modelUrl,
      usdzUrl: options.usdzUrl || "",
      isCached: false,
      size: 0,
    };
  }
}

/**
 * Backward-compatible helper that returns a Blob URL string directly.
 */
export async function getCachedModelUrl(modelUrl, options = {}) {
  const res = await loadCachedModel(modelUrl, options);
  return res.blobUrl;
}

/**
 * Helper to attach a cached model to a <model-viewer> DOM element with full AR preservation.
 * 
 * @param {HTMLElement} modelViewerEl - The <model-viewer> DOM element
 * @param {string} modelUrl - The remote 3D model URL (.glb / .gltf)
 * @param {Object} [options] - Options (onProgress, usdzUrl, etc.)
 */
export async function attachModelToViewer(modelViewerEl, modelUrl, options = {}) {
  if (!modelViewerEl) return null;

  const result = await loadCachedModel(modelUrl, options);

  // In-browser rendering uses the ultra-fast local Blob URL
  modelViewerEl.src = result.blobUrl;

  // Preserve native AR intent compatibility for iOS Quick Look and Scene Viewer
  const remoteArUrl = result.usdzUrl || result.originalUrl;
  if (remoteArUrl && !remoteArUrl.startsWith("blob:")) {
    modelViewerEl.setAttribute("ios-src", remoteArUrl);
  }

  modelViewerEl.setAttribute("data-original-src", result.originalUrl);

  return result;
}

/**
 * Pre-caches an array of 3D model URLs in the background without blocking.
 */
export async function precacheModelUrls(urls = []) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  try {
    for (const url of urls) {
      if (url && typeof url === "string" && !url.startsWith("blob:") && !url.startsWith("data:")) {
        loadCachedModel(url).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("[3D ModelCache] Pre-cache error:", e);
  }
}

/**
 * Clears all cached 3D models and resets LRU registry.
 */
export async function clearModelCache() {
  try {
    await caches.delete(CACHE_NAME);
    localStorage.removeItem(LRU_REGISTRY_KEY);
    console.log("[3D ModelCache] Cleared all cached 3D models.");
  } catch (err) {
    console.warn("[3D ModelCache] Failed to clear model cache:", err);
  }
}

// Global attachment for non-module scripts
if (typeof window !== "undefined") {
  window.ModelCacheService = {
    loadCachedModel,
    getCachedModelUrl,
    attachModelToViewer,
    precacheModelUrls,
    clearModelCache,
  };
}
