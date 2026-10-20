import { Validators } from "./validator.js";
import { sendEmailAlert } from "./notificationService.js";
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
  const mat = typeof material === "string" ? material.toLowerCase() : String(material || "").toLowerCase();
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
  customUnitPrice = null,
  selectedColor = null
) {
  if (!userId || !product || !product.id) {
    throw new Error("Invalid parameters for addToCart");
  }

  let mat = "Fabric";
  let qty = 1;
  let notes = "";
  let addons = Array.isArray(selectedAddons) ? selectedAddons : [];
  let customPrice = customUnitPrice;

  if (typeof material === "number") {
    qty = material;
    mat = "Fabric";
    if (typeof quantity === "string") {
      notes = quantity;
    } else if (typeof quantity === "object" && quantity !== null) {
      notes = quantity.notes || quantity.customNotes || "";
    }
  } else if (typeof material === "string") {
    mat = material;
    qty = typeof quantity === "number" ? quantity : parseInt(quantity, 10) || 1;
    if (typeof customNotes === "string") {
      notes = customNotes;
    } else if (typeof customNotes === "object" && customNotes !== null) {
      notes = customNotes.notes || customNotes.customNotes || "";
    }
  } else {
    mat = "Fabric";
    qty = typeof quantity === "number" ? quantity : 1;
  }

  // Fetch current fresh stock from Firestore to validate
  const freshProduct = await fetchProductById(product.id);
  const prodToUse = freshProduct || product;

  const colorChosen = selectedColor || product.selectedColor || prodToUse.selectedColor || prodToUse.color || prodToUse.fabricColor || "";
  const colorKey = colorChosen ? `_${colorChosen.replace(/[^a-zA-Z0-9]/g, "")}` : "";
  const addonsKey =
    addons.length > 0
      ? `_${addons.map((a) => a.name).sort().join("_")}`
      : "";
  const itemId = `${product.id}_${mat}${colorKey}${addonsKey}`; // Unique per product variant, color, and selected upgrades
  const itemRef = doc(db, "users", userId, "cart", itemId);

  const availableStock = getAvailableStock(prodToUse, mat);

  // Check existing cart item quantity if any
  const existingDoc = await getDoc(itemRef);
  const existingQty = existingDoc.exists() ? Number(existingDoc.data().quantity || 0) : 0;
  const targetQty = existingQty + Number(qty);

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
  const finalUnitPrice = customPrice !== null ? parsePrice(customPrice) : basePrice;

  const cartPayload = {
    productId: prodToUse.id,
    name: prodToUse.name,
    price: finalUnitPrice,
    basePrice: basePrice,
    selectedAddons: addons,
    url: displayImage,
    quantity: targetQty,
    material: mat,
    color: colorChosen,
    freebies: prodToUse.freebies || "",
    materials: Array.isArray(prodToUse.materials) ? prodToUse.materials : (prodToUse.material ? [prodToUse.material] : []),
    customNotes: String(notes || "").trim(),
    orderType: isMadeToOrder ? "Made-to-Order" : "Ready-to-Ship",
    leadTime: leadTime,
    availableStockSnapshot: availableStock,
    updatedAt: serverTimestamp(),
  };

  await setDoc(itemRef, cartPayload, { merge: true });
  return { success: true, ...cartPayload };
}

/**
 * Update quantity for a specific cart item.
 */
export async function updateCartItemQuantity(userId, itemId, newQuantity) {
  if (!userId || !itemId) return;
  const itemRef = doc(db, "users", userId, "cart", itemId);

  const parsedQty = parseInt(newQuantity, 10);
  if (isNaN(parsedQty) || parsedQty <= 0) {
    await deleteDoc(itemRef);
    return;
  }
  const safeQuantity = Math.min(30, Math.max(1, parsedQty));

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
  paymentOption = "full", // "full" or "downpayment" (30% deposit)
  customNotes = "",
  paymentDetails = {},
  orderId: customOrderId = null,
  branch = null,
}) {
  if (!userId) throw new Error("User ID is required to place an order.");
  if (!cartItems || cartItems.length === 0) throw new Error("Cart is empty.");
  if (!address || !address.fullAddress) throw new Error("Delivery address is required.");
  if (address.phoneNumber && !Validators.isPhilippinePhone(address.phoneNumber)) {
    throw new Error("Invalid Philippine mobile number (e.g. 0917XXXXXXX or +63917XXXXXXX).");
  }

  const orderId = customOrderId || `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const orderRef = doc(db, "orders", orderId);

  // Fetch cart documents to purge before entering transaction
  const cartRef = collection(db, "users", userId, "cart");
  let cartDocs = [];
  try {
    const cartSnap = await getDocs(cartRef);
    cartDocs = cartSnap.docs || [];
  } catch (cartErr) {
    console.warn("Could not pre-fetch cart items for purge:", cartErr);
  }

  await runTransaction(db, async (transaction) => {
    const productDataMap = {};
    let hasMadeToOrderItems = false;

    // Validate products from catalog
    for (const item of cartItems) {
      if (!item.productId) continue;
      const productRef = doc(db, "products", item.productId);
      const productSnap = await transaction.get(productRef);

      if (productSnap.exists()) {
        const pData = productSnap.data();
        productDataMap[item.productId] = pData;
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
      }
    }

    // Build Item Breakdown
    const orderItemsBreakdown = cartItems.map((item) => {
      const pData = productDataMap[item.productId] || {};
      const priceNum = Number(pData.price !== undefined && pData.price !== null ? pData.price : parsePrice(item.price));
      const qtyNum = Number(item.quantity || 1);
      return {
        productId: item.productId || "",
        name: item.name || pData.name || "Custom Furniture",
        price: priceNum,
        quantity: qtyNum,
        material: item.material || "Fabric",
        color: item.color || item.fabricColor || pData.color || pData.fabricColor || (Array.isArray(pData.colors) && pData.colors[0]) || "",
        freebies: item.freebies || pData.freebies || "",
        materials: item.materials || pData.materials || (pData.material ? [pData.material] : []),
        customNotes: item.customNotes || customNotes || "",
        orderType: item.orderType || (hasMadeToOrderItems ? "Made-to-Order" : "Ready-to-Ship"),
        leadTime:
          item.leadTime || (hasMadeToOrderItems ? "14-21 Business Days" : "3-5 Business Days"),
        url: item.url || pData.url || pData.imageUrl || "",
        subtotal: priceNum * qtyNum,
      };
    });

    const pMethodLower = String(paymentMethod || "").toLowerCase();
    let paymentType = "qr_code";
    if (pMethodLower.includes("cash") || pMethodLower.includes("walk_in") || pMethodLower.includes("walk-in") || pMethodLower.includes("counter")) {
      paymentType = "walk_in_cash";
    } else {
      paymentType = "qr_code";
    }

    // Recalculate official totals from catalog documents to prevent client-side pricing tampering
    let authoritativeItemsSubtotal = 0;
    for (const item of cartItems) {
      const pData = productDataMap[item.productId] || {};
      const catalogPrice = Number(pData.price !== undefined && pData.price !== null ? pData.price : parsePrice(item.price));
      const reqQty = Math.max(1, Math.min(30, parseInt(item.quantity, 10) || 1));
      authoritativeItemsSubtotal += catalogPrice * reqQty;
    }

    const isPickup = address?.pickupAtWorkshop === true || address?.fulfillmentType === "pickup";
    const rawDeliveryFee = address.shippingCost ?? address.deliveryFee ?? address.shippingFee;
    const deliveryFee = isPickup ? 0 : (rawDeliveryFee !== undefined && rawDeliveryFee !== null ? Number(rawDeliveryFee) : 0);
    const authoritativeTotal = Math.max(0, authoritativeItemsSubtotal + deliveryFee);

    const isWalkInCash = paymentType === "walk_in_cash" || paymentMethod === "walk_in_cash";
    const isDownpayment = paymentOption === "downpayment" || isWalkInCash;
    const parsedTotal = authoritativeTotal > 0 ? authoritativeTotal : Math.max(0, Number(totalAmount) || 0);
    const downpaymentRequired = Math.round(parsedTotal * 0.30);
    const downpaymentAmount = isDownpayment ? downpaymentRequired : parsedTotal;
    const remainingBalance = isDownpayment ? Math.max(0, parsedTotal - downpaymentAmount) : 0;
    const reservationExpiresAt = isWalkInCash
      ? new Date(Date.now() + 48 * 60 * 60 * 1000)
      : null;

    const fulfillmentType = isPickup ? "pickup" : "delivery";
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

    const isDownpaymentPaid = Boolean(
      paymentDetails?.downpaymentPaid ||
      paymentDetails?.paymentStatus === "downpayment_paid" ||
      paymentDetails?.paymentStatus === "Paid"
    );

    let paymentStatusStr = "Paid / Pending Verification";
    let orderStatusStr = "placed";
    let statusStr = "Placed";

    if (isWalkInCash) {
      paymentStatusStr = "awaiting_counter_downpayment";
      orderStatusStr = "slot_reserved";
      statusStr = "Slot Reserved";
    } else if (isDownpaymentPaid) {
      paymentStatusStr = isDownpayment ? "downpayment_paid" : "Paid";
      orderStatusStr = "downpayment confirmed";
      statusStr = "Deposit Verified";
    } else {
      paymentStatusStr = isDownpayment
        ? "Downpayment Pending Verification"
        : paymentMethod === "COD"
          ? "Unpaid (COD)"
          : "Paid / Pending Verification";
      orderStatusStr = "placed";
      statusStr = "Placed";
    }

    // Branch is NOT automatically set on customer checkout.
    // Admin or Staff explicitly assigns Pila Branch or Calamba Branch after customer deposit is verified.
    const explicitBranch = branch ? String(branch).trim().toLowerCase() : null;
    const assignedBranch = explicitBranch === "pila" || explicitBranch === "calamba" ? explicitBranch : null;
    const assignedBranchName = assignedBranch === "pila" ? "Pila Branch" : assignedBranch === "calamba" ? "Calamba Branch" : "Unassigned";

    const orderDocData = {
      orderId: orderId,
      id: orderId,
      userId: userId,
      customerId: userId,
      customerUid: userId,
      buyerUid: userId,
      orderedByUid: userId,
      createdByUid: userId,
      branch: assignedBranch,
      branchName: assignedBranchName,
      branchKey: assignedBranch,
      items: orderItemsBreakdown,
      totalAmount: parsedTotal,
      total: parsedTotal,
      subtotal: authoritativeItemsSubtotal,
      deliveryFee: deliveryFee,
      shippingFee: deliveryFee,
      orderType: "made_to_order",
      paymentOption: isDownpayment ? "downpayment" : "full",
      downpaymentAmount: downpaymentAmount,
      downpaymentRequired: downpaymentRequired,
      downpaymentPaid: isDownpaymentPaid ? downpaymentAmount : 0,
      remainingBalance: remainingBalance,
      balanceDue: remainingBalance,
      outstandingBalance: remainingBalance,
      balanceStatus: isDownpayment ? "pending" : "settled",
      balanceSettlementMethod: isDownpayment ? null : "full_paid",
      balanceSettledAmount: isDownpayment ? 0 : parsedTotal,
      fulfillmentType: fulfillmentType,
      customerName: customerName,
      customerEmail: customerEmail,
      paymentType: isWalkInCash ? "walk_in_cash" : paymentType,
      paymentMethod: isWalkInCash ? "walk_in_cash" : (paymentMethod || "QR Ph (PayMongo)"),
      paymentStatus: paymentStatusStr,
      orderStatus: orderStatusStr,
      status: statusStr,
      reservationExpiresAt: reservationExpiresAt,
      paymentIntentId: paymentDetails?.paymentIntentId || null,
      downpaymentPaidAt: isDownpaymentPaid ? serverTimestamp() : null,
      placedAt: serverTimestamp(),
      stockDeducted: false, // Inventory deduction is executed by workshop staff/admin during production
      isMadeToOrder: true,
      estimatedLeadTime: "14-21 Business Days (Crafted Upon Order)",
      shippingAddress: shippingAddressObj,
      address: addressObj,
      nearestLandmark: landmarkText,
      customNotes: String(customNotes || "").trim(),
      paymentDetails: paymentDetails || {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Save order document
    transaction.set(orderRef, orderDocData);

    // Purge cart documents inside transaction
    cartDocs.forEach((cartDoc) => {
      transaction.delete(cartDoc.ref);
    });
  });

  clearLocalWishlist();

  // Background dispatch of email alert to Admin
  sendEmailAlert({
    type: "new_order",
    orderId: orderId,
    customerName: customerName,
    totalAmount: parsedTotal,
  }).catch(() => {});

  return { success: true, orderId: orderId };
}

// --- Wishlist Service Functions ---
export function clearLocalWishlist() {
  try {
    localStorage.removeItem("lanica_wishlist");
  } catch (e) {
    console.error("Failed to clear local wishlist:", e);
  }
}

export function getLocalWishlist() {
  if (typeof auth !== "undefined" && !auth?.currentUser) {
    return [];
  }
  try {
    const data = localStorage.getItem("lanica_wishlist");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveLocalWishlist(list) {
  try {
    if (!list || list.length === 0) {
      localStorage.removeItem("lanica_wishlist");
    } else {
      localStorage.setItem("lanica_wishlist", JSON.stringify(list));
    }
  } catch (e) {
    console.error("Failed to save wishlist to localStorage:", e);
  }
}

export async function fetchWishlist(userId) {
  if (!userId) {
    clearLocalWishlist();
    return [];
  }

  try {
    const userDocRef = doc(db, "users", userId);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      const dbList = snap.data().wishlist || [];
      saveLocalWishlist(dbList);
      return dbList;
    }
  } catch (err) {
    console.error("Error fetching wishlist from Firestore:", err);
  }
  return getLocalWishlist();
}

export async function toggleWishlist(productId, userId) {
  if (!userId) {
    clearLocalWishlist();
    return { wishlist: [], isFav: false, requireAuth: true };
  }

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

  try {
    const userDocRef = doc(db, "users", userId);
    await setDoc(userDocRef, { wishlist: list }, { merge: true });
  } catch (err) {
    console.error("Error persisting wishlist to Firestore:", err);
  }
  return { wishlist: list, isFav, requireAuth: false };
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function isItemInWishlist(productId) {
  const list = getLocalWishlist();
  const targetId = String(productId && productId.id ? productId.id : productId);
  return list.some((item) => String(item && item.id ? item.id : item) === targetId);
}

/**
 * Unified Cart Drawer UI Component Renderer
 * Renders modern, polished cart cards with thumbnail, titles, tags, custom notes,
 * quantity controls (- / + pill), red SVG trash icon remove button, subtotal, and checkout state.
 */
export function renderCartDrawerComponent({
  items = [],
  containerId = "cart-items-container",
  badgeId = "cart-badge",
  subtotalId = "cart-subtotal-display",
  checkoutBtnId = "proceed-checkout-btn",
  onUpdateQty = null,
  onRemoveItem = null,
}) {
  const container = document.getElementById(containerId);
  const badge = document.getElementById(badgeId);
  const subtotalEl = document.getElementById(subtotalId);
  const checkoutBtn = document.getElementById(checkoutBtnId);

  const cartItems = Array.isArray(items) ? items : [];
  const totalItemCount = cartItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  if (badge) {
    badge.textContent = totalItemCount;
    badge.style.display = totalItemCount > 0 ? "flex" : "none";
  }

  if (!container) return;

  if (cartItems.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <p>Your shopping bag is empty.</p>
      </div>
    `;
    if (subtotalEl) subtotalEl.textContent = "₱0";
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  let subtotal = 0;
  container.innerHTML = "";

  cartItems.forEach((item) => {
    const itemPrice = parsePrice(item.price);
    const qty = Number(item.quantity || 1);
    const itemTotal = itemPrice * qty;
    subtotal += itemTotal;

    const imgUrl = item.url || item.imageUrl || item.image || "assets/product_sofa.png";
    const isMTO = item.orderType === "Made-to-Order" || item.isMadeToOrder === true;

    const itemCard = document.createElement("div");
    itemCard.className = "cart-item-card";
    itemCard.innerHTML = `
      <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.name || "")}" class="cart-item-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
      <div class="cart-item-details">
        <div class="cart-item-title">${escapeHtml(item.name || "")}</div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
          <span class="cart-item-material">${escapeHtml(item.material || "Fabric")}</span>
          ${item.color ? `<span style="font-size: 0.72rem; color: #1e40af; background: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 6px; border-radius: 4px; font-weight: 600;">Color: ${escapeHtml(item.color)}</span>` : ""}
          ${
            isMTO
              ? '<span style="font-size: 0.72rem; color: #2563eb; background: #eff6ff; padding: 1px 6px; border-radius: 4px; font-weight: 500;">Made-to-Order (14-21d)</span>'
              : '<span style="font-size: 0.72rem; color: #059669; background: #ecfdf5; padding: 1px 6px; border-radius: 4px; font-weight: 500;">Ready Stock</span>'
          }
        </div>
        ${
          item.customNotes
            ? `<p style="font-size: 0.74rem; color: #64748b; margin: 3px 0 0 0; font-style: italic;">Custom: ${escapeHtml(item.customNotes)}</p>`
            : ""
        }
        <div class="cart-item-price" style="margin-top: 4px;">₱${itemTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}</div>
        <div class="quantity-control" style="margin-top: 8px;">
          <button type="button" class="qty-btn cart-qty-minus" data-id="${item.id}">-</button>
          <span class="qty-value">${qty}</span>
          <button type="button" class="qty-btn cart-qty-plus" data-id="${item.id}">+</button>
        </div>
      </div>
      <button class="cart-item-remove" data-id="${item.id}" aria-label="Remove item">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    `;

    container.appendChild(itemCard);
  });

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
  if (checkoutBtn) checkoutBtn.disabled = false;

  // Bind Event Listeners
  if (onUpdateQty) {
    container.querySelectorAll(".cart-qty-minus").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const item = cartItems.find((i) => String(i.id) === String(id));
        if (item) {
          onUpdateQty(id, Number(item.quantity || 1) - 1, item);
        }
      });
    });

    container.querySelectorAll(".cart-qty-plus").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const item = cartItems.find((i) => String(i.id) === String(id));
        if (item) {
          onUpdateQty(id, Number(item.quantity || 1) + 1, item);
        }
      });
    });
  }

  if (onRemoveItem) {
    container.querySelectorAll(".cart-item-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        onRemoveItem(id);
      });
    });
  }
}

