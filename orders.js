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
  ensureAuth,
  subscribeToUserOrders,
  cancelOrderAtomic,
  normalizeOrderStatus,
  isOrderCancellable,
  getTrackingStepIndex,
  calculateEstimatedDelivery,
  formatOrderDate,
} from "./orderService.js";

import { subscribeToCart } from "./cartService.js";

// Global State
let currentUser = null;
let allOrders = [];
let activeTabStatus = "all";
let pendingCancelOrderId = null;
let ordersUnsubscribe = null;
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

  // 2. Setup Auth & Cart UI Event Listeners
  setupHeaderAndAuthUI();

  // 3. Initialize Authentication Session & Real-time Listeners
  try {
    currentUser = await ensureAuth();
    updateAuthUi(currentUser);

    if (currentUser) {
      setupOrdersSubscription(currentUser.uid);
      setupCartSubscription(currentUser.uid);
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

  // SIGN OUT HANDLER (FIX FOR UI/UX BUG)
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
    pending: 0,
    to_ship: 0,
    to_receive: 0,
    delivered: 0,
    cancelled: 0,
  };

  orders.forEach((o) => {
    const st = normalizeOrderStatus(o.orderStatus || o.status);
    if (st === "Pending" || st === "Processing") counts.pending++;
    else if (st === "To Ship") counts.to_ship++;
    else if (st === "To Receive") counts.to_receive++;
    else if (st === "Delivered") counts.delivered++;
    else if (st === "Cancelled") counts.cancelled++;
  });

  document.getElementById("badge-all").textContent = counts.all;
  document.getElementById("badge-pending").textContent = counts.pending;
  document.getElementById("badge-to-ship").textContent = counts.to_ship;
  document.getElementById("badge-to-receive").textContent = counts.to_receive;
  document.getElementById("badge-delivered").textContent = counts.delivered;
  document.getElementById("badge-cancelled").textContent = counts.cancelled;
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
    const st = normalizeOrderStatus(o.orderStatus || o.status);
    if (tabStatus === "pending_processing") return st === "Pending" || st === "Processing";
    if (tabStatus === "to_ship") return st === "To Ship";
    if (tabStatus === "to_receive") return st === "To Receive";
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
}

function getTabDisplayName(statusKey) {
  switch (statusKey) {
    case "pending_processing":
      return "Pending / Processing";
    case "to_ship":
      return "To Ship";
    case "to_receive":
      return "To Receive";
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
  const rawStatus = order.orderStatus || order.status;
  const normStatus = normalizeOrderStatus(rawStatus);
  const statusClass = normStatus.toLowerCase().replace(/\s+/g, "-");
  const formattedDate = formatOrderDate(order.createdAt);
  const totalAmountFormatted = parseFloat(order.totalAmount || 0).toLocaleString();
  const paymentMethod = order.paymentMethod || "COD";

  const cancellable = isOrderCancellable(normStatus);
  const estDeliveryText = calculateEstimatedDelivery(order.createdAt);
  const stepIdx = getTrackingStepIndex(normStatus);

  // Build items HTML
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHTML = items
    .map((item) => {
      const imgUrl = item.url || "assets/product_sofa.png";
      const material = item.material || "Fabric";
      const qty = Number(item.quantity || 1);
      const priceFormatted = parseFloat(item.price || 0).toLocaleString();

      return `
        <div class="order-item-row">
          <img src="${imgUrl}" alt="${item.name}" class="item-thumb" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div class="item-info">
            <div class="item-name">${item.name}</div>
            <div>
              <span class="item-variant-tag">${material}</span>
              <span class="item-qty">x ${qty}</span>
            </div>
          </div>
          <div class="item-price">₱${priceFormatted}</div>
        </div>
      `;
    })
    .join("");

  // Build Visual Stepper HTML
  let trackingBoxHTML = "";
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
    const steps = [
      { key: "Pending", label: "Order Placed" },
      { key: "Processing", label: "Processing" },
      { key: "To Ship", label: "To Ship" },
      { key: "To Receive", label: "To Receive" },
      { key: "Delivered", label: "Delivered" },
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
              ${isCompleted ? "✓" : idx + 1}
            </div>
            <div class="step-label">${step.label}</div>
          </div>
        `;
      })
      .join("");

    const linePercent = Math.min(100, Math.max(0, stepIdx * 25));

    trackingBoxHTML = `
      <div class="tracking-box">
        <div class="tracking-header">
          <span style="font-size: 0.9rem; font-weight: 600; color: var(--clr-black);">
            Live Delivery Tracking
          </span>
          <div class="est-delivery">
            🚚 Estimated Delivery: <strong>${estDeliveryText}</strong>
          </div>
        </div>

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
      <button type="button" class="btn-cancel-order" disabled title="Orders in ${normStatus} status cannot be cancelled">
        Cancel Disabled (${normStatus})
      </button>
    `;
  }

  card.innerHTML = `
    <div class="order-card-header">
      <div class="order-meta">
        <span class="order-id">Order #${orderId}</span>
        <span class="order-date">Placed on ${formattedDate}</span>
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
        <span>Payment Method:</span>
        <strong style="color: var(--clr-black);">${paymentMethod}</strong>
      </div>

      <div class="order-total-box">
        <span class="total-label">Total Amount:</span>
        <span class="total-amount">₱${totalAmountFormatted}</span>
      </div>

      ${cancelButtonHTML}
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

    // Execute Atomic Firestore Transaction with stock rollback
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
