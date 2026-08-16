import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

import {
  auth,
  db,
  ensureAuth,
  subscribeToCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  getUserAddresses,
  saveUserAddress,
  placeOrderAtomic,
  getAvailableStock,
} from "./cartService.js";

// Global State
let currentUser = null;
let currentCartItems = [];
let selectedAddressId = null;
let savedAddresses = [];
let selectedPaymentMethod = "COD";
let currentModalProduct = null;
let currentSelectedMaterial = "Fabric";
let currentSelectedQty = 1;
let cartUnsubscribe = null;

// Helper: Toast Notifications
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === "success" ? "✓" : "⚠️"}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastIn 0.3s reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Navbar Scroll Effect
  const navbar = document.querySelector(".navbar");
  if (navbar) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 50) {
        navbar.classList.add("scrolled");
      } else {
        navbar.classList.remove("scrolled");
      }
    });
  }

  // 2. Initialize Authentication & Real-time Cart
  try {
    currentUser = await ensureAuth();
    setupCartSubscription(currentUser.uid);
    updateAuthUi(currentUser);
  } catch (err) {
    console.error("Failed to initialize auth:", err);
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      setupCartSubscription(user.uid);
      updateAuthUi(user);
    }
  });

  // 3. Load Products from Firebase
  await loadProductsCatalog();

  // 4. Initialize Regular Animations & AR View Buttons
  initAnimations();

  // 5. Setup Storefront Event Listeners & Modals
  setupStorefrontUI();

  // 6. Handle PayMongo Return Payment Redirect if applicable
  await handlePaymentRedirect();

  // 7. Hidden Admin Trigger (Triple click Logo)
  setupAdminLogoTrigger();
});

// Auth Guard Interceptor
function isRealUserLoggedIn() {
  return currentUser && !currentUser.isAnonymous;
}

function requireAuth(actionCallback) {
  if (isRealUserLoggedIn()) {
    actionCallback();
  } else {
    // Intercept unauthenticated guest action and open Sign-In Prompt Modal
    const promptModal = document.getElementById("auth-prompt-modal");
    if (promptModal) {
      promptModal.classList.add("active");
    } else {
      document.getElementById("auth-modal")?.classList.add("active");
    }
  }
}

// Setup Real-time Cart Listener
function setupCartSubscription(userId) {
  if (cartUnsubscribe) cartUnsubscribe();

  // ONLY subscribe to Firestore cart subcollection if user is properly authenticated
  if (isRealUserLoggedIn()) {
    cartUnsubscribe = subscribeToCart(userId, (items) => {
      currentCartItems = items;
      renderCartDrawer(items);
    });
  } else {
    currentCartItems = [];
    renderCartDrawer([]);
  }
}

// Load Products Catalog & Render Cards with Variant & AR buttons
async function loadProductsCatalog() {
  const productsGrid = document.querySelector(".products-grid");
  if (!productsGrid) return;

  try {
    const querySnapshot = await getDocs(collection(db, "products"));

    if (!querySnapshot.empty) {
      productsGrid.innerHTML = ""; // Clear static placeholders

      let delay = 0.1;
      querySnapshot.forEach((docSnap) => {
        const product = docSnap.data();

        const displayImage =
          product.thumbnail ||
          (product.images && (product.images.isoImage || product.images.frontBg)) ||
          product.image ||
          "assets/product_sofa.png";

        const priceFormatted = parseFloat(product.price || 0).toLocaleString();

        const productHTML = `
          <div class="product-card reveal" style="--delay: ${delay}s">
            <div class="product-image-container">
              <img src="${displayImage}" alt="${product.name}" class="product-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
              <button class="btn-ar-view" data-product-id="${docSnap.id}" title="View in 3D">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                <span>3D</span>
              </button>
              <button class="btn-quick-order" data-product-id="${docSnap.id}">
                Order Now
              </button>
            </div>
            <div class="product-info">
              <h3>${product.name}</h3>
              <p class="price">₱${priceFormatted}</p>
            </div>
          </div>
        `;
        productsGrid.insertAdjacentHTML("beforeend", productHTML);
        delay += 0.1;
      });

      // Bind AR & Quick Order buttons
      bindProductCardButtons();
    }
  } catch (error) {
    console.error("Error loading catalog products:", error);
  }
}

// Bind buttons on product cards
function bindProductCardButtons() {
  bindARButtons();

  document.querySelectorAll(".btn-quick-order").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const productId = btn.getAttribute("data-product-id");
      if (productId) {
        await openProductQuickViewModal(productId);
      }
    });
  });
}

// Phase 1: Open Product Quick View Modal with Variant Selection & Stock Validation
async function openProductQuickViewModal(productId) {
  const modal = document.getElementById("product-detail-modal");
  if (!modal) return;

  try {
    const productDoc = await getDoc(doc(db, "products", productId));
    if (!productDoc.exists()) {
      showToast("Product not found.", "error");
      return;
    }

    currentModalProduct = { id: productDoc.id, ...productDoc.data() };
    currentSelectedMaterial = "Fabric";
    currentSelectedQty = 1;

    // Populate modal content
    const displayImg =
      currentModalProduct.thumbnail ||
      (currentModalProduct.images && (currentModalProduct.images.isoImage || currentModalProduct.images.frontBg)) ||
      currentModalProduct.image ||
      "assets/product_sofa.png";

    document.getElementById("pv-name").textContent = currentModalProduct.name;
    document.getElementById("pv-image").src = displayImg;
    document.getElementById("pv-price").textContent = `₱${parseFloat(currentModalProduct.price || 0).toLocaleString()}`;

    // Stocks breakdown
    const fabricStock = typeof currentModalProduct.FabricStocks === "number" ? currentModalProduct.FabricStocks : (currentModalProduct.stock || 0);
    const leatherStock = typeof currentModalProduct.LeatherStocks === "number" ? currentModalProduct.LeatherStocks : (currentModalProduct.stock || 0);

    document.getElementById("pv-fabric-stock").textContent = `${fabricStock} left`;
    document.getElementById("pv-leather-stock").textContent = `${leatherStock} left`;

    updateVariantStockUI();

    // Show modal
    modal.classList.add("active");
  } catch (err) {
    console.error("Error opening product modal:", err);
    showToast("Failed to load product details.", "error");
  }
}

function updateVariantStockUI() {
  if (!currentModalProduct) return;

  const matButtons = document.querySelectorAll(".material-btn");
  matButtons.forEach((btn) => {
    const mat = btn.getAttribute("data-material");
    const stock = getAvailableStock(currentModalProduct, mat);

    btn.classList.toggle("selected", mat === currentSelectedMaterial);
    btn.classList.toggle("out-of-stock", stock <= 0);
  });

  const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
  const statusEl = document.getElementById("pv-stock-status");
  const addBtn = document.getElementById("pv-add-to-cart-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");

  if (available > 0) {
    statusEl.textContent = `In Stock (${available} left)`;
    statusEl.style.color = "#059669";
    addBtn.disabled = false;
    addBtn.textContent = "Add to Shopping Bag";

    if (currentSelectedQty < 1) currentSelectedQty = 1;
    if (currentSelectedQty > available) currentSelectedQty = available;
  } else {
    statusEl.textContent = "Out of Stock";
    statusEl.style.color = "#ef4444";
    addBtn.disabled = true;
    addBtn.textContent = "Out of Stock";
    currentSelectedQty = 0;
  }

  document.getElementById("pv-qty-val").textContent = currentSelectedQty;

  if (qtyMinus) qtyMinus.disabled = currentSelectedQty <= 1 || available <= 0;
  if (qtyPlus) qtyPlus.disabled = currentSelectedQty >= available || available <= 0;
}

// Phase 2: Render Cart Drawer
function renderCartDrawer(items) {
  const container = document.getElementById("cart-items-container");
  const badge = document.getElementById("cart-badge");
  const subtotalEl = document.getElementById("cart-subtotal-display");
  const checkoutBtn = document.getElementById("proceed-checkout-btn");

  const totalItemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  if (badge) {
    badge.textContent = totalItemCount;
    badge.style.display = totalItemCount > 0 ? "flex" : "none";
  }

  let subtotal = 0;

  if (!items || items.length === 0) {
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

  container.innerHTML = "";

  items.forEach((item) => {
    const itemTotal = Number(item.price) * Number(item.quantity);
    subtotal += itemTotal;

    const itemCard = document.createElement("div");
    itemCard.className = "cart-item-card";
    itemCard.innerHTML = `
      <img src="${item.url}" alt="${item.name}" class="cart-item-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
      <div class="cart-item-details">
        <div class="cart-item-title">${item.name}</div>
        <span class="cart-item-material">${item.material || "Fabric"}</span>
        <div class="cart-item-price">₱${itemTotal.toLocaleString()}</div>
        <div class="quantity-control" style="margin-top: 8px;">
          <button type="button" class="qty-btn cart-qty-minus" data-id="${item.id}">-</button>
          <span class="qty-value">${item.quantity}</span>
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

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (checkoutBtn) checkoutBtn.disabled = false;

  // Bind cart item actions
  container.querySelectorAll(".cart-qty-minus").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => i.id === id);
      if (item) {
        await updateCartItemQuantity(currentUser.uid, id, item.quantity - 1);
      }
    });
  });

  container.querySelectorAll(".cart-qty-plus").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => i.id === id);
      if (item) {
        try {
          await updateCartItemQuantity(currentUser.uid, id, item.quantity + 1);
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });
  });

  container.querySelectorAll(".cart-item-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await removeCartItem(currentUser.uid, id);
      showToast("Item removed from bag.");
    });
  });
}

// Phase 3 & 4: Setup Checkout Modal & Addresses
async function openCheckoutModal() {
  if (!currentUser || currentCartItems.length === 0) return;

  const checkoutModal = document.getElementById("checkout-modal");
  const subtotalEl = document.getElementById("checkout-subtotal");
  const shippingEl = document.getElementById("checkout-shipping");
  const totalEl = document.getElementById("checkout-total");

  const subtotal = currentCartItems.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );
  const shippingFee = 150;
  const grandTotal = subtotal + shippingFee;

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (shippingEl) shippingEl.textContent = `₱${shippingFee.toLocaleString()}`;
  if (totalEl) totalEl.textContent = `₱${grandTotal.toLocaleString()}`;

  // Load saved addresses
  await loadUserAddresses();

  // Close cart drawer & open checkout modal
  document.getElementById("cart-drawer-overlay")?.classList.remove("active");
  checkoutModal?.classList.add("active");
}

async function loadUserAddresses() {
  const container = document.getElementById("saved-addresses-list");
  if (!container || !currentUser) return;

  try {
    savedAddresses = await getUserAddresses(currentUser.uid);
    container.innerHTML = "";

    if (savedAddresses.length === 0) {
      container.innerHTML = `<p style="font-size: 0.85rem; color: var(--clr-text-muted);">No saved addresses yet. Please add one below.</p>`;
      document.getElementById("address-form").style.display = "block";
      selectedAddressId = null;
      return;
    }

    // Default select first address
    if (!selectedAddressId && savedAddresses.length > 0) {
      selectedAddressId = savedAddresses[0].id;
    }

    savedAddresses.forEach((addr) => {
      const card = document.createElement("div");
      card.className = `address-card ${addr.id === selectedAddressId ? "selected" : ""}`;
      card.innerHTML = `
        <div class="address-card-info">
          <h5>${addr.recipientName} (${addr.phoneNumber})</h5>
          <p>${addr.fullAddress}</p>
        </div>
      `;
      card.addEventListener("click", () => {
        selectedAddressId = addr.id;
        document.querySelectorAll(".address-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading addresses:", err);
  }
}

// Storefront UI Wireup
function setupStorefrontUI() {
  // Cart Drawer toggles
  const cartBtn = document.getElementById("cart-toggle-btn");
  const cartOverlay = document.getElementById("cart-drawer-overlay");
  const closeCartBtn = document.getElementById("close-cart-btn");
  const proceedCheckoutBtn = document.getElementById("proceed-checkout-btn");

  if (cartBtn && cartOverlay) {
    cartBtn.addEventListener("click", () => cartOverlay.classList.add("active"));
  }
  if (closeCartBtn && cartOverlay) {
    closeCartBtn.addEventListener("click", () => cartOverlay.classList.remove("active"));
  }
  if (proceedCheckoutBtn) {
    proceedCheckoutBtn.addEventListener("click", openCheckoutModal);
  }

  // Product Detail Quick View Modal Toggles
  const pvModal = document.getElementById("product-detail-modal");
  const closePvBtn = document.getElementById("close-product-modal-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");
  const addToCartBtn = document.getElementById("pv-add-to-cart-btn");

  if (closePvBtn && pvModal) {
    closePvBtn.addEventListener("click", () => pvModal.classList.remove("active"));
  }

  // Material variant buttons
  document.querySelectorAll(".material-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mat = btn.getAttribute("data-material");
      if (mat) {
        currentSelectedMaterial = mat;
        updateVariantStockUI();
      }
    });
  });

  if (qtyMinus) {
    qtyMinus.addEventListener("click", () => {
      if (currentSelectedQty > 1) {
        currentSelectedQty--;
        updateVariantStockUI();
      }
    });
  }

  if (qtyPlus) {
    qtyPlus.addEventListener("click", () => {
      const maxStock = getAvailableStock(currentModalProduct, currentSelectedMaterial);
      if (currentSelectedQty < maxStock) {
        currentSelectedQty++;
        updateVariantStockUI();
      } else {
        showToast(`Only ${maxStock} items available in stock.`, "error");
      }
    });
  }

  if (addToCartBtn) {
    addToCartBtn.addEventListener("click", () => {
      if (!currentModalProduct) return;

      requireAuth(async () => {
        try {
          await addToCart(
            currentUser.uid,
            currentModalProduct,
            currentSelectedMaterial,
            currentSelectedQty
          );
          showToast(`Added ${currentSelectedQty} x ${currentModalProduct.name} (${currentSelectedMaterial}) to bag!`);
          pvModal.classList.remove("active");
          cartOverlay?.classList.add("active");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }

  // Unauthenticated Sign-In Prompt Modal Toggles
  const authPromptModal = document.getElementById("auth-prompt-modal");
  const closeAuthPromptBtn = document.getElementById("close-auth-prompt-btn");
  const promptSigninBtn = document.getElementById("prompt-signin-btn");
  const promptContinueBtn = document.getElementById("prompt-continue-btn");

  if (closeAuthPromptBtn && authPromptModal) {
    closeAuthPromptBtn.addEventListener("click", () => authPromptModal.classList.remove("active"));
  }
  if (promptContinueBtn && authPromptModal) {
    promptContinueBtn.addEventListener("click", () => authPromptModal.classList.remove("active"));
  }
  if (promptSigninBtn && authPromptModal) {
    promptSigninBtn.addEventListener("click", () => {
      authPromptModal.classList.remove("active");
      document.getElementById("auth-modal")?.classList.add("active");
    });
  }

  // Checkout Modal Toggles
  const checkoutModal = document.getElementById("checkout-modal");
  const closeCheckoutBtn = document.getElementById("close-checkout-modal-btn");
  const toggleAddressBtn = document.getElementById("toggle-new-address-btn");
  const addressForm = document.getElementById("address-form");

  if (closeCheckoutBtn && checkoutModal) {
    closeCheckoutBtn.addEventListener("click", () => checkoutModal.classList.remove("active"));
  }

  if (toggleAddressBtn && addressForm) {
    toggleAddressBtn.addEventListener("click", () => {
      const isHidden = addressForm.style.display === "none";
      addressForm.style.display = isHidden ? "block" : "none";
    });
  }

  if (addressForm) {
    addressForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const addressData = {
          recipientName: document.getElementById("addr-name").value,
          phoneNumber: document.getElementById("addr-phone").value,
          fullAddress: document.getElementById("addr-full").value,
          latitude: document.getElementById("addr-lat").value || null,
          longitude: document.getElementById("addr-lng").value || null,
        };

        const newAddr = await saveUserAddress(currentUser.uid, addressData);
        showToast("Address saved successfully!");
        addressForm.reset();
        addressForm.style.display = "none";
        selectedAddressId = newAddr.id;
        await loadUserAddresses();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // Payment Method Radio Cards Selection
  document.querySelectorAll(".payment-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".payment-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedPaymentMethod = card.getAttribute("data-method") || "COD";
    });
  });

  // Place Order Submit Handler
  const placeOrderBtn = document.getElementById("place-order-submit-btn");
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener("click", handlePlaceOrderSubmit);
  }

  // Customer Auth Modal Wireup
  const authModalBtn = document.getElementById("auth-modal-btn");
  const authModal = document.getElementById("auth-modal");
  const closeAuthBtn = document.getElementById("close-auth-modal-btn");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("customer-login-form");
  const registerForm = document.getElementById("customer-register-form");
  const signOutBtn = document.getElementById("customer-signout-btn");

  const googleBtn = document.getElementById("google-signin-btn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        showToast("Signed in with Google!");
        authModal?.classList.remove("active");
      } catch (err) {
        console.error("Google Auth error:", err);
        showToast(err.message || "Failed to sign in with Google.", "error");
      }
    });
  }

  if (authModalBtn && authModal) {
    authModalBtn.addEventListener("click", () => authModal.classList.add("active"));
  }
  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener("click", () => authModal.classList.remove("active"));
  }

  if (tabLogin && tabRegister && loginForm && registerForm) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      loginForm.style.display = "flex";
      registerForm.style.display = "none";
    });

    tabRegister.addEventListener("click", () => {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      registerForm.style.display = "flex";
      loginForm.style.display = "none";
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-login-email").value;
      const pwd = document.getElementById("cust-login-pwd").value;
      const errEl = document.getElementById("cust-auth-error");

      try {
        errEl.textContent = "";
        await signInWithEmailAndPassword(auth, email, pwd);
        showToast("Signed in successfully!");
        authModal.classList.remove("active");
      } catch (err) {
        errEl.textContent = err.message || "Failed to sign in.";
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-reg-email").value;
      const pwd = document.getElementById("cust-reg-pwd").value;
      const errEl = document.getElementById("cust-reg-error");

      try {
        errEl.textContent = "";
        await createUserWithEmailAndPassword(auth, email, pwd);
        showToast("Account created successfully!");
        authModal.classList.remove("active");
      } catch (err) {
        errEl.textContent = err.message || "Failed to create account.";
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      await signOut(auth);
      showToast("Signed out.");
      authModal.classList.remove("active");
    });
  }
}

function updateAuthUi(user) {
  const signedInBox = document.getElementById("customer-signed-in-box");
  const authFormsBox = document.getElementById("customer-auth-forms-box");
  const emailDisplay = document.getElementById("customer-email-display");

  if (user && !user.isAnonymous) {
    if (signedInBox) signedInBox.style.display = "block";
    if (authFormsBox) authFormsBox.style.display = "none";
    if (emailDisplay) emailDisplay.textContent = user.email || user.uid;
  } else {
    if (signedInBox) signedInBox.style.display = "none";
    if (authFormsBox) authFormsBox.style.display = "block";
  }
}

// Phase 4 & Phase 5: Place Order Submit Handler
async function handlePlaceOrderSubmit() {
  const submitBtn = document.getElementById("place-order-submit-btn");
  if (!submitBtn) return;

  if (currentCartItems.length === 0) {
    showToast("Your shopping bag is empty.", "error");
    return;
  }

  const targetAddress = savedAddresses.find((a) => a.id === selectedAddressId);
  if (!targetAddress) {
    showToast("Please select or add a shipping address.", "error");
    return;
  }

  const subtotal = currentCartItems.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );
  const shippingFee = 150;
  const totalAmount = subtotal + shippingFee;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing Order...";

    if (selectedPaymentMethod === "COD") {
      // Phase 5: Atomic Order Placement & Inventory Deduction
      const result = await placeOrderAtomic({
        userId: currentUser.uid,
        cartItems: currentCartItems,
        totalAmount: totalAmount,
        paymentMethod: "COD",
        address: targetAddress,
      });

      submitBtn.disabled = false;
      submitBtn.textContent = "Place Order Now";
      document.getElementById("checkout-modal")?.classList.remove("active");

      showToast(`Order Placed Successfully! ID: ${result.orderId}`, "success");
    } else {
      // Phase 4: Online Payment Integration (PayMongo for GCash / Bank Transfer)
      sessionStorage.setItem(
        "pending_order_data",
        JSON.stringify({
          userId: currentUser.uid,
          cartItems: currentCartItems,
          totalAmount: totalAmount,
          paymentMethod: selectedPaymentMethod,
          address: targetAddress,
        })
      );

      const response = await fetch("/api/paymongo/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: currentCartItems,
          subtotal: subtotal,
          shippingFee: shippingFee,
          totalAmount: totalAmount,
          paymentMethod: selectedPaymentMethod,
          userId: currentUser.uid,
        }),
      });

      const data = await response.json();
      submitBtn.disabled = false;
      submitBtn.textContent = "Place Order Now";

      if (!response.ok || !data.checkout_url) {
        throw new Error(data.error || "Failed to initiate online checkout.");
      }

      // Redirect to PayMongo hosted checkout
      window.location.href = data.checkout_url;
    }
  } catch (err) {
    console.error("Place Order Error:", err);
    showToast(err.message || "Failed to place order.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order Now";
  }
}

// Handle Return from PayMongo Checkout Redirect
async function handlePaymentRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const isSuccess = urlParams.get("payment") === "success";

  if (!isSuccess) return;

  const rawPending = sessionStorage.getItem("pending_order_data");
  if (!rawPending) return;

  try {
    const pendingOrder = JSON.parse(rawPending);
    sessionStorage.removeItem("pending_order_data");

    // Execute Atomic Order Placement upon successful payment authorization
    const result = await placeOrderAtomic({
      userId: pendingOrder.userId || currentUser.uid,
      cartItems: pendingOrder.cartItems,
      totalAmount: pendingOrder.totalAmount,
      paymentMethod: pendingOrder.paymentMethod || "GCash",
      address: pendingOrder.address,
      paymentDetails: {
        paymongoSuccess: true,
        sessionId: urlParams.get("session_id") || "completed",
      },
    });

    showToast(`Payment Authorized! Order Placed Successfully (ID: ${result.orderId})`, "success");

    // Clean up query string from address bar
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error("Payment Return Order Error:", err);
    showToast(`Payment Authorized, but order finalization had an issue: ${err.message}`, "error");
  }
}

// Animations helper
function initAnimations() {
  const observerOptions = {
    root: null,
    rootMargin: "0px",
    threshold: 0.15,
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll(".slide-up, .reveal").forEach((el) => observer.observe(el));

  setTimeout(() => {
    document.querySelectorAll(".hero .slide-up, .hero .reveal").forEach((el) => el.classList.add("active"));
  }, 100);

  bindARButtons();
}

// AR Buttons 3D Viewer binding
function bindARButtons() {
  const arButtons = document.querySelectorAll(".btn-ar-view");
  arButtons.forEach((btn) => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const originalText = newBtn.innerHTML;
      newBtn.innerHTML = `<div class="dot active"></div> Loading 3D...`;

      const productCard = newBtn.closest(".product-card");
      const productName = productCard?.querySelector("h3")?.textContent || "Product";
      const productImage = productCard?.querySelector(".product-img")?.src || "";
      const productId = newBtn.getAttribute("data-product-id");

      await show3DModelViewer(productName, productImage, productId, newBtn, originalText);
    });
  });
}

// Show 3D Model Viewer Modal
async function show3DModelViewer(productName, productImage, productId, button, originalButtonText) {
  let modelUrl = null;
  let has3DModel = false;

  if (productId) {
    try {
      const productDoc = await getDoc(doc(db, "products", productId));
      if (productDoc.exists()) {
        const pData = productDoc.data();
        modelUrl = pData.modelUrl || pData.glbUrl || pData.model_url || pData.arModelUrl || pData.usdzUrl || null;
        has3DModel = !!modelUrl;
      }
    } catch (error) {
      console.error("Error fetching product data for 3D viewer:", error);
    }
  }

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "model-viewer-overlay";

  const getGlbViewerUrl = (url) => {
    if (!url) return "";
    // Always proxy 3D GLB model URLs through /api/meshy-glb to eliminate CORS errors on Cloudflare Pages
    return `/api/meshy-glb?url=${encodeURIComponent(url)}`;
  };

  const viewerContent = has3DModel
    ? `<model-viewer
         src="${getGlbViewerUrl(modelUrl)}"
         style="width: 100%; height: 100%;"
         camera-controls
         auto-rotate
         shadow-intensity="1"
         alt="${productName} 3D Model">
       </model-viewer>`
    : `<div class="model-placeholder">
        <img src="${productImage}" alt="${productName}" class="model-image">
        <div class="no-3d-message">
          <p>3D model not available for this product</p>
          <p class="fallback-text">Showing 2D preview</p>
        </div>
       </div>`;

  modalOverlay.innerHTML = `
    <div class="model-viewer-modal">
      <div class="model-viewer-header">
        <h3>${productName} - 3D View</h3>
        <button class="close-viewer" aria-label="Close 3D viewer">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="model-viewer-content">
        <div class="model-viewer-canvas">
          ${viewerContent}
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${productName}</h4>
            <p>${
              has3DModel
                ? "Experience this furniture piece in 3D. Rotate to view from different angles and zoom to see details."
                : "This product doesn't have a 3D model available yet. You're viewing a 2D preview."
            }</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);

  // Add error listener to fallback if model viewer fails to load model
  const modelViewerEl = modalOverlay.querySelector("model-viewer");
  if (modelViewerEl) {
    modelViewerEl.addEventListener("error", (ev) => {
      console.warn("Model viewer load error, displaying 2D fallback:", ev);
      const canvasEl = modalOverlay.querySelector(".model-viewer-canvas");
      if (canvasEl) {
        canvasEl.innerHTML = `
          <div class="model-placeholder">
            <img src="${productImage}" alt="${productName}" class="model-image">
            <div class="no-3d-message">
              <p>3D model loading error</p>
              <p class="fallback-text">Showing 2D preview</p>
            </div>
          </div>
        `;
      }
    });
  }

  const closeModal = () => {
    modalOverlay.remove();
    button.innerHTML = originalButtonText;
  };

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  modalOverlay.querySelector(".close-viewer")?.addEventListener("click", closeModal);

  setTimeout(() => {
    button.innerHTML = originalButtonText;
  }, 500);
}

// Hidden Admin Trigger
function setupAdminLogoTrigger() {
  const logoArea = document.querySelector(".logo");
  if (!logoArea) return;

  const clickWindowMs = 1100;
  let clickTimes = [];
  let redirecting = false;

  logoArea.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (redirecting) return;

    const now = Date.now();
    clickTimes.push(now);
    clickTimes = clickTimes.filter((t) => now - t <= clickWindowMs);

    if (clickTimes.length >= 3) {
      redirecting = true;
      clickTimes = [];
      window.location.href = "/login.html";
    }
  });

  logoArea.setAttribute("title", "Lanica Furniture (Triple click for CMS)");
  logoArea.style.cursor = "pointer";
}
