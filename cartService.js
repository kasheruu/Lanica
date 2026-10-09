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

export function parsePrice(val) {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
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
 * Supports Made-to-Order (MTO) when stock <= 0 (lead time: 14-21 days)
 * and Ready-to-Ship (RTS) when stock > 0 (1-3 units available).
 */
export async function addToCart(
  userId,
  product,
  material = "Fabric",
  quantity = 1,
  customNotes = "",
  selectedAddons = [],
  customUnitPrice = null
) {
  if (!userId || !product || !product.id) {
    throw new Error("Invalid parameters for addToCart");
  }

  const mat = material || "Fabric";
  const addonsKey =
    Array.isArray(selectedAddons) && selectedAddons.length > 0
      ? `_${selectedAddons.map((a) => a.name).sort().join("_")}`
      : "";
  const itemId = `${product.id}_${mat}${addonsKey}`; // Unique per product variant and selected upgrades
  const itemRef = doc(db, "users", userId, "cart", itemId);

  // Fetch current fresh stock from Firestore to validate
  const freshProduct = await fetchProductById(product.id);
  const prodToUse = freshProduct || product;

  const availableStock = getAvailableStock(prodToUse, mat);

  // Check existing cart item quantity if any
  const existingDoc = await getDoc(itemRef);
  const existingQty = existingDoc.exists() ? Number(existingDoc.data().quantity || 0) : 0;
  const targetQty = existingQty + Number(quantity);

  // Determine availability mode:
  const allowsPreorder = prodToUse.allowPreorder !== false && prodToUse.isMadeToOrder !== false;
  if (availableStock <= 0 && !allowsPreorder) {
    throw new Error(`Product "${prodToUse.name || product.name}" is currently out of stock and pre-orders are disabled.`);
  }

  const isMadeToOrder = availableStock <= 0 || targetQty > availableStock;
  const customLeadTime = prodToUse.leadTime || prodToUse.estimated_lead_time || "14-21 Business Days";
  const leadTime = isMadeToOrder
    ? `${customLeadTime} (Crafted upon order)`
    : "3-5 Business Days (Ready stock)";

  const displayImage =
    prodToUse.thumbnail ||
    (prodToUse.images && (prodToUse.images.isoImage || prodToUse.images.frontBg)) ||
    prodToUse.image ||
    product.url ||
    "assets/product_sofa.png";

  const basePrice = parsePrice(prodToUse.price || product.price);
  const finalUnitPrice = customUnitPrice !== null ? parsePrice(customUnitPrice) : basePrice;

  const cartPayload = {
    productId: prodToUse.id,
    name: prodToUse.name,
    price: finalUnitPrice,
    basePrice: basePrice,
    selectedAddons: selectedAddons,
    url: displayImage,
    quantity: targetQty,
    material: mat,
    customNotes: String(customNotes || "").trim(),
    orderType: isMadeToOrder ? "Made-to-Order" : "Ready-to-Ship",
    leadTime: leadTime,
    availableStockSnapshot: availableStock,
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

  const snap = await getDoc(itemRef);
  if (!snap.exists()) return;
  const itemData = snap.data();

  const freshProduct = await fetchProductById(itemData.productId);
  let isMadeToOrder = false;
  let leadTime = "3-5 Business Days (Ready stock)";

  if (freshProduct) {
    const availableStock = getAvailableStock(freshProduct, itemData.material);
    isMadeToOrder = availableStock <= 0 || newQuantity > availableStock;
    leadTime = isMadeToOrder
      ? "14-21 Business Days (Crafted upon order)"
      : "3-5 Business Days (Ready stock)";
  }

  await updateDoc(itemRef, {
    quantity: Number(newQuantity),
    orderType: isMadeToOrder ? "Made-to-Order" : "Ready-to-Ship",
    leadTime: leadTime,
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
 * 1. Inventory Check & Selective Decrement (Decrements physical stock if available; flags as Made-to-Order if stock <= 0)
 * 2. Order Creation with MTO & 50% Downpayment Tracking
 * 3. Cart Purge
 */
export async function placeOrderAtomic({
  userId,
  cartItems,
  totalAmount,
  paymentMethod,
  address,
  paymentOption = "full", // "full" or "downpayment" (50% deposit)
  customNotes = "",
  paymentDetails = {},
}) {
  if (!userId) throw new Error("User ID is required to place an order.");
  if (!cartItems || cartItems.length === 0) throw new Error("Cart is empty.");
  if (!address || !address.fullAddress) throw new Error("Delivery address is required.");

  const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async (transaction) => {
    const productUpdates = [];
    let hasMadeToOrderItems = false;

    for (const item of cartItems) {
      const productRef = doc(db, "products", item.productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        throw new Error(`Product "${item.name}" is no longer listed in catalog.`);
      }

      const pData = productSnap.data();
      const mat = (item.material || "Fabric").toLowerCase();
      const reqQty = Number(item.quantity || 1);

      let available;
      if (mat === "fabric" && typeof pData.FabricStocks === "number") {
        available = pData.FabricStocks;
      } else if (mat === "leather" && typeof pData.LeatherStocks === "number") {
        available = pData.LeatherStocks;
      } else {
        available = typeof pData.stock === "number" ? pData.stock : 0;
      }

      const allowsPreorder = pData.allowPreorder !== false && pData.isMadeToOrder !== false;
      if (available <= 0 && !allowsPreorder) {
        throw new Error(`Product "${item.name}" is currently out of stock and pre-orders are disabled.`);
      }

      if (available <= 0 || reqQty > available) {
        hasMadeToOrderItems = true;
      }

      // If physical stock is available, decrement up to available amount; otherwise keep at 0
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

    // Read cart docs to purge inside transaction
    const cartRef = collection(db, "users", userId, "cart");
    const cartSnap = await getDocs(cartRef);

    // Apply stock decrements
    for (const pUpd of productUpdates) {
      transaction.update(pUpd.ref, pUpd.updates);
    }

    // Build Item Breakdown
    const orderItemsBreakdown = cartItems.map((item) => ({
      productId: item.productId,
      name: item.name,
      price: Number(item.price),
      quantity: Number(item.quantity),
      material: item.material || "Fabric",
      customNotes: item.customNotes || customNotes || "",
      orderType: item.orderType || (hasMadeToOrderItems ? "Made-to-Order" : "Ready-to-Ship"),
      leadTime:
        item.leadTime || (hasMadeToOrderItems ? "14-21 Business Days" : "3-5 Business Days"),
      url: item.url || "",
      subtotal: Number(item.price) * Number(item.quantity),
    }));

    const isDownpayment = paymentOption === "downpayment";
    const parsedTotal = Number(totalAmount);
    const downpaymentAmount = isDownpayment ? Math.round(parsedTotal * 0.3) : parsedTotal;
    const remainingBalance = isDownpayment ? parsedTotal - downpaymentAmount : 0;

    const fulfillmentType =
      address?.pickupAtWorkshop || address?.fulfillmentType === "pickup" ? "pickup" : "delivery";

    const pMethodLower = String(paymentMethod || "").toLowerCase();
    let paymentType = "cod";
    if (pMethodLower.includes("gcash")) paymentType = "gcash";
    else if (pMethodLower.includes("card") || pMethodLower.includes("paymongo"))
      paymentType = "card";
    else if (pMethodLower.includes("bank")) paymentType = "bank";

    const customerName = address.recipientName || address.fullName || address.name || "";
    const customerEmail = address.email || "";

    const landmarkText = String(address.nearestLandmark || address.landmark || "").trim();

    const shippingAddressObj = {
      recipientName: customerName,
      fullName: customerName,
      phoneNumber: address.phoneNumber || "",
      phone: address.phoneNumber || "",
      fullAddress: address.fullAddress || "",
      address: address.fullAddress || "",
      nearestLandmark: landmarkText,
      landmark: landmarkText,
      latitude: address.latitude || null,
      longitude: address.longitude || null,
    };

    const addressObj = {
      recipientName: customerName,
      phoneNumber: address.phoneNumber || "",
      fullAddress: address.fullAddress || "",
      nearestLandmark: landmarkText,
      landmark: landmarkText,
      latitude: address.latitude || null,
      longitude: address.longitude || null,
    };

    const orderDocData = {
      orderId: orderId,
      userId: userId,
      items: orderItemsBreakdown,
      totalAmount: parsedTotal,
      paymentOption: isDownpayment ? "downpayment" : "full",
      downpaymentAmount: downpaymentAmount,
      remainingBalance: remainingBalance,
      balanceDue: remainingBalance,
      balanceStatus: isDownpayment ? "pending" : "settled",
      balanceSettlementMethod: isDownpayment ? null : "full_paid",
      balanceSettledAmount: isDownpayment ? 0 : parsedTotal,
      fulfillmentType: fulfillmentType,
      customerName: customerName,
      customerEmail: customerEmail,
      paymentType: paymentType,
      paymentMethod: paymentMethod, // "COD", "GCash", or "Bank Transfer"
      paymentStatus: isDownpayment
        ? "Downpayment Pending Verification"
        : paymentMethod === "COD"
          ? "Unpaid (COD)"
          : "Paid / Pending Verification",
      orderStatus: "placed", // Canonical lowercase: placed -> downpayment confirmed -> in production -> quality checked -> shipped -> delivered
      status: "placed",
      stockDeducted: true, // Prevents duplicate inventory deduction in admin dashboard
      isMadeToOrder: hasMadeToOrderItems,
      estimatedLeadTime: hasMadeToOrderItems
        ? "14-21 Business Days (Crafted Upon Order)"
        : "3-5 Business Days (Ready Stock)",
      shippingAddress: shippingAddressObj,
      address: addressObj,
      nearestLandmark: landmarkText,
      customNotes: String(customNotes || "").trim(),
      paymentDetails: paymentDetails || {},
      createdAt: serverTimestamp(),
    };

    transaction.set(orderRef, orderDocData);

    // Cart Purge
    cartSnap.docs.forEach((cartDoc) => {
      transaction.delete(cartDoc.ref);
    });
  });

  return { success: true, orderId: orderId };
}

// --- Wishlist Service Functions ---
export function getLocalWishlist() {
  try {
    const data = localStorage.getItem("lanica_wishlist");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveLocalWishlist(list) {
  try {
    localStorage.setItem("lanica_wishlist", JSON.stringify(list || []));
  } catch (e) {
    console.error("Failed to save wishlist to localStorage:", e);
  }
}

export async function fetchWishlist(userId) {
  const localList = getLocalWishlist();
  if (!userId) return localList;

  try {
    const userDocRef = doc(db, "users", userId);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      const dbList = snap.data().wishlist || [];
      const merged = Array.from(new Set([...localList, ...dbList]));
      saveLocalWishlist(merged);
      if (merged.length !== dbList.length) {
        await setDoc(userDocRef, { wishlist: merged }, { merge: true });
      }
      return merged;
    } else if (localList.length > 0) {
      await setDoc(userDocRef, { wishlist: localList }, { merge: true });
    }
  } catch (err) {
    console.error("Error fetching wishlist from Firestore:", err);
  }
  return localList;
}

export async function toggleWishlist(productId, userId) {
  let list = getLocalWishlist();
  const targetId = String(productId && productId.id ? productId.id : productId);
  const index = list.findIndex((item) => String(item && item.id ? item.id : item) === targetId);
  const isFav = index === -1;
  if (index > -1) {
    list.splice(index, 1);
  } else {
    list.push(productId);
  }
  saveLocalWishlist(list);

  if (userId) {
    try {
      const userDocRef = doc(db, "users", userId);
      await setDoc(userDocRef, { wishlist: list }, { merge: true });
    } catch (err) {
      console.error("Error persisting wishlist to Firestore:", err);
    }
  }
  return { wishlist: list, isFav };
}

export function isItemInWishlist(productId) {
  const list = getLocalWishlist();
  const targetId = String(productId && productId.id ? productId.id : productId);
  return list.some((item) => String(item && item.id ? item.id : item) === targetId);
}

