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
  subscribeToUserOrders,
  cancelOrderAtomic,
  normalizeOrderStatus,
  getOrderCanonicalStatus,
  getRiderName,
  isOrderCancellable,
  getTrackingStepIndex,
  calculateEstimatedDelivery,
  formatOrderDate,
} from "./orderService.js";

import { ensureAuth, subscribeToCart } from "./cartService.js";
import {
  getOrCreateUserChatSession,
  sendChatMessage,
  subscribeToMessages,
  uploadChatAttachment,
} from "./chatService.js";

// Global State
let currentUser = null;
let allOrders = [];
let activeTabStatus = "all";
let pendingCancelOrderId = null;
let ordersUnsubscribe = null;
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

  setupMobileMenu();

  // 2. Setup Auth & Cart UI Event Listeners
  setupHeaderAndAuthUI();

  // 3. Initialize Authentication Session & Real-time Listeners
  liveChatController = setupLiveChatWidget();

  try {
    currentUser = await ensureAuth();
    updateAuthUi(currentUser);

    if (currentUser) {
      setupOrdersSubscription(currentUser.uid);
      setupCartSubscription(currentUser.uid);
      liveChatController?.initUserChat(currentUser);
    }
  } catch (err) {
    console.error("Initialization error on Orders page:", err);
    showToast("Failed to initialize user session.", "error");
  }

  // Listen to Auth Changes
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateAuthUi(user);
    if (user) {
      setupOrdersSubscription(user.uid);
      setupCartSubscription(user.uid);
      liveChatController?.initUserChat(user);
    } else {
      window.location.href = "index.html";
    }
  });

  // 4. Setup Tab Listeners
  setupTabListeners();

  // 5. Setup Order Cancellation Modal Listeners
  setupModalListeners();
});

function setupHeaderAndAuthUI() {
  const cartBtn = document.getElementById("cart-toggle-btn");
  const cartOverlay = document.getElementById("cart-drawer-overlay");
  const closeCartBtn = document.getElementById("close-cart-btn");

  const authModalBtn = document.getElementById("auth-modal-btn");
  const authModal = document.getElementById("auth-modal");
  const closeAuthBtn = document.getElementById("close-auth-modal-btn");

  const signOutBtn = document.getElementById("customer-signout-btn");
  const googleBtn = document.getElementById("google-signin-btn");

  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("customer-login-form");
  const registerForm = document.getElementById("customer-register-form");

  // Cart Drawer Toggles
  if (cartBtn && cartOverlay) {
    cartBtn.addEventListener("click", () => cartOverlay.classList.add("active"));
  }
  if (closeCartBtn && cartOverlay) {
    closeCartBtn.addEventListener("click", () => cartOverlay.classList.remove("active"));
  }
  if (cartOverlay) {
    cartOverlay.addEventListener("click", (e) => {
      if (e.target === cartOverlay) cartOverlay.classList.remove("active");
    });
  }

  // Auth Modal Toggles
  if (authModalBtn && authModal) {
    authModalBtn.addEventListener("click", () => authModal.classList.add("active"));
  }
  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener("click", () => authModal.classList.remove("active"));
  }
  if (authModal) {
    authModal.addEventListener("click", (e) => {
      if (e.target === authModal) authModal.classList.remove("active");
    });
  }

  // SIGN OUT HANDLER
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        signOutBtn.disabled = true;
        signOutBtn.textContent = "Signing out...";
        await signOut(auth);
        showToast("Signed out successfully!");
        authModal?.classList.remove("active");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 500);
      } catch (err) {
        console.error("Sign out error:", err);
        showToast(err.message || "Failed to sign out.", "error");
        signOutBtn.disabled = false;
        signOutBtn.textContent = "Sign Out";
      }
    });
  }

  // Google Auth Button
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

  // Login / Register Tabs
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

  // Email Login Form
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-login-email").value;
      const pwd = document.getElementById("cust-login-pwd").value;
      const errEl = document.getElementById("cust-auth-error");

      try {
        if (errEl) errEl.textContent = "";
        await signInWithEmailAndPassword(auth, email, pwd);
        showToast("Signed in successfully!");
        authModal?.classList.remove("active");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Failed to sign in.";
      }
    });
  }

  // Email Register Form
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-reg-email").value;
      const pwd = document.getElementById("cust-reg-pwd").value;
      const errEl = document.getElementById("cust-reg-error");

      try {
        if (errEl) errEl.textContent = "";
        await createUserWithEmailAndPassword(auth, email, pwd);
        showToast("Account created successfully!");
        authModal?.classList.remove("active");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Failed to create account.";
      }
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

function setupCartSubscription(userId) {
  if (cartUnsubscribe) cartUnsubscribe();

  if (userId) {
    cartUnsubscribe = subscribeToCart(userId, (items) => {
      renderCartDrawerUI(items);
    });
  } else {
    renderCartDrawerUI([]);
  }
}

function renderCartDrawerUI(items) {
  const badge = document.getElementById("cart-badge");
  const container = document.getElementById("cart-items-container");

  const count = items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);

  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
  }

  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-state" style="text-align: center; padding: 40px 20px;">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--clr-text-muted); margin-bottom: 12px;">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <p style="color: var(--clr-text-muted); font-size: 0.95rem; margin-bottom: 16px;">Your shopping bag is empty.</p>
        <a href="index.html#collections" class="btn-primary" style="display: inline-block; font-size: 0.9rem; padding: 10px 20px;">
          Browse Catalog
        </a>
      </div>
    `;
    return;
  }

  let html = `<div style="display: flex; flex-direction: column; gap: 14px;">`;
  items.forEach((item) => {
    html += `
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--clr-gray-light); border-radius: 12px;">
        <img src="${item.url || 'assets/product_sofa.png'}" alt="${item.name}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;">
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 0.9rem; color: var(--clr-black);">${item.name}</div>
          <div style="font-size: 0.78rem; color: var(--clr-text-muted);">${item.material || 'Fabric'} x ${item.quantity}</div>
        </div>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--clr-black);">₱${(Number(item.price) * Number(item.quantity)).toLocaleString()}</div>
      </div>
    `;
  });
  html += `
    <a href="index.html" class="btn-primary" style="display: block; text-align: center; text-decoration: none; margin-top: 16px;">
      Go to Checkout
    </a>
  </div>`;

  container.innerHTML = html;
}

function setupOrdersSubscription(userId) {
  if (ordersUnsubscribe) ordersUnsubscribe();

  ordersUnsubscribe = subscribeToUserOrders(userId, (orders) => {
    allOrders = orders;
    updateTabBadges(orders);
    renderOrdersList();
  });
}

function updateTabBadges(orders) {
  const counts = {
    all: orders.length,
    placed: 0,
    inProduction: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };

  orders.forEach((o) => {
    const st = getOrderCanonicalStatus(o);
    if (st === "Placed" || st === "Downpayment Confirmed") counts.placed++;
    else if (st === "In Production" || st === "Quality Checked") counts.inProduction++;
    else if (st === "Shipped") counts.shipped++;
    else if (st === "Delivered") counts.delivered++;
    else if (st === "Cancelled") counts.cancelled++;
  });

  if (document.getElementById("badge-all")) document.getElementById("badge-all").textContent = counts.all;
  if (document.getElementById("badge-placed")) document.getElementById("badge-placed").textContent = counts.placed;
  if (document.getElementById("badge-in-production")) document.getElementById("badge-in-production").textContent = counts.inProduction;
  if (document.getElementById("badge-shipped")) document.getElementById("badge-shipped").textContent = counts.shipped;
  if (document.getElementById("badge-delivered")) document.getElementById("badge-delivered").textContent = counts.delivered;
  if (document.getElementById("badge-cancelled")) document.getElementById("badge-cancelled").textContent = counts.cancelled;
}

function setupTabListeners() {
  const tabsContainer = document.getElementById("orders-status-tabs");
  if (!tabsContainer) return;

  tabsContainer.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabsContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTabStatus = btn.getAttribute("data-status") || "all";
      renderOrdersList();
    });
  });
}

function filterOrdersByTab(orders, tabStatus) {
  if (tabStatus === "all") return orders;

  return orders.filter((o) => {
    const st = getOrderCanonicalStatus(o);
    if (tabStatus === "placed") return st === "Placed" || st === "Downpayment Confirmed";
    if (tabStatus === "in-production") return st === "In Production" || st === "Quality Checked";
    if (tabStatus === "shipped") return st === "Shipped";
    if (tabStatus === "delivered") return st === "Delivered";
    if (tabStatus === "cancelled") return st === "Cancelled";
    return true;
  });
}

function renderOrdersList() {
  const container = document.getElementById("orders-list-container");
  if (!container) return;

  const filteredOrders = filterOrdersByTab(allOrders, activeTabStatus);

  if (filteredOrders.length === 0) {
    container.innerHTML = `
      <div class="orders-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <h3 class="empty-title">No orders found</h3>
        <p class="empty-desc">You don't have any orders matching the "${getTabDisplayName(activeTabStatus)}" filter.</p>
        <a href="index.html#collections" class="btn-secondary" style="display: inline-block;">
          Browse Furniture Catalog
        </a>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  filteredOrders.forEach((order) => {
    const card = createOrderCardElement(order);
    container.appendChild(card);
  });

  // Bind cancel buttons
  container.querySelectorAll(".btn-cancel-order").forEach((btn) => {
    btn.addEventListener("click", () => {
      const orderId = btn.getAttribute("data-order-id");
      if (orderId) openCancelModal(orderId);
    });
  });

  // Bind Chat Workshop buttons on order cards
  container.querySelectorAll(".btn-chat-order").forEach((btn) => {
    btn.addEventListener("click", () => {
      const orderId = btn.getAttribute("data-order-id");
      const drawer = document.getElementById("lanica-chat-drawer");
      const input = document.getElementById("chat-text-input");
      if (drawer) drawer.classList.add("active");
      if (input && orderId) {
        input.value = `Inquiring about Order #${orderId}: `;
        input.focus();
      }
  });
}

function getTabDisplayName(statusKey) {
  switch (statusKey) {
    case "placed":
      return "Placed / Awaiting Verification";
    case "in-production":
      return "In Production";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    case "all":
    default:
      return "All";
  }
}

function createOrderCardElement(order) {
  const card = document.createElement("div");
  card.className = "order-card";

  const orderId = order.orderId || order.id;
  const normStatus = getOrderCanonicalStatus(order);
  const statusClass = normStatus.toLowerCase().replace(/\s+/g, "-");
  const formattedDate = formatOrderDate(order.createdAt);
  const totalAmountFormatted = parseFloat(order.totalAmount || 0).toLocaleString();
  const paymentMethod = order.paymentMethod || "COD";
  const riderName = getRiderName(order);

  const cancellable = isOrderCancellable(normStatus);
  const estDeliveryText = calculateEstimatedDelivery(order);
  const stepIdx = getTrackingStepIndex(normStatus);
  const isMTO = Boolean(order.isMadeToOrder || (Array.isArray(order.items) && order.items.some(i => i.isMadeToOrder || i.orderType === "Made-to-Order")));

  // Build items HTML
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHTML = items
    .map((item) => {
      const imgUrl = item.url || "assets/product_sofa.png";
      const material = item.material || "Fabric";
      const qty = Number(item.quantity || 1);
      const priceFormatted = parseFloat(item.price || 0).toLocaleString();
      const itemIsMTO = item.isMadeToOrder || item.orderType === "Made-to-Order";

      return `
        <div class="order-item-row">
          <img src="${imgUrl}" alt="${escapeHtml(item.name)}" class="item-thumb" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div>
              <span class="item-variant-tag">${escapeHtml(material)}</span>
              <span class="item-qty">x ${qty}</span>
              ${itemIsMTO ? `<span style="background: #eef2ff; color: #4338ca; font-size: 0.72rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">Made-to-Order</span>` : `<span style="background: #ecfdf5; color: #047857; font-size: 0.72rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">Showroom Unit</span>`}
            </div>
            ${item.customNotes ? `
              <div class="item-custom-notes" style="font-size: 0.78rem; color: #b45309; background: #fef3c7; padding: 4px 8px; border-radius: 4px; margin-top: 4px; display: inline-block;">
                <strong>Custom Specs:</strong> ${escapeHtml(item.customNotes)}
              </div>
            ` : ""}
          </div>
          <div class="item-price">₱${priceFormatted}</div>
        </div>
      `;
    })
    .join("");

  // Build 6-Stage Tracking Box
  let trackingBoxHTML;
  if (normStatus === "Cancelled") {
    trackingBoxHTML = `
      <div class="tracking-box" style="border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05);">
        <div style="display: flex; align-items: center; gap: 10px; color: #dc2626;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span style="font-weight: 600; font-size: 0.95rem;">This order was cancelled</span>
          ${order.cancelledAt ? `<span style="font-size: 0.82rem; color: var(--clr-text-muted); margin-left: auto;">(${formatOrderDate(order.cancelledAt)})</span>` : ""}
        </div>
      </div>
    `;
  } else {
    // Hero Banner Status Icon & Subtitle for 6 Stages
    let heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`;
    let heroSubtitle = "Your order has been placed successfully";

    if (normStatus === "Placed") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`;
      heroSubtitle = "Order placed! Our workshop team is reviewing your custom order details.";
    } else if (normStatus === "Downpayment Confirmed") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`;
      heroSubtitle = "50% Downpayment verified! Timber and materials are allocated for production.";
    } else if (normStatus === "In Production") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;
      heroSubtitle = "Lanica master artisans are actively crafting your furniture.";
    } else if (normStatus === "Quality Checked") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 12 15 16 10"></polyline></svg>`;
      heroSubtitle = "Crafting completed and inspected! Passed all quality and finish checks.";
    } else if (normStatus === "Shipped") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`;
      heroSubtitle = "Your piece is carefully padded and on the delivery truck.";
    } else if (normStatus === "Delivered") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
      heroSubtitle = "Your handcrafted Lanica furniture has arrived safely!";
    }

    // Rider Card
    let riderCardHTML = "";
    if (riderName) {
      riderCardHTML = `
        <div class="handled-by-card">
          <div class="handled-by-info">
            <div class="handled-by-avatar">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div>
              <div class="handled-by-text-label">Handled By</div>
              <div class="handled-by-name">${escapeHtml(riderName)}</div>
            </div>
          </div>
          <svg class="verified-badge-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82 1.89 3.2 3.4-1.47 3.4 1.46 1.89-3.19 3.61-.83-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"/>
          </svg>
        </div>
      `;
    }

    // Estimated Delivery Card
    const estDeliveryCardHTML = `
      <div class="est-delivery-card">
        <div class="est-delivery-icon-box">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
            <polyline points="9 16 11 18 15 14"></polyline>
          </svg>
        </div>
        <div>
          <div class="est-delivery-label">Estimated Delivery / Lead Time</div>
          <div class="est-delivery-date">📅 ${estDeliveryText}</div>
        </div>
      </div>
    `;

    // 6-Stage Stepper
    const steps = [
      {
        key: "Placed",
        label: "PLACED",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`,
      },
      {
        key: "Downpayment Confirmed",
        label: "DEPOSIT",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`,
      },
      {
        key: "In Production",
        label: "CRAFTING",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`,
      },
      {
        key: "Quality Checked",
        label: "QC PASSED",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="9 12 12 15 16 10"></polyline></svg>`,
      },
      {
        key: "Shipped",
        label: "SHIPPED",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>`,
      },
      {
        key: "Delivered",
        label: "DELIVERED",
        icon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
      },
    ];

    const stepperStepsHTML = steps
      .map((step, idx) => {
        let isCompleted = idx < stepIdx;
        let isActive = idx === stepIdx;

        let stateClass = "";
        if (isCompleted) stateClass = "completed";
        else if (isActive) stateClass = "active";

        return `
          <div class="stepper-step ${stateClass}">
            <div class="step-icon-wrapper">
              ${step.icon}
            </div>
            <div class="step-label">${step.label}</div>
          </div>
        `;
      })
      .join("");

    const linePercent = Math.min(100, Math.max(0, (stepIdx / 5) * 100));

    trackingBoxHTML = `
      <div class="tracking-box">
        <div class="app-status-hero">
          <div class="app-hero-icon">
            ${heroIconSVG}
          </div>
          <div class="app-status-title">${normStatus}</div>
          <div class="app-status-subtitle">${heroSubtitle}</div>
        </div>

        ${riderCardHTML}
        ${estDeliveryCardHTML}

        <div class="tracking-stepper">
          <div class="stepper-line-container">
            <div class="stepper-line-progress" style="width: ${linePercent}%;"></div>
          </div>
          ${stepperStepsHTML}
        </div>
      </div>
    `;
  }

  // Cancel Button HTML
  let cancelButtonHTML = "";
  if (cancellable) {
    cancelButtonHTML = `
      <button type="button" class="btn-cancel-order" data-order-id="${orderId}">
        Cancel Order
      </button>
    `;
  } else if (normStatus !== "Cancelled") {
    cancelButtonHTML = `
      <button type="button" class="btn-cancel-order" disabled title="Orders in ${normStatus} status cannot be cancelled as manufacturing has begun">
        Cancel Locked (${normStatus})
      </button>
    `;
  }

  // Payment Breakdown
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
  let paymentDetailsHTML = "";
  if (isDownpayment) {
    paymentDetailsHTML = `
      <div class="payment-terms-box" style="margin-top: 8px; font-size: 0.82rem; background: var(--clr-bg-subtle, #f9fafb); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--clr-border, #e5e7eb);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>50% Downpayment (Paid):</span>
          <strong style="color: #059669;">₱${parseFloat(order.downpaymentAmount || 0).toLocaleString()}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Remaining Balance Due upon Delivery:</span>
          <strong style="color: #d97706;">₱${parseFloat(order.balanceDue || 0).toLocaleString()}</strong>
        </div>
        ${order.paymentDetails?.paymentSlipUrl ? `
          <div style="margin-top: 4px;">
            <a href="${order.paymentDetails.paymentSlipUrl}" target="_blank" rel="noopener" style="color: var(--clr-primary, #6b4423); text-decoration: underline; font-weight: 500;">
              View Attached Payment Slip ↗
            </a>
          </div>
        ` : ""}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="order-card-header">
      <div class="order-meta">
        <span class="order-id">Order #${orderId}</span>
        <span class="order-date">Placed on ${formattedDate}</span>
        ${isMTO ? `<span style="background: #eef2ff; color: #4338ca; font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 9999px; margin-left: 8px;">Made-to-Order</span>` : ""}
      </div>
      <div class="status-badge ${statusClass}">
        <span class="status-dot"></span>
        <span>${normStatus}</span>
      </div>
    </div>

    ${trackingBoxHTML}

    <div class="order-items-list">
      ${itemsHTML}
    </div>

    <div class="order-card-footer">
      <div class="payment-method-info">
        <div>
          <span>Payment Method:</span>
          <strong style="color: var(--clr-black);">${escapeHtml(paymentMethod)}</strong>
        </div>
        ${paymentDetailsHTML}
      </div>

      <div class="order-total-box">
        <span class="total-label">Total Contract Price:</span>
        <span class="total-amount">₱${totalAmountFormatted}</span>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn-chat-order" data-order-id="${orderId}" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 6px; background: var(--clr-primary-light, #f4eee7); color: var(--clr-primary, #6b4423); font-weight: 600; font-size: 0.82rem; border: 1px solid var(--clr-primary, #6b4423); cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>Chat Workshop</span>
        </button>
        ${cancelButtonHTML}
      </div>
    </div>
  `;

  return card;
}

// Modal Handlers
function openCancelModal(orderId) {
  pendingCancelOrderId = orderId;
  const modal = document.getElementById("cancel-order-modal");
  const targetIdEl = document.getElementById("cancel-target-order-id");
  const reasonInput = document.getElementById("cancel-reason-input");

  if (targetIdEl) targetIdEl.textContent = `#${orderId}`;
  if (reasonInput) reasonInput.value = "";
  if (modal) modal.classList.add("active");
}

function closeCancelModal() {
  pendingCancelOrderId = null;
  document.getElementById("cancel-order-modal")?.classList.remove("active");
}

function setupModalListeners() {
  const modal = document.getElementById("cancel-order-modal");
  const closeBtn = document.getElementById("close-cancel-modal-btn");
  const dismissBtn = document.getElementById("dismiss-cancel-btn");
  const confirmBtn = document.getElementById("confirm-cancel-btn");

  if (closeBtn) closeBtn.addEventListener("click", closeCancelModal);
  if (dismissBtn) dismissBtn.addEventListener("click", closeCancelModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCancelModal();
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener("click", handleCancelConfirmSubmit);
  }
}

async function handleCancelConfirmSubmit() {
  if (!pendingCancelOrderId || !currentUser) return;

  const confirmBtn = document.getElementById("confirm-cancel-btn");
  const reasonInput = document.getElementById("cancel-reason-input");
  const reason = reasonInput ? reasonInput.value : "";

  try {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <div class="viewer-spinner" style="width: 14px; height: 14px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
      <span>Cancelling Order...</span>
    `;

    await cancelOrderAtomic({
      orderId: pendingCancelOrderId,
      userId: currentUser.uid,
      reason: reason,
    });

    showToast(`Order #${pendingCancelOrderId} cancelled and inventory restocked successfully!`, "success");

    closeCancelModal();
  } catch (err) {
    console.error("Failed to cancel order:", err);
    showToast(err.message || "Failed to cancel order.", "error");
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = `<span>Confirm Cancellation</span>`;
    }
  }
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

function setupLiveChatWidget() {
  const launcher = document.getElementById("lanica-chat-launcher");
  const drawer = document.getElementById("lanica-chat-drawer");
  const closeBtn = document.getElementById("close-chat-drawer-btn");
  const form = document.getElementById("chat-send-form");
  const textInput = document.getElementById("chat-text-input");
  const fileInput = document.getElementById("chat-file-input");
  const attachBtn = document.getElementById("chat-attach-btn");
  const previewBox = document.getElementById("chat-attachment-preview");
  const previewName = document.getElementById("chat-preview-filename");
  const cancelAttachBtn = document.getElementById("chat-cancel-attachment-btn");
  const messagesArea = document.getElementById("chat-messages-area");

  let attachedFile = null;

  if (launcher && drawer) {
    launcher.addEventListener("click", () => {
      drawer.classList.toggle("active");
      if (drawer.classList.contains("active")) {
        textInput?.focus();
        scrollChatToBottom();
      }
    });
  }

  if (closeBtn && drawer) {
    closeBtn.addEventListener("click", () => {
      drawer.classList.remove("active");
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showToast("Attachment size must be under 5MB.", "error");
          fileInput.value = "";
          return;
        }
        attachedFile = file;
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

