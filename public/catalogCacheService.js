// catalogCacheService.js - Shared In-Memory Catalog TTL Caching Layer

let cachedProducts = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

/**
 * Retrieves catalog products with TTL caching to protect database queries under high concurrency.
 * @param {object} db Firestore database instance
 * @param {function} getDocs Firestore getDocs function
 * @param {function} collection Firestore collection function
 * @param {boolean} forceRefresh Optional flag to bypass cache
 * @returns {Promise<Array>} List of product objects
 */
export async function getCachedCatalog(db, getDocs, collection, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedProducts && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedProducts;
  }

  try {
    const snap = await getDocs(collection(db, "products"));
    const products = [];
    snap.forEach((docSnap) => {
      products.push({
        id: docSnap.id,
        ...docSnap.data(),
      });
    });

    cachedProducts = products;
    lastFetchTime = now;
    return products;
  } catch (err) {
    console.warn("Failed to fetch catalog from Firestore, returning cached fallback if available:", err);
    if (cachedProducts) return cachedProducts;
    throw err;
  }
}

/**
 * Invalidates the in-memory catalog cache when products are created, edited, or stock is updated.
 */
export function invalidateCatalogCache() {
  cachedProducts = null;
  lastFetchTime = 0;
}
