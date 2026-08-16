import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAb2kDAVp9N_afxgOw5hSzDIvQ3UAIZVNU",
  authDomain: "jobsync-745a6.firebaseapp.com",
  projectId: "jobsync-745a6",
  storageBucket: "jobsync-745a6.firebasestorage.app",
  messagingSenderId: "845585113791",
  appId: "1:845585113791:web:921482be545bb9604ddc0a",
  measurementId: "G-LQ41PCS4HD",
};

let app;
try {
  app = getApp();
} catch {
  app = initializeApp(firebaseConfig);
}

export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * Ensures user is authenticated (signs in anonymously if no account is logged in).
 * Returns the current authenticated User object.
 */
export async function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        } else {
          try {
            const userCred = await signInAnonymously(auth);
            unsubscribe();
            resolve(userCred.user);
          } catch (err) {
            unsubscribe();
            reject(err);
          }
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

/**
 * Fetch a single product document from Firestore.
 */
export async function fetchProductById(productId) {
  const ref = doc(db, "products", productId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Helper to check variant stock availability.
 */
export function getAvailableStock(product, material) {
  if (!product) return 0;
  const mat = (material || "").toLowerCase();
  if (mat === "fabric" && typeof product.FabricStocks === "number") {
    return product.FabricStocks;
  }
  if (mat === "leather" && typeof product.LeatherStocks === "number") {
    return product.LeatherStocks;
  }
  return typeof product.stock === "number" ? product.stock : 0;
}

/**
 * Real-time listener for the user's cart subcollection.
 * Firestore Path: users/{userId}/cart
 */
export function subscribeToCart(userId, callback) {
  if (!userId) return () => {};
  const cartRef = collection(db, "users", userId, "cart");
  return onSnapshot(
    cartRef,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      callback(items);
    },
    (error) => {
      console.error("Cart subscription error:", error);
      callback([]);
    }
  );
}

/**
 * Add or update item in cart subcollection.
 * Path: users/{userId}/cart/{itemId}
 */
export async function addToCart(userId, product, material = "Fabric", quantity = 1) {
  if (!userId || !product || !product.id) {
    throw new Error("Invalid parameters for addToCart");
  }

  const mat = material || "Fabric";
  const itemId = `${product.id}_${mat}`; // Unique per product variant
  const itemRef = doc(db, "users", userId, "cart", itemId);

  // Fetch current fresh stock from Firestore to validate
  const freshProduct = await fetchProductById(product.id);
  if (!freshProduct) {
    throw new Error("Product no longer available.");
  }

  const availableStock = getAvailableStock(freshProduct, mat);

  // Check existing cart item quantity if any
  const existingDoc = await getDoc(itemRef);
  const existingQty = existingDoc.exists() ? Number(existingDoc.data().quantity || 0) : 0;
  const targetQty = existingQty + Number(quantity);

  if (targetQty > availableStock) {
    throw new Error(
      `Requested quantity (${targetQty}) exceeds available ${mat} stock (${availableStock}).`
    );
  }

  const displayImage =
    freshProduct.thumbnail ||
    (freshProduct.images && (freshProduct.images.isoImage || freshProduct.images.frontBg)) ||
    freshProduct.image ||
    product.url ||
    "assets/product_sofa.png";

  const cartPayload = {
    productId: freshProduct.id,
    name: freshProduct.name,
    price: Number(freshProduct.price),
    url: displayImage,
    quantity: targetQty,
    material: mat,
    updatedAt: serverTimestamp(),
  };

  await setDoc(itemRef, cartPayload, { merge: true });
  return cartPayload;
}

/**
 * Update quantity for a specific cart item.
 */
export async function updateCartItemQuantity(userId, itemId, newQuantity) {
  if (!userId || !itemId) return;
  const itemRef = doc(db, "users", userId, "cart", itemId);

  if (newQuantity <= 0) {
    await deleteDoc(itemRef);
    return;
  }

  // Stock check
  const snap = await getDoc(itemRef);
  if (!snap.exists()) return;
  const itemData = snap.data();

  const freshProduct = await fetchProductById(itemData.productId);
  if (freshProduct) {
    const availableStock = getAvailableStock(freshProduct, itemData.material);
    if (newQuantity > availableStock) {
      throw new Error(
        `Cannot set quantity to ${newQuantity}. Only ${availableStock} available in stock.`
      );
    }
  }

  await updateDoc(itemRef, {
    quantity: Number(newQuantity),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Remove an item from the cart.
 */
export async function removeCartItem(userId, itemId) {
  if (!userId || !itemId) return;
  const itemRef = doc(db, "users", userId, "cart", itemId);
  await deleteDoc(itemRef);
}

/**
 * Fetch addresses for a user from users/{userId}/addresses
 */
export async function getUserAddresses(userId) {
  if (!userId) return [];
  const addrsRef = collection(db, "users", userId, "addresses");
  const snap = await getDocs(addrsRef);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Save new shipping address to users/{userId}/addresses
 */
export async function saveUserAddress(userId, addressData) {
  if (!userId) throw new Error("User must be authenticated to save address.");
  const addrsRef = collection(db, "users", userId, "addresses");

  const newAddrDoc = doc(addrsRef);
  const payload = {
    recipientName: String(addressData.recipientName || "").trim(),
    phoneNumber: String(addressData.phoneNumber || "").trim(),
    fullAddress: String(addressData.fullAddress || "").trim(),
    latitude: addressData.latitude ? Number(addressData.latitude) : 14.195, // default Laguna lat
    longitude: addressData.longitude ? Number(addressData.longitude) : 121.332, // default Laguna lon
    createdAt: serverTimestamp(),
  };

  await setDoc(newAddrDoc, payload);
  return { id: newAddrDoc.id, ...payload };
}

/**
 * ATOMIC ORDER PLACEMENT & INVENTORY DEDUCTION (Phase 5)
 * Executes a Firestore Atomic Transaction:
 * 1. Stock Re-verification (reads products inside transaction)
 * 2. Inventory Decrement (updates stock/FabricStocks/LeatherStocks)
 * 3. Order Creation (writes orders/{orderId})
 * 4. Cart Purge (deletes all docs in users/{userId}/cart)
 */
export async function placeOrderAtomic({
  userId,
  cartItems,
  totalAmount,
  paymentMethod,
  address,
  paymentDetails = {},
}) {
  if (!userId) throw new Error("User ID is required to place an order.");
  if (!cartItems || cartItems.length === 0) throw new Error("Cart is empty.");
  if (!address || !address.fullAddress) throw new Error("Delivery address is required.");

  const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async (transaction) => {
    // Phase 5 Step 1: Stock Re-verification
    const productUpdates = [];

    for (const item of cartItems) {
      const productRef = doc(db, "products", item.productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error(`Product "${item.name}" no longer exists.`);
      }

      const pData = productSnap.data();
      const mat = (item.material || "Fabric").toLowerCase();
      const reqQty = Number(item.quantity || 1);

      let available = 0;
      if (mat === "fabric" && typeof pData.FabricStocks === "number") {
        available = pData.FabricStocks;
      } else if (mat === "leather" && typeof pData.LeatherStocks === "number") {
        available = pData.LeatherStocks;
      } else {
        available = typeof pData.stock === "number" ? pData.stock : 0;
      }

      if (reqQty > available) {
        throw new Error(
          `Insufficient stock for "${item.name}" (${item.material}). Available: ${available}, Requested: ${reqQty}`
        );
      }

      // Prepare updates
      const currentGeneralStock = typeof pData.stock === "number" ? pData.stock : 0;
      const newGeneralStock = Math.max(0, currentGeneralStock - reqQty);

      const updatePayload = {
        stock: newGeneralStock,
      };

      if (mat === "fabric" && typeof pData.FabricStocks === "number") {
        updatePayload.FabricStocks = Math.max(0, pData.FabricStocks - reqQty);
      }
      if (mat === "leather" && typeof pData.LeatherStocks === "number") {
        updatePayload.LeatherStocks = Math.max(0, pData.LeatherStocks - reqQty);
      }

      productUpdates.push({ ref: productRef, updates: updatePayload });
    }

    // Read cart docs so we can purge them inside transaction
    const cartRef = collection(db, "users", userId, "cart");
    const cartSnap = await getDocs(cartRef);

    // Phase 5 Step 2: Inventory Decrement
    for (const pUpd of productUpdates) {
      transaction.update(pUpd.ref, pUpd.updates);
    }

    // Phase 5 Step 3: Order Creation
    const orderItemsBreakdown = cartItems.map((item) => ({
      productId: item.productId,
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      material: item.material || "Fabric",
      url: item.url || "",
      subtotal: Number(item.price) * Number(item.quantity),
    }));

    const orderDocData = {
      orderId: orderId,
      userId: userId,
      items: orderItemsBreakdown,
      totalAmount: Number(totalAmount),
      paymentMethod: paymentMethod, // "COD", "GCash", or "Bank Transfer"
      orderStatus: "Pending", // "Pending", "Processing", "Delivered"
      address: {
        recipientName: address.recipientName || "",
        phoneNumber: address.phoneNumber || "",
        fullAddress: address.fullAddress || "",
        latitude: address.latitude || null,
        longitude: address.longitude || null,
      },
      paymentDetails: paymentDetails || {},
      createdAt: serverTimestamp(),
    };

    transaction.set(orderRef, orderDocData);

    // Phase 5 Step 4: Cart Purge
    cartSnap.docs.forEach((cartDoc) => {
      transaction.delete(cartDoc.ref);
    });
  });

  return { success: true, orderId: orderId };
}
