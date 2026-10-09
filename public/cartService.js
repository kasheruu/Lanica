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
  customUnitPrice = null
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

  const addonsKey =
    addons.length > 0
      ? `_${addons.map((a) => a.name).sort().join("_")}`
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
    let paymentType = "qr_code";
    if (pMethodLower.includes("cash") || pMethodLower.includes("walk_in") || pMethodLower.includes("walk-in") || pMethodLower.includes("over-the-counter")) {
      paymentType = "walk_in_cash";
    } else {
      paymentType = "qr_code";
    }

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
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
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

