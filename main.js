import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
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

import {
  getOrCreateUserChatSession,
  sendChatMessage,
  subscribeToMessages,
  uploadChatAttachment,
} from "./chatService.js";

// Global State
let currentUser = null;
let currentCartItems = [];
let selectedAddressId = null;
let savedAddresses = [];
let selectedPaymentMethod = "GCash";
let selectedPaymentTerm = "downpayment"; // "downpayment" (50%) or "full" (100%)
let currentModalProduct = null;
let currentSelectedMaterial = "Fabric";
let currentSelectedQty = 1;
let cartUnsubscribe = null;
let chatUnsubscribe = null;
let liveChatController = null;

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
}

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
  // 1. Navbar Scroll Effect & Mobile Drawer Menu
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

  setupMobileMenu();

  // 2. Initialize Authentication & Real-time Cart
  liveChatController = setupLiveChatWidget();

  try {
    currentUser = await ensureAuth();
    setupCartSubscription(currentUser.uid);
    updateAuthUi(currentUser);
    liveChatController?.initUserChat(currentUser);
  } catch (err) {
    console.error("Failed to initialize auth:", err);
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      setupCartSubscription(user.uid);
      updateAuthUi(user);
      liveChatController?.initUserChat(user);
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
    } else {
      productsGrid.innerHTML = `
        <div class="empty-state-container" style="grid-column: 1 / -1;">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h3 class="empty-state-title">No Products Available</h3>
          <p class="empty-state-subtitle">We couldn't find any products matching your selection. Please check back later or refresh.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error loading catalog products:", error);
    if (productsGrid) {
      productsGrid.innerHTML = `
        <div class="empty-state-container" style="grid-column: 1 / -1;">
          <h3 class="empty-state-title">Unable to Load Catalog</h3>
          <p class="empty-state-subtitle">There was an issue fetching products. Please check your connection and try again.</p>
        </div>
      `;
    }
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
    btn.classList.toggle("selected", mat === currentSelectedMaterial);
  });

  const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
  const statusEl = document.getElementById("pv-stock-status");
  const addBtn = document.getElementById("pv-add-to-cart-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");

  if (available > 0) {
    statusEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#059669; display:inline-block;"></span> Ready to Ship (${available} left in showroom)</span>`;
    statusEl.style.color = "#059669";
    addBtn.disabled = false;
    addBtn.textContent = "Add Ready Stock to Bag";

    if (currentSelectedQty < 1) currentSelectedQty = 1;
    if (currentSelectedQty > available) currentSelectedQty = available;
  } else {
    statusEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#2563eb; display:inline-block;"></span> Made-to-Order (Lead Time: 14–21 Days)</span>`;
    statusEl.style.color = "#2563eb";
    addBtn.disabled = false;
    addBtn.textContent = "Place Made-to-Order";

    if (currentSelectedQty < 1) currentSelectedQty = 1;
  }

  document.getElementById("pv-qty-val").textContent = currentSelectedQty;

  if (qtyMinus) qtyMinus.disabled = currentSelectedQty <= 1;
  if (qtyPlus) qtyPlus.disabled = available > 0 ? currentSelectedQty >= available : currentSelectedQty >= 10;
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
    const isMTO = item.orderType === "Made-to-Order";
    itemCard.innerHTML = `
      <img src="${item.url}" alt="${item.name}" class="cart-item-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
      <div class="cart-item-details">
        <div class="cart-item-title">${item.name}</div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
          <span class="cart-item-material">${item.material || "Fabric"}</span>
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
        <div class="cart-item-price" style="margin-top: 4px;">₱${itemTotal.toLocaleString()}</div>
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

function updateCheckoutTotals() {
  const subtotal = currentCartItems.reduce(
    (sum, item) => sum + Number(item.price) * Number(item.quantity),
    0
  );
  const shippingFee = 150;
  const grandTotal = subtotal + shippingFee;

  const subtotalEl = document.getElementById("checkout-subtotal");
  const shippingEl = document.getElementById("checkout-shipping");
  const totalEl = document.getElementById("checkout-total");
  const dueTodayEl = document.getElementById("checkout-due-today");
  const balanceDueEl = document.getElementById("checkout-balance-due");
  const downpaymentRow = document.getElementById("checkout-downpayment-row");
  const balanceRow = document.getElementById("checkout-balance-row");

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (shippingEl) shippingEl.textContent = `₱${shippingFee.toLocaleString()}`;
  if (totalEl) totalEl.textContent = `₱${grandTotal.toLocaleString()}`;

  if (selectedPaymentTerm === "downpayment") {
    const down = Math.round(grandTotal * 0.5);
    const bal = grandTotal - down;
    if (dueTodayEl) dueTodayEl.textContent = `₱${down.toLocaleString()}`;
    if (balanceDueEl) balanceDueEl.textContent = `₱${bal.toLocaleString()}`;
    if (downpaymentRow) {
      downpaymentRow.style.display = "flex";
      const lbl = downpaymentRow.querySelector("span:first-child");
      if (lbl) lbl.textContent = "Due Today (50% Deposit)";
    }
    if (balanceRow) balanceRow.style.display = "flex";
  } else {
    if (dueTodayEl) dueTodayEl.textContent = `₱${grandTotal.toLocaleString()}`;
    if (downpaymentRow) {
      downpaymentRow.style.display = "flex";
      const lbl = downpaymentRow.querySelector("span:first-child");
      if (lbl) lbl.textContent = "Due Today (Full Payment)";
    }
    if (balanceRow) balanceRow.style.display = "none";
  }
}

// Phase 3 & 4: Setup Checkout Modal & Addresses
async function openCheckoutModal() {
  if (!currentUser || currentCartItems.length === 0) return;

  const checkoutModal = document.getElementById("checkout-modal");
  updateCheckoutTotals();

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
      if (maxStock > 0 && currentSelectedQty >= maxStock) {
        showToast(`Selected quantity exceeds available showroom stock (${maxStock}). Additional units will be Made-to-Order.`);
      }
      if (currentSelectedQty < 20) {
        currentSelectedQty++;
        updateVariantStockUI();
      }
    });
  }

  if (addToCartBtn) {
    addToCartBtn.addEventListener("click", () => {
      if (!currentModalProduct) return;
      const customNotes = document.getElementById("pv-custom-notes")?.value || "";

      requireAuth(async () => {
        try {
          await addToCart(
            currentUser.uid,
            currentModalProduct,
            currentSelectedMaterial,
            currentSelectedQty,
            customNotes
          );
          const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
          const modeLabel = available > 0 ? "Ready Stock" : "Made-to-Order";
          showToast(`Added ${currentSelectedQty} x ${currentModalProduct.name} (${currentSelectedMaterial} - ${modeLabel}) to bag!`);
          const notesBox = document.getElementById("pv-custom-notes");
          if (notesBox) notesBox.value = "";
          pvModal.classList.remove("active");
          cartOverlay?.classList.add("active");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }

  // Payment Term Selection (50% Downpayment vs Full Payment)
  document.querySelectorAll('input[name="checkoutPaymentTerm"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedPaymentTerm = e.target.value;
      document.querySelectorAll(".payment-term-card").forEach((c) => c.classList.remove("selected"));
      e.target.closest(".payment-term-card")?.classList.add("selected");
      updateCheckoutTotals();
    });
  });

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

    // 1. Check if customer uploaded proof of payment slip
    let paymentSlipUrl = "";
    const slipInput = document.getElementById("checkout-payment-slip");
    if (slipInput && slipInput.files && slipInput.files[0]) {
      submitBtn.textContent = "Uploading Payment Slip...";
      paymentSlipUrl = await uploadChatAttachment(slipInput.files[0], currentUser.uid);
    }

    // 2. Atomic Order Placement with Made-to-Order & Downpayment Support
    submitBtn.textContent = "Finalizing Order...";
    const result = await placeOrderAtomic({
      userId: currentUser.uid,
      cartItems: currentCartItems,
      totalAmount: totalAmount,
      paymentMethod: selectedPaymentMethod,
      paymentOption: selectedPaymentTerm,
      address: targetAddress,
      paymentDetails: {
        paymentSlipUrl: paymentSlipUrl || null,
        selectedTerm: selectedPaymentTerm,
        accountName: targetAddress.recipientName,
        submittedAt: new Date().toISOString(),
      },
    });

    // 3. Post notification to customer's live chat session with the workshop
    try {
      const termLabel = selectedPaymentTerm === "downpayment" ? "50% Downpayment" : "Full Payment";
      await sendChatMessage({
        chatId: currentUser.uid,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || targetAddress.recipientName || "Customer",
        senderRole: "customer",
        text: `Hello! I have placed Order #${result.orderId} (${termLabel} via ${selectedPaymentMethod}). Total: ₱${totalAmount.toLocaleString()}.`,
        attachmentUrl: paymentSlipUrl || null,
        orderId: result.orderId,
      });
    } catch (chatErr) {
      console.warn("Could not post auto chat confirmation:", chatErr);
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order Now";
    document.getElementById("checkout-modal")?.classList.remove("active");

    showToast(`Order Placed Successfully! (ID: ${result.orderId}). Redirecting to order tracking...`, "success");
    setTimeout(() => {
      window.location.href = "orders.html";
    }, 1500);
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
    setTimeout(() => {
      window.location.href = "orders.html";
    }, 1500);

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

// Show 3D Model Viewer Modal with Admin Parity (Progress & Meshy Polling)
async function show3DModelViewer(productName, productImage, productId, button, originalButtonText) {
  let pollTimer = null;

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "model-viewer-overlay";

  const getGlbViewerUrl = (url) => {
    if (!url) return "";
    return `/api/meshy-glb?url=${encodeURIComponent(url)}`;
  };

  modalOverlay.innerHTML = `
    <div class="model-viewer-modal">
      <div class="model-viewer-header">
        <h3>3D Model Viewer</h3>
        <button class="close-viewer" aria-label="Close 3D viewer">&times;</button>
      </div>
      <div class="model-viewer-content">
        <div class="model-viewer-canvas" style="flex-direction: column; padding: 20px;">
          <div id="pv-3d-status" class="viewer-status" style="visibility: visible;">Downloading and Opening 3D Model...</div>
          <div id="pv-3d-loading" class="viewer-loading active">
            <div class="viewer-spinner"></div>
            <div class="viewer-loading-text">Calibrating 3D object...</div>
          </div>
          <div id="pv-3d-wrapper" style="width: 100%; height: 100%; position: relative; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 320px;">
            <model-viewer
              id="pv-model-viewer-element"
              style="width: 100%; height: 100%; min-height: 320px; border-radius: 8px; background-color: #f5f5f5; display: block;"
              camera-controls
              touch-action="pan-y"
              auto-rotate
              shadow-intensity="1"
              reveal="auto"
              loading="eager"
              ar
              ar-modes="webxr scene-viewer quick-look"
              alt="${productName} 3D Model">
            </model-viewer>
          </div>
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${productName}</h4>
            <p id="pv-3d-desc">Experience this furniture piece in 3D. Rotate to view from different angles and zoom to inspect details.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
  modalOverlay.classList.add("active");

  const statusEl = modalOverlay.querySelector("#pv-3d-status");
  const loadingEl = modalOverlay.querySelector("#pv-3d-loading");
  const modelViewerEl = modalOverlay.querySelector("#pv-model-viewer-element");
  const wrapperEl = modalOverlay.querySelector("#pv-3d-wrapper");
  const descEl = modalOverlay.querySelector("#pv-3d-desc");

  let currentRawModelUrl = null;
  let triedDirectUrl = false;

  const hideLoading = () => {
    if (loadingEl) loadingEl.classList.remove("active");
    if (statusEl) statusEl.style.visibility = "hidden";
  };

  const showFallback2D = (message) => {
    if (loadingEl) loadingEl.classList.remove("active");
    if (statusEl) {
      statusEl.style.visibility = "visible";
      statusEl.textContent = message || "3D model not available for this product yet.";
    }
    if (descEl) {
      descEl.textContent = "This product doesn't have an active 3D model yet. You are viewing a 2D preview.";
    }
    if (wrapperEl) {
      wrapperEl.innerHTML = `
        <div class="model-placeholder">
          <img src="${productImage}" alt="${productName}" class="model-image" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div class="no-3d-message">
            <p>${message || "3D model not available"}</p>
            <p class="fallback-text">Showing 2D preview</p>
          </div>
        </div>
      `;
    }
  };

  if (modelViewerEl) {
    modelViewerEl.addEventListener("load", () => hideLoading());

    modelViewerEl.addEventListener("progress", (ev) => {
      const detail = ev.detail;
      if (detail && typeof detail.totalProgress === "number") {
        const pct = Math.round(detail.totalProgress * 100);
        if (statusEl) {
          statusEl.style.visibility = "visible";
          statusEl.textContent = `Downloading 3D Model... ${pct}%`;
        }
        if (pct >= 100) {
          setTimeout(hideLoading, 350);
        }
      }
    });

    modelViewerEl.addEventListener("error", (ev) => {
      console.warn("Model viewer load error:", ev);
      // Fallback: If proxy endpoint failed on static mobile server, retry directly from raw storage URL
      if (!triedDirectUrl && currentRawModelUrl && (currentRawModelUrl.startsWith("http://") || currentRawModelUrl.startsWith("https://"))) {
        triedDirectUrl = true;
        console.log("Retrying 3D model directly from raw storage URL:", currentRawModelUrl);
        statusEl.style.visibility = "visible";
        statusEl.textContent = "Retrying direct 3D model stream...";
        modelViewerEl.src = currentRawModelUrl;
        return;
      }
      showFallback2D("Failed to load 3D model");
    });
  }

  // Periodic safety check to ensure spinner hides once model is rendered
  const loadCheckInterval = setInterval(() => {
    if (modelViewerEl && modelViewerEl.loaded) {
      hideLoading();
      clearInterval(loadCheckInterval);
    }
  }, 500);

  const closeModal = () => {
    if (pollTimer) clearTimeout(pollTimer);
    clearInterval(loadCheckInterval);
    modalOverlay.remove();
    button.innerHTML = originalButtonText;
  };

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  modalOverlay.querySelector(".close-viewer")?.addEventListener("click", closeModal);

  setTimeout(() => {
    button.innerHTML = originalButtonText;
  }, 400);

  // Fetch product and poll Meshy if needed
  if (!productId) {
    showFallback2D("No product specified.");
    return;
  }

  try {
    const productDoc = await getDoc(doc(db, "products", productId));
    if (!productDoc.exists()) {
      showFallback2D("Product not found.");
      return;
    }

    const pData = productDoc.data();
    const modelUrl = pData.modelUrl || pData.glbUrl || pData.model_url || pData.arModelUrl || pData.usdzUrl;
    currentRawModelUrl = modelUrl;

    if (modelUrl) {
      statusEl.textContent = "Loading 3D model...";
      modelViewerEl.src = getGlbViewerUrl(modelUrl);
      return;
    }

    // Check if Meshy task is generating 3D model
    const taskId = pData.meshyTaskId;
    if (!taskId) {
      showFallback2D("No 3D model available for this product yet.");
      return;
    }

    // Poll Meshy status
    const pollMeshy = async (attempt = 0) => {
      try {
        const response = await fetch(`/api/meshy-image-to-3d/${encodeURIComponent(taskId)}`);
        if (!response.ok) throw new Error("Failed to fetch 3D model generation status.");

        const data = await response.json();
        const status = String(data.status || "").toUpperCase();
        const progress = Number(data.progress || 0);

        if (status === "SUCCEEDED" && data.model_urls && data.model_urls.glb) {
          const targetUrl = getGlbViewerUrl(data.model_urls.glb);
          statusEl.textContent = "Downloading and Opening 3D Model... 100%";
          modelViewerEl.src = targetUrl;
          setTimeout(() => {
            if (modelViewerEl.loaded) hideLoading();
          }, 400);

          // Update product document in background with modelUrl for fast future loads
          try {
            await updateDoc(doc(db, "products", productId), { modelUrl: data.model_urls.glb });
          } catch (e) {
            console.warn("Could not save modelUrl back to product doc:", e);
          }
          return;
        }

        if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
          showFallback2D(`Model generation ${status.toLowerCase()}.`);
          return;
        }

        if (attempt >= 30) {
          showFallback2D("3D model generation timed out. Please try again later.");
          return;
        }

        statusEl.textContent = `Downloading and Opening 3D Model... ${progress}%`;
        pollTimer = setTimeout(() => pollMeshy(attempt + 1), 2500);
      } catch (err) {
        console.error("Meshy polling error:", err);
        showFallback2D("Network error while loading 3D model.");
      }
    };

    await pollMeshy(0);
  } catch (err) {
    console.error("Error opening 3D viewer:", err);
    showFallback2D("Failed to load product details.");
  }
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

function setupMobileMenu() {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.querySelector(".nav-links");
  if (!menuBtn || !navLinks) return;

  const hamburgerIcon = menuBtn.querySelector(".hamburger-icon");
  const closeIcon = menuBtn.querySelector(".close-icon");

  const toggleMenu = (show) => {
    const isOpen = show !== undefined ? show : !navLinks.classList.contains("active");
    navLinks.classList.toggle("active", isOpen);
    menuBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (hamburgerIcon) hamburgerIcon.style.display = isOpen ? "none" : "block";
    if (closeIcon) closeIcon.style.display = isOpen ? "block" : "none";
  };

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => toggleMenu(false));
  });

  document.addEventListener("click", (e) => {
    if (!navLinks.contains(e.target) && !menuBtn.contains(e.target)) {
      toggleMenu(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") toggleMenu(false);
  });
}

// Live Workshop Chat Widget
function setupLiveChatWidget() {
  const launcher = document.getElementById("lanica-chat-launcher");
  const drawer = document.getElementById("lanica-chat-drawer");
  const closeBtn = document.getElementById("close-chat-btn");
  const form = document.getElementById("chat-input-form");
  const textInput = document.getElementById("chat-text-input");
  const fileInput = document.getElementById("chat-file-input");
  const previewBox = document.getElementById("chat-attachment-preview");
  const previewName = document.getElementById("chat-attachment-name");
  const cancelAttachBtn = document.getElementById("chat-cancel-attachment");
  const messagesArea = document.getElementById("chat-messages-area");
  const unreadBadge = document.getElementById("chat-unread-badge");

  let attachedFile = null;

  if (launcher && drawer) {
    launcher.addEventListener("click", () => {
      drawer.classList.toggle("active");
      if (drawer.classList.contains("active")) {
        if (unreadBadge) unreadBadge.style.display = "none";
        textInput?.focus();
        scrollChatToBottom();
      }
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => drawer.classList.remove("active"));
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        attachedFile = fileInput.files[0];
        if (previewBox && previewName) {
          previewName.textContent = attachedFile.name;
          previewBox.style.display = "flex";
        }
      }
    });
  }

  if (cancelAttachBtn) {
    cancelAttachBtn.addEventListener("click", () => {
      attachedFile = null;
      if (fileInput) fileInput.value = "";
      if (previewBox) previewBox.style.display = "none";
    });
  }

  function scrollChatToBottom() {
    if (messagesArea) {
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }
  }

  function initUserChat(user) {
    if (!user) return;
    if (chatUnsubscribe) chatUnsubscribe();

    getOrCreateUserChatSession(user.uid, user.email, user.displayName);

    chatUnsubscribe = subscribeToMessages(user.uid, (messages) => {
      if (!messagesArea) return;

      let html = `
        <div class="chat-welcome-card">
          <p>👋 <strong>Kumusta!</strong> Welcome to Lanica Workshop Support. You can ask for custom furniture dimensions, wood stains, fabric swatches, or inquire about your crafting order progress!</p>
        </div>
      `;

      messages.forEach((m) => {
        const isMe = m.senderId === user.uid;
        const roleClass = isMe ? "customer" : (m.senderRole || "staff");
        const senderLabel = isMe ? "You" : (m.senderName || "Workshop Support");
        const timeStr = m.createdAt?.toDate
          ? m.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        html += `
          <div class="chat-msg-row ${roleClass}">
            <span class="chat-msg-sender">${escapeHtml(senderLabel)}</span>
            <div class="chat-msg-bubble">
              ${m.text ? `<p style="margin: 0;">${escapeHtml(m.text)}</p>` : ""}
              ${
                m.attachmentUrl
                  ? `<a href="${m.attachmentUrl}" target="_blank" rel="noopener"><img src="${m.attachmentUrl}" class="chat-msg-img" alt="Attachment" /></a>`
                  : ""
              }
            </div>
            ${timeStr ? `<span class="chat-msg-time">${timeStr}</span>` : ""}
          </div>
        `;
      });

      messagesArea.innerHTML = html;
      scrollChatToBottom();
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textInput?.value || "";
      if (!text.trim() && !attachedFile) return;

      if (!currentUser) {
        showToast("Please sign in to send a message to our workshop.", "error");
        document.getElementById("auth-modal")?.classList.add("active");
        return;
      }

      try {
        let attachmentUrl = "";
        if (attachedFile) {
          attachmentUrl = await uploadChatAttachment(attachedFile, currentUser.uid);
          attachedFile = null;
          if (fileInput) fileInput.value = "";
          if (previewBox) previewBox.style.display = "none";
        }

        await sendChatMessage({
          chatId: currentUser.uid,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || currentUser.email || "Customer",
          senderRole: "customer",
          text: text,
          attachmentUrl: attachmentUrl,
        });

        if (textInput) textInput.value = "";
        scrollChatToBottom();
      } catch (err) {
        console.error("Chat error:", err);
        showToast(err.message || "Failed to send message.", "error");
      }
    });
  }

  return { initUserChat };
}
