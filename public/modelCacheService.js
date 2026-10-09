/**
 * Lanica Furniture Platform - Client-Side 3D Model Cache Service
 * Uses Cache Storage API (lanica-3d-models-v1) to persist .glb / .gltf assets locally.
 * Serves models from local Cache Storage as Blob URLs over network requests.
 */

const CACHE_NAME = "lanica-3d-models-v1";

/**
 * Gets a cached model URL or fetches, caches, and returns a local Blob URL.
 * @param {string} modelUrl - Network URL of the 3D model (.glb / .gltf)
 * @returns {Promise<string>} Local Object URL (blob:...) or original URL as fallback
 */
export async function getCachedModelUrl(modelUrl) {
  if (!modelUrl || typeof modelUrl !== "string") return modelUrl;

  // Don't attempt to cache data URLs or blob URLs
  if (modelUrl.startsWith("data:") || modelUrl.startsWith("blob:")) {
    return modelUrl;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(modelUrl);

    if (cachedResponse) {
      console.log(`[3D ModelCache] Serving asset from local Cache Storage: ${modelUrl}`);
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    }

    console.log(`[3D ModelCache] Fetching & caching 3D asset locally: ${modelUrl}`);
    const networkResponse = await fetch(modelUrl, { mode: "cors" });

    if (networkResponse && networkResponse.ok) {
      await cache.put(modelUrl, networkResponse.clone());
      const blob = await networkResponse.blob();
      return URL.createObjectURL(blob);
    }
  } catch (err) {
    console.warn(`[3D ModelCache] Cache storage fallback for ${modelUrl}:`, err);
  }

  return modelUrl;
}

/**
 * Pre-caches an array of 3D model URLs in the background.
 * @param {string[]} urls - Array of 3D asset URLs
 */
export async function precacheModelUrls(urls = []) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const url of urls) {
      if (url && typeof url === "string" && !url.startsWith("blob:") && !url.startsWith("data:")) {
        const match = await cache.match(url);
        if (!match) {
          fetch(url, { mode: "cors" })
            .then((res) => {
              if (res.ok) cache.put(url, res.clone());
            })
            .catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn("[3D ModelCache] Pre-cache error:", e);
  }
}
