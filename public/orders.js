import {
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  auth,
  signUpUser,
  signInUser,
  signInWithGoogle,
  sendPasswordReset,
  validatePasswordStrength,
} from "./authService.js";
import { initAuthModalController } from "./authModalController.js";
import { showToast, showConfirmModal } from "./uiFeedback.js";

import {
  subscribeToUserOrders,
  cancelOrderAtomic,
  normalizeOrderStatus,
  getOrderCanonicalStatus,
  classifyOrderScope,
  isOrderFullyResolved,
  getRiderName,
  isOrderCancellable,
  getTrackingStepIndex,
  calculateEstimatedDelivery,
  formatOrderDate,
  completeCustomerOrder,
} from "./orderService.js";

import { ensureAuth, subscribeToCart, parsePrice, updateCartItemQuantity, removeCartItem, renderCartDrawerComponent } from "./cartService.js";
import {
  sendChatMessage,
  subscribeToMessages,
  subscribeToUserSupportMessages,
  markUserSupportMessagesAsRead,
  uploadChatAttachment,
  unsendChatMessage,
  showMessengerUnsendModal,
} from "./chatService.js";

import {
  renderPagination,
  getURLQueryParam,
  updateURLQueryParam,
} from "./paginationService.js";
import { openPaymongoQrModal } from "./paymongoController.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import {
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { db } from "./orderService.js";

const storage = getStorage();

// Global State
let currentUser = null;
let allOrders = [];
let activeTabStatus = "all";
let orderSearchQuery = "";
let pendingCancelOrderId = null;
let ordersUnsubscribe = null;
let cartUnsubscribe = null;
let chatUnsubscribe = null;
let liveChatController = null;
let ordersCurrentPage = getURLParam("page", 1);
let ordersPerPage = getURLParam("perPage", 5);
let transCurrentPage = getURLParam("transPage", 1);
let transPerPage = getURLParam("transPerPage", 5);

function getURLParam(key, defaultVal) {
  const params = new URLSearchParams(window.location.search);
  const val = params.get(key);
  return val !== null ? (isNaN(val) ? val : parseInt(val, 10)) : defaultVal;
}

function updateURLParams(paramsObj) {
  const url = new URL(window.location.href);
  Object.keys(paramsObj).forEach((key) => {
    url.searchParams.set(key, paramsObj[key]);
  });
  window.history.replaceState({}, "", url.toString());
}

function updateAuthNavVisibility(user) {
  const cartBtn = document.getElementById("cart-toggle-btn");
  const myOrdersLinks = document.querySelectorAll(".nav-my-orders-link, a[href='orders.html']");

  if (cartBtn) {
    cartBtn.style.display = user ? "inline-flex" : "none";
  }
  myOrdersLinks.forEach((link) => {
    if (link.closest(".nav-links")) {
      link.style.display = user ? "inline-block" : "none";
    }
  });
}

function generateSmartPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, "...", totalPages];
  }
  if (currentPage >= totalPages - 2) {
    return [1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
}

function isCashPaymentMethod(method) {
  const m = String(method || "").toLowerCase();
  return m.includes("walk_in") || m.includes("cash") || m.includes("counter");
}

function formatPaymentMethodLabel(orderOrMethod) {
  const method = typeof orderOrMethod === "string"
    ? orderOrMethod
    : (orderOrMethod?.paymentMethod || orderOrMethod?.paymentType || orderOrMethod?.paymentDetails?.method || "");
  const m = String(method).toLowerCase();
  if (m.includes("walk_in") || m.includes("cash") || m.includes("counter")) {
    return "Walk-in Workshop Cash (Counter)";
  }
  if (m.includes("qrph") || m.includes("qr_ph") || m.includes("paymongo")) {
    return "QR Ph (PayMongo)";
  }
  if (m.includes("card") || m.includes("credit") || m.includes("debit")) {
    return "Credit / Debit Card";
  }
  if (m.includes("gcash")) {
    return "GCash";
  }
  if (m.includes("maya")) {
    return "Maya";
  }
  if (method) {
    return method;
  }
  return "QR Ph (PayMongo)";
}



document.addEventListener("DOMContentLoaded", async () => {
  initAuthModalController();
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

  // Initialize Authentication Session & Real-time Listeners
  liveChatController = setupLiveChatWidget();

  // Listen to Auth Changes (Single Canonical Auth Listener)
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateAuthUi(user);
    updateAuthNavVisibility(user);
    if (user) {
      setupOrdersSubscription(user.uid);
      setupCartSubscription(user.uid);
      liveChatController?.initUserChat(user);
    } else {
      window.location.href = "index.html?auth=required";
    }
  });

  // 4. Setup Tab Listeners
  setupTabListeners();

  // 4b. Setup Search Listener
  setupOrderSearchListener();

  // 5. Setup Order Cancellation Modal Listeners
  setupModalListeners();
});

function setupHeaderAndAuthUI() {
  const cartBtn = document.getElementById("cart-toggle-btn");
  const cartOverlay = document.getElementById("cart-drawer-overlay");
  const closeCartBtn = document.getElementById("close-cart-btn");

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

  // Customer Auth Modal and Sign Out are centrally handled by initAuthModalController()
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
  renderCartDrawerComponent({
    items: items,
    onUpdateQty: async (id, newQty) => {
      if (newQty > 0) {
        await updateCartItemQuantity(currentUser?.uid, id, newQty);
      } else {
        await removeCartItem(currentUser?.uid, id);
      }
    },
    onRemoveItem: async (id) => {
      await removeCartItem(currentUser?.uid, id);
    },
  });
}

let currentSubscribedUserId = null;
let previousOrderStatuses = new Map();
let isInitialOrderLoad = true;

function setupOrdersSubscription(userId) {
  if (currentSubscribedUserId === userId && ordersUnsubscribe) return;

  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }

  currentSubscribedUserId = userId;
  previousOrderStatuses.clear();
  isInitialOrderLoad = true;

  if (!userId) return;

  ordersUnsubscribe = subscribeToUserOrders(userId, (orders) => {
    // Detect real-time status transitions and notify the customer immediately
    if (!isInitialOrderLoad && Array.isArray(orders)) {
      orders.forEach((o) => {
        const oId = o.id || o.orderId;
        const currentSt = getOrderCanonicalStatus(o);
        const prevSt = previousOrderStatuses.get(oId);
        if (prevSt && prevSt !== currentSt) {
          const shortId = (o.orderId || o.id || "").slice(0, 8);
          const notifMsg = `Order #${shortId} status updated: ${currentSt}!`;
          showToast(notifMsg, "info", 8000);

          if ("Notification" in window && Notification.permission === "granted") {
            try {
              new Notification(`Order #${shortId} Update 📦`, {
                body: `Your order status is now ${currentSt}. Tap to view details.`,
                icon: "assets/logo.png",
              });
            } catch (_) {}
          }
        }
      });
    }

    if (Array.isArray(orders)) {
      orders.forEach((o) => {
        previousOrderStatuses.set(o.id || o.orderId, getOrderCanonicalStatus(o));
      });
    }
    isInitialOrderLoad = false;

    allOrders = orders;
    updateTabBadges(orders);
    renderOrdersList();
    renderCustomerTransactionsList(orders);
    liveChatController?.renderChannelBar?.();
  });
}

function updateTabBadges(orders) {
  const allList = orders || [];
  const activeOrders = allList.filter((o) => classifyOrderScope(o) === "active");
  const counts = {
    all: activeOrders.length,
    placed: 0,
    inProduction: 0,
    shipped: 0,
    delivered: 0,
    completed: 0,
    cancelled: 0,
  };

  activeOrders.forEach((o) => {
    const st = getOrderCanonicalStatus(o);
    const rawSt = String(o.status || "").toLowerCase();
    const rawOrdSt = String(o.orderStatus || "").toLowerCase();

    if (st === "Delivered" || rawSt === "delivered" || rawOrdSt === "delivered") {
      counts.delivered++;
    } else if (st === "Placed" || st === "Slot Reserved" || st === "Deposit Verified" || st === "Downpayment Confirmed") {
      counts.placed++;
    } else if (st === "In Production" || st === "Quality Checked") {
      counts.inProduction++;
    } else if (st === "Shipped") {
      counts.shipped++;
    }
  });

  allList.forEach((o) => {
    const st = getOrderCanonicalStatus(o);
    const rawSt = String(o.status || "").toLowerCase();
    const rawOrdSt = String(o.orderStatus || "").toLowerCase();

    if (st === "Cancelled" || rawSt === "cancelled" || rawSt === "canceled" || rawOrdSt === "cancelled" || rawOrdSt === "canceled") {
      counts.cancelled++;
    } else if (st === "Completed" || rawSt === "completed" || rawOrdSt === "completed" || o.orderReceived === true) {
      counts.completed++;
    }
  });

  if (document.getElementById("badge-all")) document.getElementById("badge-all").textContent = counts.all;
  if (document.getElementById("badge-placed")) document.getElementById("badge-placed").textContent = counts.placed;
  if (document.getElementById("badge-in-production")) document.getElementById("badge-in-production").textContent = counts.inProduction;
  if (document.getElementById("badge-shipped")) document.getElementById("badge-shipped").textContent = counts.shipped;
  if (document.getElementById("badge-delivered")) document.getElementById("badge-delivered").textContent = counts.delivered;
  if (document.getElementById("badge-completed")) document.getElementById("badge-completed").textContent = counts.completed;
  if (document.getElementById("badge-cancelled")) document.getElementById("badge-cancelled").textContent = counts.cancelled;
}

function switchMainCategoryTab(targetTab) {
  const btnOrders = document.getElementById("tab-nav-orders");
  const btnTransactions = document.getElementById("tab-nav-transactions");
  const secOrders = document.getElementById("section-orders-view");
  const secTransactions = document.getElementById("section-transactions-view");

  if (!btnOrders || !btnTransactions || !secOrders || !secTransactions) return;

  if (targetTab === "transactions" || targetTab === "history" || targetTab === "payment") {
    btnTransactions.classList.add("active");
    btnTransactions.style.borderBottom = "3px solid var(--clr-yellow)";
    btnTransactions.style.color = "var(--clr-black)";
    btnOrders.classList.remove("active");
    btnOrders.style.borderBottom = "none";
    btnOrders.style.color = "var(--clr-text-muted)";
    secTransactions.style.display = "block";
    secOrders.style.display = "none";
    renderCustomerTransactionsList(allOrders);
  } else {
    btnOrders.classList.add("active");
    btnOrders.style.borderBottom = "3px solid var(--clr-yellow)";
    btnOrders.style.color = "var(--clr-black)";
    btnTransactions.classList.remove("active");
    btnTransactions.style.borderBottom = "none";
    btnTransactions.style.color = "var(--clr-text-muted)";
    secOrders.style.display = "block";
    secTransactions.style.display = "none";
    renderOrdersList();
  }
}

function setupTabListeners() {
  const btnOrders = document.getElementById("tab-nav-orders");
  const btnTransactions = document.getElementById("tab-nav-transactions");

  if (btnOrders && btnTransactions) {
    btnOrders.addEventListener("click", () => switchMainCategoryTab("orders"));
    btnTransactions.addEventListener("click", () => switchMainCategoryTab("transactions"));
  }

  const tabsContainer = document.getElementById("orders-status-tabs");
  if (tabsContainer) {
    tabsContainer.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        tabsContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeTabStatus = btn.getAttribute("data-status") || "all";
        ordersCurrentPage = 1;
        renderOrdersList();
      });
    });
  }

  // Handle URL query parameters (e.g. orders.html?tab=transactions or orders.html?status=cancelled)
  const urlTab = (getURLParam("tab", "") || getURLParam("view", "")).toLowerCase();
  const urlStatus = (getURLParam("status", "") || getURLParam("filter", "")).toLowerCase();

  if (urlTab === "transactions" || urlTab === "history" || urlTab === "payment") {
    switchMainCategoryTab("transactions");
  } else if (urlStatus) {
    if (urlStatus === "cancelled") {
      const cancelBtn = document.querySelector(`.tab-btn[data-status="cancelled"]`);
      if (cancelBtn && tabsContainer) {
        tabsContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        cancelBtn.classList.add("active");
        activeTabStatus = "cancelled";
      }
    } else {
      const targetBtn = document.querySelector(`.tab-btn[data-status="${urlStatus}"]`);
      if (targetBtn && tabsContainer) {
        tabsContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        targetBtn.classList.add("active");
        activeTabStatus = urlStatus;
      }
    }
    switchMainCategoryTab("orders");
  }
}

function renderCustomerTransactionsList(orders) {
  const container = document.getElementById("transactions-list-container");
  if (!container) return;

  const historyOrders = (orders || []).filter((o) => classifyOrderScope(o) === "history");

  if (!historyOrders || historyOrders.length === 0) {
    container.innerHTML = `
      <div class="orders-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="5" width="20" height="14" rx="2"></rect>
          <line x1="2" y1="10" x2="22" y2="10"></line>
        </svg>
        <h3 class="empty-title">No transactions recorded</h3>
        <p class="empty-desc">Your payment transaction records and receipts will appear here once you place an order.</p>
      </div>
    `;
    return;
  }

  const totalItems = historyOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / transPerPage));
  if (transCurrentPage > totalPages) transCurrentPage = totalPages;
  if (transCurrentPage < 1) transCurrentPage = 1;

  const startIndex = (transCurrentPage - 1) * transPerPage;
  const pagedOrders = historyOrders.slice(startIndex, startIndex + transPerPage);

  container.innerHTML = "";

  pagedOrders.forEach((order) => {
    const isCompletedOrder =
      order.status === "completed" ||
      order.orderStatus === "completed" ||
      order.orderReceived === true ||
      Boolean(order.completedAt) ||
      Boolean(order.orderReceivedAt);

    const balStatusLower = String(order.balanceStatus || "").trim().toLowerCase();
    const isBalanceSettled =
      balStatusLower === "settled" ||
      order.isBalanceSettled === true ||
      order.balanceSettled === true ||
      (Number(order.outstandingBalance) === 0 && order.balanceStatus !== undefined) ||
      (Number(order.remainingBalance) === 0 && order.balanceStatus !== undefined) ||
      isCompletedOrder;

    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || order.paymentMethod === "walk_in_cash";
    const isPaidDownpayment =
      order.paymentStatus === "downpayment_paid" ||
      order.paymentStatus === "Paid" ||
      order.paymentStatus === "paid" ||
      Boolean(order.paymentDetails?.downpaymentPaid);

    const totalVal = Number(order.totalAmount || order.total || 0);
    const downpaymentDueAmount = Math.round(totalVal * 0.30);

    const paidVal = isBalanceSettled
      ? totalVal
      : isPaidDownpayment
        ? Number(order.downpaymentAmount || (isDownpayment ? downpaymentDueAmount : totalVal))
        : 0;
    const remainingVal = isBalanceSettled
      ? 0
      : isPaidDownpayment
        ? Math.max(0, totalVal - paidVal)
        : totalVal;

    const isWalkInPending =
      (order.paymentMethod === "walk_in_cash" || order.paymentType === "walk_in_cash") &&
      order.paymentStatus === "awaiting_counter_downpayment";

    const isCash = isCashPaymentMethod(order.paymentMethod || order.paymentType);
    const methodBadge = isCash ? "Cash / Counter" : "PayMongo";

    const payStatus = isCompletedOrder
      ? "Completed · Order Received"
      : isBalanceSettled
        ? `Balance Settled (${methodBadge})`
        : isPaidDownpayment
          ? (isDownpayment ? `Downpayment Paid (${methodBadge})` : `Paid in Full (${methodBadge})`)
          : isWalkInPending
            ? "Counter Downpayment Pending"
            : (isDownpayment ? "Downpayment Pending" : "Payment Pending");
    const pMethod = formatPaymentMethodLabel(order);
    const refNum = order.orderId || order.id || "N/A";
    const dateStr = formatOrderDate(order.createdAt || order.timestamp);
    const itemsSummary = (order.items || [])
      .map((it) => `${it.name || it.title || "Custom Furniture"} × ${it.quantity || 1}`)
      .join(", ") || "Custom Handcrafted Furniture";

    const card = document.createElement("div");
    card.className = "order-card";
    card.style.cssText = "background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);";
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
        <div>
          <span style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600;">Transaction Reference</span>
          <h4 style="margin: 2px 0 0; font-size: 1.05rem; font-weight: 700; color: #0f172a;">${escapeHtml(refNum)}</h4>
          <span style="font-size: 0.8rem; color: #94a3b8;">Issued on ${escapeHtml(dateStr)}</span>
          <div style="font-size: 0.82rem; color: #475569; font-weight: 500; margin-top: 4px;">📦 ${escapeHtml(itemsSummary)}</div>
        </div>
        <div style="text-align: right;">
          <span class="status-badge" style="background: ${isCompletedOrder || isBalanceSettled ? '#ecfdf5' : isPaidDownpayment ? '#eff6ff' : isWalkInPending ? '#fffbeb' : '#fef2f2'}; color: ${isCompletedOrder || isBalanceSettled ? '#059669' : isPaidDownpayment ? '#1d4ed8' : isWalkInPending ? '#b45309' : '#dc2626'}; border: 1px solid ${isCompletedOrder || isBalanceSettled ? '#a7f3d0' : isPaidDownpayment ? '#bfdbfe' : isWalkInPending ? '#fde68a' : '#fecaca'}; font-weight: 700; padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">
            ${isCompletedOrder || isBalanceSettled ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}${escapeHtml(payStatus)}
          </span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; background: #f8fafc; padding: 14px 16px; border-radius: 8px;">
        <div>
          <span style="font-size: 0.78rem; color: #64748b; display: block;">Payment Method</span>
          <strong style="font-size: 0.92rem; color: #0f172a;">💳 ${escapeHtml(pMethod)}</strong>
        </div>
        <div>
          <span style="font-size: 0.78rem; color: #64748b; display: block;">Payment Terms</span>
          <strong style="font-size: 0.92rem; color: #0f172a;">${isDownpayment ? (isBalanceSettled ? '30% Downpayment (Balance Settled)' : '30% Downpayment Deposit') : 'Full Payment'}</strong>
        </div>
        <div>
          <span style="font-size: 0.78rem; color: #64748b; display: block;">Amount Paid</span>
          <strong style="font-size: 1rem; color: #059669;">₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </div>
        <div>
          <span style="font-size: 0.78rem; color: #64748b; display: block;">Outstanding Balance</span>
          <strong style="font-size: 1rem; color: ${remainingVal > 0 ? '#dc2626' : '#059669'};">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #f1f5f9; flex-wrap: wrap;">
        <button type="button" class="btn-trans-quotation" data-order-id="${escapeHtml(refNum)}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; background: #ffffff; color: #0284c7; font-weight: 700; font-size: 0.8rem; border: 1.5px solid #0284c7; cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M12 2v4"></path><path d="M16 2v4"></path><rect width="16" height="18" x="4" y="4" rx="2"></rect><path d="M8 10h6"></path><path d="M8 14h8"></path><path d="M8 18h5"></path></svg>
          <span>OFFICIAL QUOTATION</span>
        </button>
        <button type="button" class="btn-download-receipt btn-trans-receipt" data-order-id="${escapeHtml(refNum)}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 6px; background: #0284c7; color: #ffffff; font-weight: 700; font-size: 0.8rem; border: none; cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          <span>DOWNLOAD OFFICIAL RECEIPT</span>
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  // Bind transaction document buttons
  container.querySelectorAll(".btn-trans-receipt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetRef = btn.getAttribute("data-order-id");
      const matchedOrder = (historyOrders || []).find((o) => (o.orderId || o.id) === targetRef);
      if (matchedOrder) {
        openLanicaCustomerReceiptModal(matchedOrder, "voucher");
      }
    });
  });

  container.querySelectorAll(".btn-trans-quotation").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetRef = btn.getAttribute("data-order-id");
      const matchedOrder = (historyOrders || []).find((o) => (o.orderId || o.id) === targetRef);
      if (matchedOrder) {
        openLanicaCustomerReceiptModal(matchedOrder, "quotation");
      }
    });
  });

  renderPagination({
    container,
    currentPage: transCurrentPage,
    totalPages,
    totalItems,
    pageSize: transPerPage,
    pageSizeOptions: [5, 10, 20],
    urlParamPrefix: "trans",
    onPageChange: (newPage) => {
      transCurrentPage = newPage;
      renderCustomerTransactionsList(orders);
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onPageSizeChange: (newSize) => {
      transPerPage = newSize;
      transCurrentPage = 1;
      renderCustomerTransactionsList(orders);
    },
  });
}

function matchesOrderSearch(order, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;

  // 1. Order ID
  if (order.id && order.id.toLowerCase().includes(q)) return true;

  // 2. Customer / Recipient Name & Contact
  const recipient = (
    order.shippingAddress?.recipientName ||
    order.recipientName ||
    order.customerName ||
    order.userName ||
    order.userEmail ||
    ""
  ).toLowerCase();
  if (recipient.includes(q)) return true;

  // 3. Product Title / Item Names & Materials
  if (Array.isArray(order.items)) {
    const hasItem = order.items.some((item) => {
      const title = (item.name || item.title || item.productTitle || "").toLowerCase();
      const material = (item.material || "").toLowerCase();
      return title.includes(q) || material.includes(q);
    });
    if (hasItem) return true;
  }

  // 4. Order Status (raw and canonical display)
  const rawStatus = (order.status || "").toLowerCase();
  const canonicalStatus = (getOrderCanonicalStatus(order) || "").toLowerCase();
  if (rawStatus.includes(q) || canonicalStatus.includes(q)) return true;

  return false;
}

function setupOrderSearchListener() {
  const searchInput = document.getElementById("orders-search-input");
  const clearBtn = document.getElementById("orders-search-clear");
  if (!searchInput) return;

  let debounceTimer = null;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const val = e.target.value;
    if (clearBtn) {
      clearBtn.style.display = val.trim().length > 0 ? "flex" : "none";
    }
    debounceTimer = setTimeout(() => {
      orderSearchQuery = val;
      ordersCurrentPage = 1;
      renderOrdersList();
    }, 250);
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearBtn.style.display = "none";
      orderSearchQuery = "";
      ordersCurrentPage = 1;
      searchInput.focus();
      renderOrdersList();
    });
  }
}

function filterOrdersByTab(orders, tabStatus) {
  const allList = orders || [];
  const activeOrders = allList.filter((o) => classifyOrderScope(o) === "active");

  if (tabStatus === "all") {
    return activeOrders;
  }

  if (tabStatus === "completed") {
    return allList.filter((o) => {
      const st = getOrderCanonicalStatus(o);
      const rawSt = String(o.status || "").toLowerCase();
      const rawOrdSt = String(o.orderStatus || "").toLowerCase();
      return st === "Completed" || rawSt === "completed" || rawOrdSt === "completed" || o.orderReceived === true;
    });
  }

  if (tabStatus === "cancelled") {
    return allList.filter((o) => {
      const st = getOrderCanonicalStatus(o);
      const rawSt = String(o.status || "").toLowerCase();
      const rawOrdSt = String(o.orderStatus || "").toLowerCase();
      return st === "Cancelled" || rawSt === "cancelled" || rawSt === "canceled" || rawOrdSt === "cancelled" || rawOrdSt === "canceled";
    });
  }

  return activeOrders.filter((o) => {
    const st = getOrderCanonicalStatus(o);
    const rawSt = String(o.status || "").toLowerCase();
    const rawOrdSt = String(o.orderStatus || "").toLowerCase();

    if (tabStatus === "placed") return st === "Placed" || st === "Slot Reserved" || st === "Deposit Verified" || st === "Downpayment Confirmed";
    if (tabStatus === "in-production") return st === "In Production" || st === "Quality Checked";
    if (tabStatus === "shipped") return st === "Shipped";
    if (tabStatus === "delivered") return st === "Delivered" || rawSt === "delivered" || rawOrdSt === "delivered";
    return true;
  });
}

function renderOrdersList() {
  const container = document.getElementById("orders-list-container");
  if (!container) return;

  const tabFiltered = filterOrdersByTab(allOrders || [], activeTabStatus);
  const filteredOrders = tabFiltered.filter((o) => matchesOrderSearch(o, orderSearchQuery));

  if (filteredOrders.length === 0) {
    const isSearching = !!orderSearchQuery.trim();
    const hasHistoryOrders = (allOrders || []).some((o) => classifyOrderScope(o) === "history");

    container.innerHTML = `
      <div class="orders-empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <h3 class="empty-title">${isSearching ? "No matching orders found" : "No orders found"}</h3>
        <p class="empty-desc">${
          isSearching
            ? `No orders match your search "${escapeHtml(orderSearchQuery)}" in the ${getTabDisplayName(activeTabStatus)} filter.`
            : `You don't have any orders matching the "${getTabDisplayName(activeTabStatus)}" filter.`
        }</p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 14px;">
          ${
            isSearching
              ? `<button type="button" id="btn-reset-order-search" class="btn-secondary" style="display: inline-block; cursor: pointer; padding: 10px 20px;">Clear Search</button>`
              : `<a href="index.html#collections" class="btn-secondary" style="display: inline-block;">Browse Furniture Catalog</a>`
          }
          ${
            !isSearching && hasHistoryOrders && activeTabStatus === "all"
              ? `<button type="button" id="btn-empty-goto-history" class="btn-primary" style="display: inline-block; cursor: pointer; padding: 10px 20px;">View Transaction History</button>`
              : ""
          }
        </div>
      </div>
    `;

    const resetBtn = container.querySelector("#btn-reset-order-search");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const input = document.getElementById("orders-search-input");
        const clearBtn = document.getElementById("orders-search-clear");
        if (input) input.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        orderSearchQuery = "";
        ordersCurrentPage = 1;
        renderOrdersList();
      });
    }

    const historyBtn = container.querySelector("#btn-empty-goto-history");
    if (historyBtn) {
      historyBtn.addEventListener("click", () => {
        switchMainCategoryTab("transactions");
      });
    }
    return;
  }

  const totalItems = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ordersPerPage));
  if (ordersCurrentPage > totalPages) ordersCurrentPage = totalPages;
  if (ordersCurrentPage < 1) ordersCurrentPage = 1;

  const startIndex = (ordersCurrentPage - 1) * ordersPerPage;
  const pagedOrders = filteredOrders.slice(startIndex, startIndex + ordersPerPage);

  container.innerHTML = "";

  pagedOrders.forEach((order) => {
    const card = createOrderCardElement(order);
    container.appendChild(card);
  });

  // Render standardized enterprise pagination footer
  renderPagination({
    container,
    currentPage: ordersCurrentPage,
    totalPages,
    totalItems,
    pageSize: ordersPerPage,
    pageSizeOptions: [5, 10, 20, 50],
    urlParamPrefix: "orders",
    onPageChange: (newPage) => {
      ordersCurrentPage = newPage;
      renderOrdersList();
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    onPageSizeChange: (newSize) => {
      ordersPerPage = newSize;
      ordersCurrentPage = 1;
      renderOrdersList();
    },
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
      if (orderId && liveChatController && liveChatController.openOrderChat) {
        liveChatController.openOrderChat(orderId);
      }
    });
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
    case "completed":
      return "Completed";
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
          <img src="${imgUrl}" alt="${escapeHtml(item.name)}" class="item-thumb" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
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

    if (normStatus === "Placed" || normStatus === "Slot Reserved") {
      const isReserved = normStatus === "Slot Reserved" || order.paymentStatus === "awaiting_counter_downpayment";
      heroIconSVG = isReserved
        ? `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`
        : `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`;
      heroSubtitle = isReserved
        ? "Crafting slot reserved! Please settle 30% downpayment at our workshop counter within 48 hours to start crafting."
        : "Order placed! Our workshop team is reviewing your custom order details.";
    } else if (normStatus === "Deposit Verified" || normStatus === "Downpayment Confirmed") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`;
      heroSubtitle = "30% Downpayment verified! Timber and materials are allocated for production.";
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
      heroSubtitle = "Your handcrafted Lanica furniture has arrived safely! Please inspect and tap Order Received below.";
    } else if (normStatus === "Completed") {
      heroIconSVG = `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
      heroSubtitle = "Order completed! Handcrafted furniture received by customer. Enjoy your furniture!";
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
          <div class="est-delivery-date" style="display:flex; align-items:center; gap:4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span>${estDeliveryText}</span></div>
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
        key: "Deposit Verified",
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

  // Payment Breakdown - Dynamic based on PayMongo verification (no static/mock values)
  const totalVal = Number(order.totalAmount ?? order.total ?? 0);
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || order.paymentMethod === "walk_in_cash";
  const isPaidDownpayment =
    order.paymentStatus === "downpayment_paid" ||
    order.paymentStatus === "Paid" ||
    order.paymentStatus === "paid" ||
    Boolean(order.paymentDetails?.downpaymentPaid);

  const isWalkInPending =
    (order.paymentMethod === "walk_in_cash" || order.paymentType === "walk_in_cash") &&
    order.paymentStatus === "awaiting_counter_downpayment";

  const balStatusLower = String(order.balanceStatus || "").trim().toLowerCase();
  const rawSt = String(order.status || "").toLowerCase();
  const rawOrdSt = String(order.orderStatus || "").toLowerCase();
  const isCompleted = normStatus === "Completed" || rawSt === "completed" || rawOrdSt === "completed" || order.orderReceived === true;
  const isDelivered = (normStatus === "Delivered" || rawSt === "delivered" || rawOrdSt === "delivered") && !isCompleted;

  const isBalanceSettled =
    balStatusLower === "settled" ||
    order.isBalanceSettled === true ||
    order.balanceSettled === true ||
    (Number(order.outstandingBalance) === 0 && order.balanceStatus !== undefined) ||
    (Number(order.remainingBalance) === 0 && order.balanceStatus !== undefined) ||
    isCompleted;

  const downpaymentDueAmount = Math.round(totalVal * 0.30);
  const paidVal = isBalanceSettled
    ? totalVal
    : isPaidDownpayment
      ? Number(order.downpaymentAmount || (isDownpayment ? downpaymentDueAmount : totalVal))
      : 0;
  const remainingVal = isBalanceSettled
    ? 0
    : isPaidDownpayment
      ? Math.max(0, totalVal - paidVal)
      : totalVal;

  const hasUnpaidDeliveryBalance = isDelivered && !isBalanceSettled && remainingVal > 0;

  let deadlineStr = "48 Hours from reservation";
  if (order.reservationExpiresAt) {
    deadlineStr = formatOrderDate(order.reservationExpiresAt);
  } else if (order.createdAt) {
    const createdMs = order.createdAt?.toDate ? order.createdAt.toDate().getTime() : (order.createdAt?.seconds ? order.createdAt.seconds * 1000 : Date.now());
    deadlineStr = formatOrderDate(new Date(createdMs + 48 * 60 * 60 * 1000));
  }

  const orderBranchKey = order._selectedBranch || order.selectedBranch || order.branch || "calamba";
  const branchData = LANICA_BRANCHES[orderBranchKey] || LANICA_BRANCHES.calamba;

  let paymentDetailsHTML = "";
  if (isDownpayment) {
    const isCashMethod = isCashPaymentMethod(order.paymentMethod || order.paymentType);
    const paidViaText = isCashMethod ? "Workshop Cash / Counter" : (order.paymentMethod || "PayMongo QR Ph");
    const dpPercent = totalVal > 0 && paidVal > 0 ? Math.round((paidVal / totalVal) * 100) : 30;

    paymentDetailsHTML = `
      <div class="payment-terms-box" style="margin-top: 8px; font-size: 0.82rem; background: #f8fafc; padding: 10px 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span>${dpPercent}% Downpayment:</span>
          ${
            isPaidDownpayment
              ? `<strong style="color: #059669;">✓ ₱${(isBalanceSettled ? Number(order.downpaymentAmount || downpaymentDueAmount) : paidVal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Paid via ${escapeHtml(paidViaText)})</strong>`
              : isWalkInPending
                ? `<strong style="color: #b45309;">⏳ ₱${downpaymentDueAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Counter Downpayment Pending)</strong>`
                : `<strong style="color: #dc2626;">⏳ ₱${downpaymentDueAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Unpaid - Action Required)</strong>`
          }
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span>Remaining Balance Due:</span>
          <strong style="color: ${remainingVal > 0 ? '#d97706' : '#059669'};">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </div>
        ${
          order.paymentIntentId
            ? `<div style="font-size: 0.74rem; color: #64748b; margin-top: 4px; font-family: monospace;">
                PayMongo Ref: ${escapeHtml(order.paymentIntentId)}
               </div>`
            : order.referenceNumber || order.receiptNumber
              ? `<div style="font-size: 0.74rem; color: #64748b; margin-top: 4px; font-family: monospace;">
                  Ref #: ${escapeHtml(order.referenceNumber || order.receiptNumber)}
                 </div>`
              : ""
        }
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #cbd5e1;">
          <span style="font-size: 0.78rem; color: #64748b;">Balance Status:</span>
          <span style="font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 9999px; ${
            isBalanceSettled
              ? 'background: #dcfce7; color: #15803d;'
              : isPaidDownpayment
                ? 'background: #fef3c7; color: #b45309;'
                : isWalkInPending
                  ? 'background: #fef3c7; color: #b45309;'
                  : 'background: #fee2e2; color: #b91c1c;'
          }">
            ${
              isBalanceSettled
                ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:3px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Settled'
                : isPaidDownpayment
                  ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Pending Final Collection'
                  : isWalkInPending
                    ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Counter Downpayment Pending'
                    : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>Downpayment Unpaid'
            }
          </span>
        </div>
        ${
          isWalkInPending
            ? `<div class="walk-in-counter-notice" style="margin-top: 10px; font-size: 0.82rem; background: #fffbeb; border: 1.5px solid #fef08a; padding: 12px 14px; border-radius: 8px; color: #92400e;">
                <div style="font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> <span>Custom Crafting Notice: Settle 30% downpayment at workshop to begin crafting.</span>
                </div>
                <div style="display: grid; gap: 5px; font-size: 0.79rem; line-height: 1.4;">
                  <div><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><strong>Workshop Address:</strong> ${escapeHtml(branchData.title)} — ${escapeHtml(branchData.address)}</div>
                  <div><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg><strong>Contact Hotline:</strong> <a href="tel:${escapeHtml(branchData.contact.replace(/[^\d+]/g, ''))}" style="color: #b45309; font-weight: 700; text-decoration: underline;">${escapeHtml(branchData.contact)}</a></div>
                  <div><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg><strong>48-Hour Reservation Deadline:</strong> ${escapeHtml(deadlineStr)}</div>
                </div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  const shippingAddrObj = order.shippingAddress || order.address || {};
  const landmark = shippingAddrObj.nearestLandmark || order.nearestLandmark || shippingAddrObj.landmark || "";
  const landmarkHTML = landmark
    ? `<div style="font-size:0.8rem; color:#b45309; background:#fffbeb; border:1px solid #fef3c7; padding:6px 10px; border-radius:6px; margin-top:8px; display:flex; align-items:flex-start; gap:4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><span><strong>Landmark / Instructions:</strong> ${escapeHtml(landmark)}</span></div>`
    : "";

  const needsDownpayment =
    (normStatus === "Placed" || normStatus === "Slot Reserved" || isWalkInPending) &&
    order.paymentStatus !== "downpayment_paid" &&
    order.paymentStatus !== "Paid" &&
    order.paymentStatus !== "paid";

  const displayPaymentMethod = formatPaymentMethodLabel(order);

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
          <strong style="color: var(--clr-black);">${escapeHtml(displayPaymentMethod)}</strong>
        </div>
        ${paymentDetailsHTML}
        ${landmarkHTML}
      </div>

      <div class="order-total-box">
        <span class="total-label">Total Contract Price:</span>
        <span class="total-amount">₱${totalAmountFormatted}</span>
      </div>

      ${(() => {
        const hasUnpaidDeliveryBalance = isDelivered && !isBalanceSettled && remainingVal > 0;
        const isVerificationPending = order.balanceStatus === "Pending Admin Verification" || order.balanceStatus === "Verification Pending";

        if (isDelivered && isBalanceSettled) {
          return `
            <div class="delivery-balance-settled-card" style="margin: 14px 0; background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 12px; padding: 14px 16px; box-shadow: 0 2px 8px rgba(5, 150, 105, 0.08); width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; background: #d1fae5; color: #047857; font-weight: 800; font-size: 1rem;">✓</span>
                <div>
                  <strong style="font-size: 0.95rem; color: #065f46; display: block;">Delivery Balance Fully Settled!</strong>
                  <span style="font-size: 0.8rem; color: #047857;">Please inspect your handcrafted furniture and click <strong>"ORDER RECEIVED"</strong> below to complete your order.</span>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-customer-doc-view" data-order-id="${orderId}" data-default-tab="voucher" style="padding: 6px 12px; border-radius: 6px; background: #ffffff; color: #047857; border: 1px solid #a7f3d0; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                  View Receipt
                </button>
                <button type="button" class="btn-customer-doc-view" data-order-id="${orderId}" data-default-tab="quotation" style="padding: 6px 12px; border-radius: 6px; background: #ffffff; color: #0284c7; border: 1px solid #bae6fd; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                  View Quotation
                </button>
              </div>
            </div>
          `;
        }

        if (!hasUnpaidDeliveryBalance) return "";

        return `
          <div class="delivery-balance-due-card" style="margin: 14px 0; background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.08); width: 100%; box-sizing: border-box;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; background: #fef3c7; color: #b45309; font-weight: 800; font-size: 0.85rem;">₱</span>
                  <strong style="font-size: 0.96rem; color: #92400e; text-transform: uppercase; letter-spacing: -0.01em;">Delivery Balance Due</strong>
                </div>
                <div style="font-size: 0.8rem; color: #78350f; margin-top: 4px; line-height: 1.4;">
                  Your handcrafted furniture has arrived! Please settle the outstanding balance below before marking the order as received.
                </div>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 0.72rem; color: #b45309; font-weight: 600; text-transform: uppercase; display: block;">Balance Due:</span>
                <span style="font-size: 1.25rem; font-weight: 900; color: #b45309;">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            ${isVerificationPending ? `
              <div style="margin-top: 12px; padding: 12px 14px; background: #ffffff; border: 1.5px solid #fef08a; border-radius: 10px; display: flex; align-items: flex-start; gap: 10px;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <div style="font-size: 0.82rem; color: #92400e; line-height: 1.4;">
                  <strong>Cash Remittance Proof Submitted — Awaiting Admin Verification</strong><br/>
                  Our workshop administration is reviewing your proof of remittance. The <strong>"ORDER RECEIVED"</strong> button will automatically unlock once verified.
                  ${order.riderCashProofUrl ? `<div style="margin-top: 6px;"><a href="${order.riderCashProofUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 600; font-size: 0.78rem;">View Uploaded Remittance Receipt &rarr;</a></div>` : ""}
                </div>
              </div>
            ` : `
              <div style="margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px;">
                <button type="button" class="btn-pay-balance-qrph" data-order-id="${orderId}" data-balance-amount="${remainingVal}" style="flex: 1; min-width: 220px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 8px; background: #0f172a; color: #FFD700; font-weight: 700; font-size: 0.84rem; border: 1.5px solid #FFD700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.12);">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                  <span>Pay Online via QR Ph</span>
                </button>
                <button type="button" class="btn-toggle-cash-rider-form" data-order-id="${orderId}" style="flex: 1; min-width: 200px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 8px; background: #ffffff; color: #15803d; font-weight: 700; font-size: 0.84rem; border: 1.5px solid #16a34a; cursor: pointer; transition: all 0.2s;">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
                  <span>Pay Cash to Rider (Admin Verified)</span>
                </button>
              </div>

              <!-- Inline Remittance Upload Form -->
              <div class="cash-rider-upload-box" style="display: none; margin-top: 12px; background: #ffffff; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 14px;">
                <div style="font-size: 0.84rem; font-weight: 700; color: #0f172a; margin-bottom: 4px;">Upload Cash Payment / Remittance Receipt</div>
                <div style="font-size: 0.78rem; color: #64748b; margin-bottom: 10px;">Upload a photo of your remittance receipt or signed delivery note given to the rider.</div>
                
                <input type="file" class="input-rider-proof-file" accept="image/*" style="display: none;" />
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                  <button type="button" class="btn-choose-rider-proof" style="padding: 7px 14px; border-radius: 6px; background: #f1f5f9; border: 1px solid #cbd5e1; font-size: 0.82rem; font-weight: 600; cursor: pointer; color: #334155;">📷 Select Receipt Image</button>
                  <span class="rider-proof-filename" style="font-size: 0.8rem; color: #64748b; font-style: italic;">No file selected</span>
                </div>
                <div class="rider-proof-preview-container" style="display: none; margin-top: 10px;">
                  <img class="rider-proof-preview-img" src="" alt="Proof Preview" style="max-height: 120px; border-radius: 6px; border: 1px solid #e2e8f0; object-fit: contain;" />
                </div>
                <div style="margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px;">
                  <button type="button" class="btn-cancel-cash-rider" style="padding: 6px 14px; border: none; background: transparent; font-size: 0.82rem; color: #64748b; cursor: pointer;">Cancel</button>
                  <button type="button" class="btn-submit-rider-proof" data-order-id="${orderId}" style="padding: 7px 16px; border-radius: 6px; background: #16a34a; color: #ffffff; border: none; font-weight: 700; font-size: 0.82rem; cursor: pointer; display: none;">Submit Receipt for Verification</button>
                </div>
              </div>
            `}
          </div>
        `;
      })()}

      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn-chat-order" data-order-id="${orderId}" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 6px; background: var(--clr-primary-light, #f4eee7); color: var(--clr-primary, #6b4423); font-weight: 600; font-size: 0.82rem; border: 1px solid var(--clr-primary, #6b4423); cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>Chat Workshop</span>
        </button>
        <button type="button" class="btn-customer-doc-view" data-order-id="${orderId}" data-default-tab="quotation" style="display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 6px; background: #ffffff; color: #0284c7; font-weight: 600; font-size: 0.82rem; border: 1px solid #bae6fd; cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"></path><path d="M12 2v4"></path><path d="M16 2v4"></path><rect width="16" height="18" x="4" y="4" rx="2"></rect><path d="M8 10h6"></path><path d="M8 14h8"></path><path d="M8 18h5"></path></svg>
          <span>Official Quotation</span>
        </button>
        ${needsDownpayment ? `
        <button type="button" class="btn-pay-downpayment-qr" data-order-id="${orderId}" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border-radius: 6px; background: #121212; color: #FFD700; font-weight: 700; font-size: 0.82rem; border: 1.5px solid #FFD700; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(255, 215, 0, 0.2);">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          <span>${isWalkInPending ? "Pay Online via QR Ph" : `Pay 30% Downpayment (₱${downpaymentDueAmount.toLocaleString()})`}</span>
        </button>
        ` : ""}
        ${(() => {
          const rawSt = String(order.status || "").toLowerCase();
          const rawOrdSt = String(order.orderStatus || "").toLowerCase();
          const isCompleted = normStatus === "Completed" || rawSt === "completed" || rawOrdSt === "completed" || order.orderReceived === true;
          const isDelivered = (normStatus === "Delivered" || rawSt === "delivered" || rawOrdSt === "delivered") && !isCompleted;
          const isBalanceSettled = order.balanceStatus === "Settled" || (order.balanceStatus || "").toLowerCase() === "settled" || (order.outstandingBalance === 0 && order.balanceStatus !== undefined) || remainingVal <= 0;
          const hasUnpaidDeliveryBalance = isDelivered && !isBalanceSettled && remainingVal > 0;

          if (isDelivered) {
            if (hasUnpaidDeliveryBalance) {
              return `
                <div style="display: inline-flex; flex-direction: column; align-items: flex-start;">
                  <button type="button" class="btn-order-received is-disabled" data-order-id="${orderId}" disabled style="opacity: 0.5; cursor: not-allowed; background: #9ca3af; border: 1.5px solid #9ca3af; color: #ffffff;" title="Delivery balance unpaid. Please settle remaining balance first.">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>ORDER RECEIVED</span>
                  </button>
                  <span style="font-size: 0.72rem; color: #b45309; margin-top: 4px; font-weight: 600;">🔒 Settle balance above to unlock</span>
                </div>
              `;
            }
            return `
              <button type="button" class="btn-order-received" data-order-id="${orderId}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span>ORDER RECEIVED</span>
              </button>
            `;
          }
          if (isCompleted) {
            return `
              <button type="button" class="btn-download-receipt" data-order-id="${orderId}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                <span>DOWNLOAD RECEIPT</span>
              </button>
            `;
          }
          return "";
        })()}
        ${cancelButtonHTML}
      </div>
    </div>
  `;

  // Attach Delivery Balance Settlement Handlers
  const balanceQrBtn = card.querySelector(".btn-pay-balance-qrph");
  if (balanceQrBtn) {
    balanceQrBtn.addEventListener("click", () => {
      openPaymongoQrModal({
        orderId: orderId,
        exactAmount: remainingVal,
        isDeliveryBalance: true,
        description: `Remaining Delivery Balance for Order #${orderId}`,
        onSuccess: async (confirmedOrderId) => {
          try {
            await updateDoc(doc(db, "orders", confirmedOrderId), {
              balanceStatus: "Settled",
              outstandingBalance: 0,
              remainingBalance: 0,
              balanceDue: 0,
              balanceSettledAt: serverTimestamp(),
              balanceSettlementMethod: "paymongo_qrph",
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn("Firestore balance update notice:", e);
          }
          showToast(`Delivery balance settled for Order #${confirmedOrderId}! "ORDER RECEIVED" is now unlocked.`, "success");
        },
      });
    });
  }

  const toggleCashFormBtn = card.querySelector(".btn-toggle-cash-rider-form");
  const cashUploadBox = card.querySelector(".cash-rider-upload-box");
  const cancelCashBtn = card.querySelector(".btn-cancel-cash-rider");
  const chooseProofBtn = card.querySelector(".btn-choose-rider-proof");
  const fileInputEl = card.querySelector(".input-rider-proof-file");
  const fileNameEl = card.querySelector(".rider-proof-filename");
  const previewContainer = card.querySelector(".rider-proof-preview-container");
  const previewImg = card.querySelector(".rider-proof-preview-img");
  const submitProofBtn = card.querySelector(".btn-submit-rider-proof");

  if (toggleCashFormBtn && cashUploadBox) {
    toggleCashFormBtn.addEventListener("click", () => {
      cashUploadBox.style.display = cashUploadBox.style.display === "none" ? "block" : "none";
    });
  }

  if (cancelCashBtn && cashUploadBox) {
    cancelCashBtn.addEventListener("click", () => {
      cashUploadBox.style.display = "none";
    });
  }

  if (chooseProofBtn && fileInputEl) {
    chooseProofBtn.addEventListener("click", () => {
      fileInputEl.click();
    });
  }

  if (fileInputEl) {
    fileInputEl.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (fileNameEl) fileNameEl.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          if (previewImg) previewImg.src = loadEvt.target.result;
          if (previewContainer) previewContainer.style.display = "block";
          if (submitProofBtn) submitProofBtn.style.display = "inline-block";
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (submitProofBtn && fileInputEl) {
    submitProofBtn.addEventListener("click", async () => {
      const file = fileInputEl.files?.[0];
      if (!file) {
        showToast("Please select a photo of your remittance receipt.", "warning");
        return;
      }

      submitProofBtn.disabled = true;
      submitProofBtn.textContent = "Uploading...";

      try {
        const safeExt = file.name.split(".").pop() || "jpg";
        const stRef = storageRef(storage, `rider_receipts/${orderId}_${Date.now()}.${safeExt}`);
        const snap = await uploadBytes(stRef, file, { contentType: file.type || "image/jpeg" });
        const downloadUrl = await getDownloadURL(snap.ref);

        await updateDoc(doc(db, "orders", orderId), {
          balanceStatus: "Pending Admin Verification",
          riderCashProofUrl: downloadUrl,
          riderCashRemittedAt: serverTimestamp(),
          riderCashAmount: remainingVal,
          updatedAt: serverTimestamp(),
        });

        showToast("Remittance proof submitted! Our admin will review and verify your payment shortly.", "success");
      } catch (err) {
        console.error("Proof upload failed:", err);
        showToast(err.message || "Could not upload remittance proof. Please try again.", "error");
        submitProofBtn.disabled = false;
        submitProofBtn.textContent = "Submit Receipt for Verification";
      }
    });
  }

  // Customer taps "ORDER RECEIVED" (Spec Section 1 & 2 & 3)
  const receivedBtn = card.querySelector(".btn-order-received");
  if (receivedBtn) {
    receivedBtn.addEventListener("click", async () => {
            const isSettledNow =
        String(order.balanceStatus || "").trim().toLowerCase() === "settled" ||
        order.isBalanceSettled === true ||
        order.balanceSettled === true ||
        (Number(order.outstandingBalance) === 0 && order.balanceStatus !== undefined) ||
        (Number(order.remainingBalance) === 0 && order.balanceStatus !== undefined) ||
        isBalanceSettled ||
        remainingVal <= 0;

      if (!isSettledNow && remainingVal > 0) {
        showToast(`Please settle the remaining balance of ₱${remainingVal.toLocaleString()} before confirming order receipt.`, "warning");
        return;
      }
      const confirmed = await showConfirmModal({
        title: "Confirm Order Receipt",
        message: `Have you received your handcrafted furniture order <strong>#${escapeHtml(orderId)}</strong> in good condition?<br><br>This will mark your order as <strong>COMPLETED</strong> and generate your official <strong>Payment Voucher</strong> and <strong>Official Quotation</strong>.`,
        confirmText: "Yes, Order Received",
        cancelText: "Not Yet",
        isHtml: true,
        icon: "check",
      });
      if (!confirmed) return;

      try {
        receivedBtn.disabled = true;
        receivedBtn.innerHTML = `<span>Finalizing...</span>`;

        // 1. Send Firestore database payload & bot broadcast
        await completeCustomerOrder(orderId, currentUser);

        // 2. Local Notification (Section 3 of Spec)
        // Title: "Order Delivered! 🎉", Body: "Your order #{orderId} has been delivered. Enjoy your furniture!"
        const notifTitle = "Order Delivered! 🎉";
        const notifBody = `Your order #${orderId} has been delivered. Enjoy your furniture!`;

        showToast(`${notifTitle} ${notifBody}`, "success", 7000);

        if ("Notification" in window) {
          if (Notification.permission === "granted") {
            try {
              new Notification(notifTitle, { body: notifBody, icon: "assets/logo.png" });
            } catch (_) {}
          } else if (Notification.permission === "default") {
            Notification.requestPermission().then((perm) => {
              if (perm === "granted") {
                try {
                  new Notification(notifTitle, { body: notifBody, icon: "assets/logo.png" });
                } catch (_) {}
              }
            });
          }
        }

        // 3. Switches UI to Official Receipt View with "DOWNLOAD RECEIPT" feature (Section 3 of Spec)
        const updatedOrder = {
          ...order,
          status: "completed",
          orderStatus: "completed",
          orderReceived: true,
          orderReceivedAt: new Date(),
          completedAt: new Date(),
        };

        // Update local memory so UI immediately transitions to Completed Transactions History
        if (Array.isArray(allOrders)) {
          allOrders = allOrders.map((o) => ((o.id || o.orderId) === orderId ? { ...o, ...updatedOrder } : o));
          updateTabBadges(allOrders);
          renderOrdersList();
          renderCustomerTransactionsList(allOrders);
        }

        // Switch to Completed Transactions History tab immediately
        switchMainCategoryTab("transactions");

        openLanicaCustomerReceiptModal(updatedOrder);
      } catch (err) {
        console.error("Failed to complete order:", err);
        showToast(err.message || "Failed to update order status.", "error");
        receivedBtn.disabled = false;
        receivedBtn.innerHTML = `<span>ORDER RECEIVED</span>`;
      }
    });
  }

  // Customer taps "DOWNLOAD RECEIPT" or doc view
  card.querySelectorAll(".btn-customer-doc-view").forEach((btn) => {
    btn.addEventListener("click", () => {
      const defaultTab = btn.getAttribute("data-default-tab") || "voucher";
      openLanicaCustomerReceiptModal(order, defaultTab);
    });
  });

  const downloadReceiptBtn = card.querySelector(".btn-download-receipt");
  if (downloadReceiptBtn) {
    downloadReceiptBtn.addEventListener("click", () => {
      openLanicaCustomerReceiptModal(order, "voucher");
    });
  }

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
  const menuScreen = document.getElementById("support-menu-screen");
  const chatScreen = document.getElementById("live-chat-screen");
  const openLiveChatBtn = document.getElementById("open-live-chat-btn");
  const backToMenuBtn = document.getElementById("back-to-support-menu-btn");
  const closeButtons = drawer ? drawer.querySelectorAll(".close-support-drawer") : [];
  const channelBar = document.getElementById("customer-chat-channel-bar");
  const form = document.getElementById("chat-input-form") || document.getElementById("chat-send-form");
  const textInput = document.getElementById("chat-text-input");
  const fileInput = document.getElementById("chat-file-input");
  const attachBtn = document.getElementById("chat-attach-btn") || form?.querySelector(".chat-attach-btn");
  const previewBox = document.getElementById("chat-attachment-preview");
  const previewName = document.getElementById("chat-attachment-name") || document.getElementById("chat-preview-filename");
  const cancelAttachBtn = document.getElementById("chat-cancel-attachment") || document.getElementById("chat-cancel-attachment-btn");
  const messagesArea = document.getElementById("chat-messages-area");
  const unreadBadge = document.getElementById("chat-unread-badge");
  const headerTitle = document.getElementById("chat-header-title");
  const headerStatus = document.getElementById("chat-header-status");

  let attachedFile = null;
  let currentChannel = "support"; // "support" | "order"
  let activeChatOrderId = null;
  let supportUnreadUnsubscribe = null;

  function showScreen(screen) {
    if (screen === "chat") {
      menuScreen?.classList.remove("active");
      chatScreen?.classList.add("active");
    } else {
      chatScreen?.classList.remove("active");
      menuScreen?.classList.add("active");
    }
  }

  if (launcher && drawer) {
    launcher.addEventListener("click", () => {
      const isOpening = !drawer.classList.contains("active");
      drawer.classList.toggle("active");
      if (isOpening) {
        if (unreadBadge) unreadBadge.style.display = "none";
        if (!chatScreen?.classList.contains("active")) {
          showScreen("menu");
        } else {
          setTimeout(() => {
            textInput?.focus();
            scrollChatToBottom();
          }, 100);
        }
      }
    });
  }

  closeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      drawer?.classList.remove("active");
    });
  });

  if (openLiveChatBtn) {
    openLiveChatBtn.addEventListener("click", () => {
      showScreen("chat");
      switchChannel("support");
      setTimeout(() => textInput?.focus(), 150);
    });
  }

  if (backToMenuBtn) {
    backToMenuBtn.addEventListener("click", () => {
      showScreen("menu");
    });
  }

  if (fileInput) {
    if (attachBtn && attachBtn.tagName !== "LABEL") {
      attachBtn.addEventListener("click", () => fileInput.click());
    }
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

  function renderChannelBar() {
    if (!channelBar) return;
    if (!allOrders || allOrders.length === 0) {
      channelBar.style.display = "none";
      return;
    }

    channelBar.style.display = "flex";
    let barHtml = `
      <button type="button" class="chat-channel-pill ${currentChannel === 'support' ? 'active' : ''}" data-channel="support">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Live Support
      </button>
    `;

    allOrders.forEach((o) => {
      const oId = o.id;
      const orderNum = o.orderId || o.id || "";
      const rawNum = String(orderNum);
      const shortNum = rawNum.length > 15 ? (rawNum.startsWith("ORD-") ? "#" + rawNum.slice(0, 14) + "…" : "#" + rawNum.slice(0, 10) + "…") : "#" + rawNum;
      const st = (o.orderStatus || o.status || "").toLowerCase();
      const stTag = st === "delivered" ? " · Delivered" : st === "completed" ? " · Completed" : st === "shipped" ? " · Shipped" : "";
      const isSel = currentChannel === "order" && activeChatOrderId === oId;

      barHtml += `
        <button type="button" class="chat-channel-pill ${isSel ? 'active' : ''}" data-channel="order" data-order-id="${oId}" title="#${escapeHtml(rawNum)} (${escapeHtml(st || 'Active')})">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>${escapeHtml(shortNum)}${stTag ? `<span style="font-size:0.7rem; opacity:0.85; margin-left:3px;">${escapeHtml(stTag)}</span>` : ''}
        </button>
      `;
    });

    channelBar.innerHTML = barHtml;

    if (!channelBar.dataset.dragAttached) {
      channelBar.dataset.dragAttached = "true";
      let isDown = false;
      let startX = 0;
      let scrollLeft = 0;
      let hasDragged = false;

      channelBar.addEventListener("mousedown", (e) => {
        isDown = true;
        hasDragged = false;
        startX = e.pageX - channelBar.offsetLeft;
        scrollLeft = channelBar.scrollLeft;
      });
      channelBar.addEventListener("mouseleave", () => {
        isDown = false;
      });
      channelBar.addEventListener("mouseup", () => {
        isDown = false;
      });
      channelBar.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        const x = e.pageX - channelBar.offsetLeft;
        const walk = (x - startX) * 1.5;
        if (Math.abs(walk) > 4) hasDragged = true;
        channelBar.scrollLeft = scrollLeft - walk;
      });

      channelBar.addEventListener("click", (e) => {
        if (hasDragged) {
          e.preventDefault();
          e.stopPropagation();
          hasDragged = false;
          return;
        }
        const btn = e.target.closest(".chat-channel-pill");
        if (!btn) return;
        const ch = btn.getAttribute("data-channel");
        const oId = btn.getAttribute("data-order-id");
        btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        if (ch === "support") {
          switchChannel("support");
        } else if (oId) {
          switchChannel("order", oId);
        }
      });
    }

    const activePill = channelBar.querySelector(".chat-channel-pill.active");
    if (activePill) {
      setTimeout(() => {
        activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }, 50);
    }
  }

  function parseChatMessageContent(m) {
    if (!m) return { mediaUrl: "", displayText: "" };

    let mediaUrl =
      m.attachmentUrl ||
      m.imageUrl ||
      (m.type === 1 && typeof m.content === "string" ? m.content : "") ||
      "";

    let rawText = m.text || m.message || m.content || "";
    if (typeof rawText !== "string") rawText = "";
    rawText = rawText.trim();

    const isUrl = rawText.startsWith("http://") || rawText.startsWith("https://");
    const isImageTarget =
      isUrl &&
      (/\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i.test(rawText) ||
        rawText.includes("firebasestorage.googleapis.com") ||
        rawText.includes("firebasestorage.app") ||
        rawText.includes("/lanica_chats"));

    if (!mediaUrl && isImageTarget) {
      mediaUrl = rawText;
    }

    let displayText = rawText;
    if (mediaUrl && (displayText === mediaUrl || isImageTarget)) {
      displayText = "";
    }

    return { mediaUrl, displayText };
  }

  let activeCustomerReplyingMessage = null;
  let currentCustomerLoadedMessages = [];

  function setCustomerReplyingMessage(msg) {
    activeCustomerReplyingMessage = msg;
    let previewEl = document.getElementById("customer-chat-reply-preview");
    if (!previewEl && form) {
      previewEl = document.createElement("div");
      previewEl.id = "customer-chat-reply-preview";
      previewEl.className = "customer-chat-reply-preview";
      previewEl.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0; border-left: 3px solid #6b4423; font-size: 0.78rem;";
      form.parentNode.insertBefore(previewEl, form);
    }
    if (!previewEl) return;
    if (!msg) {
      previewEl.style.display = "none";
      return;
    }
    const sender = msg.senderName || (msg.senderRole === "admin" || msg.senderRole === "staff" ? "Lanica Support" : "You");
    const snippet = msg.text || msg.content || (msg.attachmentUrl ? "[Photo]" : "");
    previewEl.innerHTML = `
      <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #6b4423;">Replying to ${escapeHtml(sender)}:</strong>
        <span style="font-style: italic; color: #64748b; margin-left: 4px;">${escapeHtml(snippet)}</span>
      </div>
      <button type="button" style="background: none; border: none; cursor: pointer; color: #94a3b8; font-weight: bold; font-size: 0.85rem;" title="Cancel reply">✕</button>
    `;
    previewEl.style.display = "flex";
    previewEl.querySelector("button").onclick = () => setCustomerReplyingMessage(null);
    if (textInput) textInput.focus();
  }

  function renderCustomerChatAvatarHtml(isSystem, isMe, senderLabel, photoURL, currentUser) {
    if (isSystem) {
      return `<div class="chat-msg-avatar chat-msg-avatar-system" style="width: 32px; height: 32px; border-radius: 50%; background: #fef3c7; color: #b45309; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 700; flex-shrink: 0; border: 1.5px solid #fde68a;" title="Lanica System Notification">🤖</div>`;
    }

    if (isMe) {
      const userPhoto = currentUser?.photoURL || photoURL || "";
      const name = currentUser?.displayName || currentUser?.name || "You";
      const nameParts = name.trim().split(/\s+/);
      const initials = nameParts.length > 1
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : (name.slice(0, 2)).toUpperCase() || "ME";

      if (userPhoto && (userPhoto.startsWith("http://") || userPhoto.startsWith("https://") || userPhoto.startsWith("data:"))) {
        return `
          <div class="chat-msg-avatar chat-msg-avatar-customer" style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #fef08a; border: 1.5px solid #fcd535; position: relative; display: flex; align-items: center; justify-content: center;" title="You">
            <img src="${escapeHtml(userPhoto)}" alt="You" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <span style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: #854d0e; user-select: none;">${escapeHtml(initials)}</span>
          </div>
        `;
      }

      return `
        <div class="chat-msg-avatar chat-msg-avatar-customer" style="width: 32px; height: 32px; border-radius: 50%; background: #fef08a; border: 1.5px solid #fcd535; display: flex; align-items: center; justify-content: center; flex-shrink: 0;" title="You">
          <span style="font-size: 0.72rem; font-weight: 700; color: #854d0e; user-select: none;">${escapeHtml(initials)}</span>
        </div>
      `;
    }

    // Staff / Workshop / Support avatar
    const staffPhoto = photoURL || "assets/lanicalogo.jpg";
    return `
      <div class="chat-msg-avatar chat-msg-avatar-staff" style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #6b4423; border: 1.5px solid #d97706; display: flex; align-items: center; justify-content: center;" title="${escapeHtml(senderLabel)}">
        <img src="${escapeHtml(staffPhoto)}" alt="${escapeHtml(senderLabel)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.src='assets/logo.png';" />
      </div>
    `;
  }

  function renderMessagesList(messages, channelType, orderNum = "") {
    if (!messagesArea) return;
    currentCustomerLoadedMessages = messages || [];

    const welcomeHtml =
      channelType === "support"
        ? `
        <div class="chat-welcome-card">
          <p>👋 <strong>Kumusta!</strong> Welcome to Lanica Live Support. Chat directly with our staff about custom builds, timber stains, finishes, or questions about our AR app!</p>
        </div>
      `
        : `
        <div class="chat-welcome-card">
          <p>🧵 <strong>Order #${orderNum} Crafting Channel:</strong> Message our workshop team about dimensions, lumber finishes, fabric swatches, or crafting updates!</p>
        </div>
      `;

    let html = welcomeHtml;

    if (!messages || messages.length === 0) {
      html += `<div style="text-align: center; color: #9ca3af; font-size: 0.82rem; margin: 30px auto;">No messages in this conversation yet. Say hello to start!</div>`;
    } else {
      messages.forEach((m) => {
        const isSystem =
          Boolean(m.isSystem) ||
          m.senderRole === "system" ||
          m.senderRole === "bot" ||
          m.sender === "system" ||
          m.senderId === "system" ||
          (typeof m.senderName === "string" && (m.senderName.toLowerCase().includes("system") || m.senderName.toLowerCase().includes("bot")));

        const isMe = !isSystem && currentUser && m.senderId === currentUser.uid;
        const roleClass = isSystem ? "system" : isMe ? "customer" : (m.senderRole || "staff");
        const senderLabel = isSystem
          ? (m.senderName || "Lanica System")
          : isMe
            ? "You"
            : (m.senderName || (channelType === "support" ? "Lanica Support" : "Workshop Support"));

        const timeDate = m.timestamp?.toDate
          ? m.timestamp.toDate()
          : (m.createdAt?.toDate ? m.createdAt.toDate() : (m.timestamp || m.createdAt ? new Date(m.timestamp || m.createdAt) : null));
        const timeStr = timeDate ? timeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

        const avatarCol = renderCustomerChatAvatarHtml(isSystem, isMe, senderLabel, m.photoURL || m.senderPhoto || m.senderPhotoURL, currentUser);

        if (m.isUnsent) {
          html += `
            <div class="chat-msg-row ${roleClass}">
              ${avatarCol}
              <div class="chat-msg-content-wrap">
                <span class="chat-msg-sender">${escapeHtml(senderLabel)} ${timeStr ? `• ${timeStr}` : ""}</span>
                <div class="chat-bubble-unsent">
                  ${isMe ? "You unsent a message" : `${escapeHtml(senderLabel)} unsent a message`}
                </div>
              </div>
            </div>
          `;
          return;
        }

        const { mediaUrl, displayText } = parseChatMessageContent(m);

        const quotedHtml = m.replyTo && m.replyTo.text
          ? `
            <div class="chat-quoted-box">
              <span class="chat-quoted-box-sender">Replying to ${escapeHtml(m.replyTo.senderName || "User")}</span>
              <span class="chat-quoted-box-text">${escapeHtml(m.replyTo.text)}</span>
            </div>
          `
          : "";

        html += `
          <div class="chat-msg-row ${roleClass}" data-msg-id="${m.id}">
            ${avatarCol}
            <div class="chat-msg-content-wrap">
              <span class="chat-msg-sender">${escapeHtml(senderLabel)} ${timeStr ? `• ${timeStr}` : ""}</span>
              <div class="chat-bubble-with-actions">
                <div class="chat-msg-bubble ${isSystem ? 'chat-bubble-system' : ''}">
                  ${quotedHtml}
                  ${displayText ? `<p style="margin: 0 0 ${mediaUrl ? '8px' : '0'} 0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(displayText)}</p>` : ""}
                  ${
                    mediaUrl
                      ? `<a href="${mediaUrl}" target="_blank" rel="noopener"><img src="${mediaUrl}" class="chat-msg-img" alt="Attachment" /></a>`
                      : ""
                  }
                </div>
                <div class="chat-msg-actions">
                  <button type="button" class="chat-msg-action-btn reply-btn" data-msg-id="${m.id}" title="Reply">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 9V5L3 12l7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                  </button>
                  ${
                    isMe
                      ? `<button type="button" class="chat-msg-action-btn unsend unsend-btn" data-msg-id="${m.id}" title="More options / Unsend"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    messagesArea.innerHTML = html;

    // Attach click listener for reply & unsend buttons using delegation
    messagesArea.onclick = async (e) => {
      const replyBtn = e.target.closest(".reply-btn");
      if (replyBtn) {
        const msgId = replyBtn.getAttribute("data-msg-id");
        const msg = currentCustomerLoadedMessages.find((x) => x.id === msgId);
        if (msg) setCustomerReplyingMessage(msg);
        return;
      }
      const unsendBtn = e.target.closest(".unsend-btn");
      if (unsendBtn) {
        const msgId = unsendBtn.getAttribute("data-msg-id");
        const res = await showMessengerUnsendModal({ canUnsendForEveryone: true });
        if (!res) return;
        try {
          const target = channelType === "support" ? currentUser.uid : activeChatOrderId;
          await unsendChatMessage({
            targetId: target,
            messageId: msgId,
            isUserSupport: channelType === "support",
            unsendFor: res.unsendFor,
            currentUserId: currentUser ? currentUser.uid : null,
          });
          showToast(res.unsendFor === "everyone" ? "You unsent a message." : "Message removed for you.", "info");
        } catch (err) {
          console.error("Unsend error:", err);
          showToast(err.message || "Failed to unsend message.", "error");
        }
      }
    };

    scrollChatToBottom();
  }

  function switchChannel(channelType, orderId = null) {
    currentChannel = channelType;
    if (channelType === "order") {
      activeChatOrderId = orderId;
    }
    renderChannelBar();

    if (chatUnsubscribe) {
      chatUnsubscribe();
      chatUnsubscribe = null;
    }

    if (channelType === "support") {
      if (headerTitle) headerTitle.textContent = "LANICA SUPPORT";
      if (headerStatus) headerStatus.textContent = "Online · Replies in 5m";

      if (!currentUser) {
        if (messagesArea) {
          messagesArea.innerHTML = `
            <div class="chat-welcome-card">
              <p style="margin: 0 0 8px 0;">👋 <strong>Kumusta!</strong> Welcome to Lanica Live Support.</p>
              <p style="margin: 0 0 12px 0; color: #92400e;">Please sign in to start chatting with our customer care and workshop artisans.</p>
              <button type="button" id="orders-chat-signin-btn" style="padding: 7px 16px; background: #6b4423; color: #fff; border: none; border-radius: 6px; font-size: 0.82rem; cursor: pointer; font-weight: 600;">Sign In Now</button>
            </div>
          `;
          document.getElementById("orders-chat-signin-btn")?.addEventListener("click", () => {
            document.getElementById("auth-modal")?.classList.add("active");
          });
        }
        return;
      }

      markUserSupportMessagesAsRead(currentUser.uid, "customer").catch(() => {});

      chatUnsubscribe = subscribeToUserSupportMessages(currentUser.uid, (messages) => {
        renderMessagesList(messages, "support");
        if (drawer?.classList.contains("active")) {
          markUserSupportMessagesAsRead(currentUser.uid, "customer").catch(() => {});
        }
      });
    } else {
      const matched = allOrders.find((o) => o.id === orderId);
      const orderNum = matched ? (matched.orderId || matched.id) : orderId;
      const statusText = matched ? (matched.orderStatus || matched.status || "In Production") : "Active";

      if (headerTitle) headerTitle.textContent = `ORDER #${orderNum}`;
      if (headerStatus) headerStatus.textContent = `Workshop Thread · ${statusText}`;

      chatUnsubscribe = subscribeToMessages(orderId, (messages) => {
        renderMessagesList(messages, "order", orderNum);
      });
    }
  }

  function initUserChat(user) {
    if (!user) return;
    renderChannelBar();

    if (supportUnreadUnsubscribe) supportUnreadUnsubscribe();
    supportUnreadUnsubscribe = subscribeToUserSupportMessages(user.uid, (messages) => {
      const hasUnread = messages.some((m) => {
        const isFromStaff = m.senderRole === "admin" || m.senderRole === "staff" || m.senderId === "support_admin";
        return isFromStaff && m.isRead === false;
      });

      if (hasUnread && unreadBadge && !drawer?.classList.contains("active")) {
        unreadBadge.style.display = "block";
      }
    });
  }

  function openOrderChat(orderId) {
    if (!orderId) return;
    if (drawer) drawer.classList.add("active");
    showScreen("chat");
    switchChannel("order", orderId);
    setTimeout(() => textInput?.focus(), 150);
  }

  function openSupportChat() {
    if (drawer) drawer.classList.add("active");
    showScreen("chat");
    switchChannel("support");
    setTimeout(() => textInput?.focus(), 150);
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = textInput?.value || "";
      if (!text.trim() && !attachedFile) return;

      if (!currentUser) {
        showToast("Please sign in to send a message to our support team.", "error");
        document.getElementById("auth-modal")?.classList.add("active");
        return;
      }

      try {
        let attachmentUrl = "";
        if (attachedFile) {
          const folderTarget = currentChannel === "support" ? currentUser.uid : activeChatOrderId;
          attachmentUrl = await uploadChatAttachment(attachedFile, folderTarget);
          attachedFile = null;
          if (fileInput) fileInput.value = "";
          if (previewBox) previewBox.style.display = "none";
        }

        const replyPayload = activeCustomerReplyingMessage
          ? {
              id: activeCustomerReplyingMessage.id,
              senderName:
                activeCustomerReplyingMessage.senderName ||
                (activeCustomerReplyingMessage.senderRole === "admin" || activeCustomerReplyingMessage.senderRole === "staff"
                  ? "Lanica Support"
                  : "You"),
              text: activeCustomerReplyingMessage.text || activeCustomerReplyingMessage.content || "[Photo]",
            }
          : null;

        if (currentChannel === "support") {
          await sendChatMessage({
            userId: currentUser.uid,
            sessionType: "support",
            isUserSupport: true,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || "Customer",
            senderRole: "customer",
            receiverId: "support_admin",
            text: text,
            attachmentUrl: attachmentUrl,
            replyTo: replyPayload,
          });
        } else {
          if (!activeChatOrderId) {
            showToast("Please select an order thread to message the workshop.", "error");
            return;
          }
          await sendChatMessage({
            orderId: activeChatOrderId,
            sessionType: "order",
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || "Customer",
            senderRole: "customer",
            receiverId: "staff",
            text: text,
            attachmentUrl: attachmentUrl,
            replyTo: replyPayload,
          });
        }

        if (textInput) textInput.value = "";
        setCustomerReplyingMessage(null);
        scrollChatToBottom();
      } catch (err) {
        console.error("Chat error:", err);
        showToast(err.message || "Failed to send message.", "error");
      }
    });
  }

  return { initUserChat, openOrderChat, openSupportChat, renderChannelBar };
}

// ==============================================================================
// LANICA OFFICIAL CUSTOMER RECEIPT & WARRANTY VOUCHER MODAL
// ==============================================================================
let activeCustomerReceiptOrder = null;
let activeCustomerReceiptBranch = "calamba";
let activeCustomerReceiptTab = "voucher";

const LANICA_BRANCHES = {
  calamba: {
    key: "calamba",
    name: "Calamba Branch",
    title: "LANICA'S SOFA SALA SET CALAMBA BRANCH",
    address: "MILAN PRESTIGE BLDG. BRGY. HALANG NATIONAL HIGHWAY CALAMBA CITY LAGUNA",
    contact: "0993-287-4937",
    voucherLocation: "MILAN PRESTIGE BUILDING, BRGY. HALANG CALAMBA LAGUNA",
  },
  pila: {
    key: "pila",
    name: "Pila Branch",
    title: "LANICA'S SOFA SALA SET PILA BRANCH",
    address: "VILLASOL 1, BRGY. LABUIN NATIONAL HIGHWAY, PILA, LAGUNA",
    contact: "0993-287-4937",
    voucherLocation: "VILLASOL 1, BRGY. LABUIN NATIONAL HIGHWAY, PILA, LAGUNA",
  },
};

export function openLanicaCustomerReceiptModal(order, defaultTab = "voucher") {
  if (!order) return;
  activeCustomerReceiptOrder = order;
  activeCustomerReceiptTab = defaultTab || "voucher";
  initLanicaReceiptModalListeners();
  renderCustomerReceiptDocument();

  const modal = document.getElementById("lanica-receipt-modal");
  if (modal) {
    modal.classList.add("active");
    modal.style.display = "flex";
  }
}

function formatFormalDate(val, uppercase = false) {
  if (!val) return "—";
  let d = null;
  if (val.toDate && typeof val.toDate === "function") d = val.toDate();
  else if (val.seconds) d = new Date(val.seconds * 1000);
  else d = new Date(val);
  if (isNaN(d.getTime())) return "—";
  const str = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return uppercase ? str.toUpperCase() : str;
}

function renderCustomerReceiptDocument() {
  const area = document.getElementById("lanica-printable-area");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");

  if (!area || !activeCustomerReceiptOrder) return;
  const order = activeCustomerReceiptOrder;

  // Sync Document Tabs Visual State
  if (tabVoucher && tabQuotation) {
    if (activeCustomerReceiptTab === "voucher") {
      tabVoucher.classList.add("active");
      tabQuotation.classList.remove("active");
      tabVoucher.style.background = "#2563eb";
      tabVoucher.style.color = "#ffffff";
      tabQuotation.style.background = "transparent";
      tabQuotation.style.color = "#94a3b8";
    } else {
      tabQuotation.classList.add("active");
      tabVoucher.classList.remove("active");
      tabQuotation.style.background = "#2563eb";
      tabQuotation.style.color = "#ffffff";
      tabVoucher.style.background = "transparent";
      tabVoucher.style.color = "#94a3b8";
    }
  }

  // Toggle Branch button active states
  const currentBranchKey = order._selectedBranch || activeCustomerReceiptBranch || "calamba";
  const branchConfig = LANICA_BRANCHES[currentBranchKey] || LANICA_BRANCHES.calamba;
  const branch = order._docBranch || branchConfig;

  if (branchCalamba && branchPila) {
    if (currentBranchKey === "pila") {
      branchPila.classList.add("active");
      branchCalamba.classList.remove("active");
      branchPila.style.background = "#2563eb";
      branchPila.style.color = "#ffffff";
      branchCalamba.style.background = "transparent";
      branchCalamba.style.color = "#94a3b8";
    } else {
      branchCalamba.classList.add("active");
      branchPila.classList.remove("active");
      branchCalamba.style.background = "#2563eb";
      branchCalamba.style.color = "#ffffff";
      branchPila.style.background = "transparent";
      branchPila.style.color = "#94a3b8";
    }
  }

  const orderId = order.orderId || order.id || "N/A";

  // Use preserved custom edits saved by admin on the order, or live order attributes
  const customQuotation = order._docQuotation || {};
  const customerName =
    customQuotation.customerName ||
    order.shippingAddress?.fullName ||
    order.shippingAddress?.recipientName ||
    order.recipientName ||
    order.customerName ||
    order.userName ||
    currentUser?.displayName ||
    "Valued Customer";

  const customerAddress =
    customQuotation.customerAddress ||
    order.shippingAddress?.fullAddress ||
    order.shippingAddress?.address ||
    order.address ||
    order.customerAddress ||
    "—";

  const customerPhone =
    customQuotation.customerPhone ||
    order.shippingAddress?.phoneNumber ||
    order.shippingAddress?.phone ||
    order.phone ||
    order.phoneNumber ||
    "—";

  const quotationNumber =
    customQuotation.quotationNumber ||
    String(orderId).slice(0, 10).toUpperCase();

  const purchaseDate = customQuotation.purchaseDate || formatFormalDate(order.createdAt, false);
  const purchaseDateUpper = formatFormalDate(order.createdAt, true);
  const deliveryDate =
    customQuotation.deliveryDate ||
    formatFormalDate(
      order.targetDeliveryDate || order.estimatedDeliveryDate || order.deliveredAt,
      true
    );

  const totalVal = Number(order.totalAmount || order.total || 0);
  const deliveryCharge = Number(order.deliveryFee ?? order.shippingFee ?? order.shippingAddress?.shippingCost ?? 1000);
  const discountDf = Number(order.discountedDeliveryFee ?? order.discountDf ?? 0);
  const itemsSubtotal = Math.max(0, totalVal - deliveryCharge);
  const totalPlusDf = itemsSubtotal + deliveryCharge;
  const grandTotal = totalVal;

  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || order.paymentMethod === "walk_in_cash";
  const downpaymentAmount = Number(order.downpaymentAmount || Math.round(totalVal * 0.30));

  const balStatusLower = String(order.balanceStatus || "").trim().toLowerCase();
  const isCompletedOrder =
    order.status === "completed" ||
    order.orderStatus === "completed" ||
    order.orderReceived === true ||
    Boolean(order.completedAt) ||
    Boolean(order.orderReceivedAt);

  const isBalanceSettled =
    balStatusLower === "settled" ||
    order.isBalanceSettled === true ||
    order.balanceSettled === true ||
    (Number(order.outstandingBalance) === 0 && order.balanceStatus !== undefined) ||
    (Number(order.remainingBalance) === 0 && order.balanceStatus !== undefined) ||
    isCompletedOrder;

  const paidVal = isBalanceSettled
    ? totalVal
    : isDownpayment
      ? downpaymentAmount
      : totalVal;

  const remainingVal = isBalanceSettled
    ? 0
    : Math.max(0, totalVal - paidVal);

  const isPartial = isDownpayment && remainingVal > 0;

  const isCash =
    order.paymentMethod === "walk_in_cash" ||
    order.paymentMethod === "cash" ||
    String(order.paymentMethod || "").toLowerCase().includes("counter") ||
    String(order.paymentType || "").toLowerCase().includes("cash");
  const methodDisplay = isCash ? "CASH (COUNTER)" : "QR PH / PAYMONGO";

  const proofUrl = order.proofUrl || order.paymentProof || order.paymentProofUrl || order.riderCashProofUrl || "";

  // Common Header Template matching authentic Lanica format
  const headerHtml = `
    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 18px; margin-bottom: 8px;">
      <img src="assets/lanicalogo.jpg" alt="Lanica Logo" style="width: 76px; height: 76px; object-fit: contain; border: 1.5px solid #000; padding: 2px;" onerror="this.onerror=null;this.src='assets/product_sofa.png';" />
      <div style="text-align: center; flex: 1;">
        <div style="font-size: 0.95rem; font-weight: 800; letter-spacing: 0.05em; color: #000; text-transform: uppercase; padding: 1px 4px;">
          ${escapeHtml(branch.title)}
        </div>
        <div style="font-size: 0.8rem; font-weight: 600; color: #1f2937; margin-top: 3px; text-transform: uppercase; padding: 1px 4px;">
          ${escapeHtml(branch.address)}
        </div>
        <div style="font-size: 0.8rem; font-weight: 700; color: #000; margin-top: 2px;">
          CONTACT NO#: <span>${escapeHtml(branch.contact)}</span>
        </div>
      </div>
    </div>
    <div style="height: 4px; background: #000; width: 100%; margin-bottom: 22px;"></div>
  `;

  const items = (Array.isArray(order.items) && order.items.length > 0)
    ? order.items
    : [{
        name: order.productName || order.itemTitle || "Custom Handcrafted Furniture",
        quantity: 1,
        price: itemsSubtotal,
        material: order.material || "Kiln-Dried Hardwood / High-Density Foam",
        color: order.fabricColor || order.color || "Standard Color",
        customNotes: order.customNotes || "Standard Artisan Custom Specs",
      }];

  const isUpholsteryOnly = (val) => {
    if (!val) return true;
    const s = String(val).trim().toLowerCase();
    return s === "fabric" || s === "leather" || s === "standard" || s === "custom";
  };

  if (activeCustomerReceiptTab === "voucher") {
    // ==========================================
    // DOCUMENT 1: PAYMENT REQUEST VOUCHER (Screenshot 1)
    // ==========================================
    const firstItem = (order.items && order.items[0]) || null;
    const firstItemName = firstItem
      ? firstItem.name || firstItem.title || "Custom Furniture"
      : (order.productName || "Custom Furniture");
    const particulars = `PAYMENT FOR ${escapeHtml(firstItemName.toUpperCase())} SOFA SET`;
    const staffSignatory = order.assignedStaffName || "carlo";
    const signDate = purchaseDate;

    // Use preserved custom edits saved by admin on the order, or defaults matching Screenshot 1
    const sigs = order._voucherSignatories || {
      preparedBy: staffSignatory,
      preparedDate: signDate,
      checkedBy: "Staff Lead",
      checkedDate: signDate,
      approvedBy: "SUPERVISOR",
      approvedDate: signDate,
      receivedBy: "OWNER/REPRESENTATIVE",
      receivedDate: signDate,
      signatures: {},
    };
    const signatures = sigs.signatures || {};

    const renderSignatoryCol = (roleKey, roleLabel, defaultName, isCursive = false) => {
      const nameVal = sigs[roleKey] || defaultName;
      const dateVal = sigs[roleKey + "Date"] || purchaseDate;
      const signatureImg = signatures[roleKey] || null;

      return `
        <div style="display: flex; flex-direction: column; justify-content: flex-end;">
          <div style="font-weight: 700; text-transform: uppercase; color: #000; min-height: 28px; display: flex; align-items: center; justify-content: center; line-height: 1.2;">${roleLabel}</div>

          <!-- E-Signature Slot Above Name -->
          <div style="min-height: 52px; display: flex; align-items: flex-end; justify-content: center; position: relative; margin: 6px auto 2px; width: 90%;">
            ${
              signatureImg
                ? `<img src="${signatureImg}" alt="Signature" style="max-height: 48px; max-width: 130px; object-fit: contain; display: block;" />`
                : `<div style="height: 1px;"></div>`
            }
          </div>

          <div
            style="margin: 2px auto 4px; border-bottom: 1.5px solid #000; width: 90%; min-height: 22px; font-weight: ${isCursive ? "600" : "800"}; ${isCursive ? "font-family: cursive, 'Brush Script MT', sans-serif; font-size: 0.95rem; color: #1e293b;" : "font-size: 0.78rem; color: #000;"} padding: 1px 4px; text-align: center;"
          >${escapeHtml(nameVal)}</div>

          <div style="font-size: 0.72rem; color: #475569;">
            DATE: <span>${escapeHtml(dateVal)}</span>
          </div>
        </div>
      `;
    };

    area.innerHTML = `
      <div style="max-width: 760px; margin: 0 auto; color: #000;">
        ${headerHtml}

        <div style="font-size: 1.25rem; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 20px;">
          PAYMENT REQUEST VOUCHER
        </div>

        <div style="font-size: 0.9rem; font-weight: 700; color: #000; margin-bottom: 8px;">1. Payment Request Form / Voucher</div>

        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 0.86rem; margin-bottom: 28px;">
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; width: 38%; text-transform: uppercase;">DOCUMENT DATE:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 600; text-transform: uppercase;">${escapeHtml(purchaseDateUpper)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PAYEE NAME:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; text-transform: uppercase;">LANICA'S BED AND SOFA BED TRADING</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PAYMENT METHOD:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">${escapeHtml(methodDisplay)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">LOCATION:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 600; text-transform: uppercase;">${escapeHtml(branch.voucherLocation || branch.address)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PARTICULARS/DESCRIPTION:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">${particulars}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">TOTAL CONTRACT/ BILLING AMOUNT</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700;">₱ ${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">
                AMOUNT PAID (PARTIAL ${isPartial ? "<strong>[ ☑ ]</strong>" : "[ ☐ ]"} FULL ${!isPartial ? "<strong>[ ☑ ]</strong>" : "[ ☐ ]"})
              </td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700;">₱ ${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; text-transform: uppercase;">REMAINING BALANCE:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; font-size: 0.95rem;">₱ ${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div style="font-size: 0.9rem; font-weight: 700; color: #000; margin-bottom: 8px;">2. APPROVAL &amp; CHECK/PAYMENT RELEASE SIGNATORIES</div>
        <div style="border-top: 2px solid #000; padding-top: 14px; margin-bottom: 24px;">
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center; font-size: 0.78rem;">
            ${renderSignatoryCol("preparedBy", "PREPARED BY", staffSignatory, true)}
            ${renderSignatoryCol("checkedBy", "CHECKED BY", "Staff Lead", true)}
            ${renderSignatoryCol("approvedBy", "APPROVED AND CHECK<br/>SIGNATORY", "SUPERVISOR", false)}
            ${renderSignatoryCol("receivedBy", "CHECK PAYMENT<br/>RECEIVE", "OWNER/REPRESENTATIVE", false)}
          </div>
        </div>

        ${
          proofUrl
            ? `
          <div style="margin-top: 18px; border: 1.5px dashed #64748b; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: #334155; margin-bottom: 10px;">ATTACHED PAYMENT VERIFICATION SCREENSHOT / ADVICE:</div>
            <img src="${proofUrl}" alt="Proof of Payment" style="max-height: 260px; max-width: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); margin: 0 auto; display: block;" onerror="this.onerror=null;this.parentElement.style.display='none';" />
          </div>
        `
            : `
          <div style="margin-top: 18px; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; color: #059669;">PAYMENT RECONCILED &amp; VERIFIED VIA ${escapeHtml(methodDisplay)}</div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 3px;">Lanica Financial Ledger Ref: <strong>TX-${escapeHtml(String(quotationNumber).slice(0, 10))}</strong> &bull; Reconciled on ${escapeHtml(purchaseDate)}</div>
          </div>
        `
        }
      </div>
    `;
    return;
  }

  // ==========================================
  // DOCUMENT 2: OFFICIAL QUOTATION (Screenshot 2)
  // ==========================================
  const itemsRowsHtml = items.map((item, idx) => {
    const itemQty = Number(item.quantity || 1);
    const itemPrice = Number(item.price || 0);
    const itemTotal = itemPrice * itemQty;
    const itemName = String(item.name || item.title || order.productName || "Custom Handcrafted Furniture").toUpperCase();
    const rawColor = item.color || item.fabricColor || order.fabricColor || order.color || "STANDARD COLOR";
    const itemColor = String(rawColor).toUpperCase();
    const itemSpecs = item.customNotes || item.specs || order.customNotes || "Standard Artisan Custom Specs";

    const rawFreebies = item.freebies || order.freebies || "";
    const freebiesList = (Array.isArray(rawFreebies) ? rawFreebies : String(rawFreebies).split(/[\n,]+/))
      .map((f) => String(f).trim())
      .filter(Boolean);

    let materialsList = [];
    if (Array.isArray(item.materials) && item.materials.length > 0) {
      materialsList = item.materials.map((m) => String(m).trim()).filter((m) => m && !isUpholsteryOnly(m));
    }
    if (materialsList.length === 0 && item.materials && typeof item.materials === "string" && !isUpholsteryOnly(item.materials)) {
      materialsList = String(item.materials).split(/[\n,]+/).map((m) => m.trim()).filter((m) => m && !isUpholsteryOnly(m));
    }
    if (materialsList.length === 0) {
      materialsList = [
        "4 INCHES PURE ORIGINAL URATEX FOAM",
        "GOOD LUMBER WOOD FRAME",
        "BUO PO ANG PANAHIG NYA WALA PONG SPRING",
        "WITH 2 BY 3 BRACES PO NA PANG SUPPORT AT PAMPATIBAY SA SOFA KAYA DI PO SYA LULUNDO",
      ];
    }

    return `
      <tr style="vertical-align: top; border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px 8px; font-weight: 700; width: 36px;">${idx + 1}</td>
        <td style="padding: 10px 8px;">
          <div style="font-weight: 800; font-size: 0.95rem; text-transform: uppercase; color: #000;">${escapeHtml(itemName)}</div>
          <div style="font-weight: 700; font-size: 0.82rem; margin-top: 3px;">STANDARD SIZE</div>
          <div style="font-size: 0.82rem; margin-top: 2px;">${escapeHtml(itemSpecs)}</div>
          <div style="font-weight: 700; font-size: 0.82rem; margin-top: 6px;">COLOR: ${escapeHtml(itemColor)}</div>
          ${item.material ? `<div style="font-weight: 700; font-size: 0.8rem; margin-top: 2px; color: #4b5563;">FINISH / UPHOLSTERY: ${escapeHtml(String(item.material).toUpperCase())}</div>` : ""}

          <div style="margin-top: 8px; font-size: 0.8rem;">
            <div style="font-weight: 700; text-transform: uppercase;">FREEBIES:</div>
            <div style="padding-left: 4px; line-height: 1.4;">
              ${freebiesList.length > 0 ? freebiesList.map((f) => `✓ ${escapeHtml(f.toUpperCase())}`).join("<br/>") : "✓ STANDARD INCLUSIONS"}
            </div>
          </div>

          <div style="margin-top: 8px; font-size: 0.8rem;">
            <div style="font-weight: 700; text-transform: uppercase;">MATERIALS:</div>
            <div style="padding-left: 4px; line-height: 1.4;">
              ${materialsList.map((m) => `✓ ${escapeHtml(m.toUpperCase())}`).join("<br/>")}
            </div>
          </div>

          <div style="margin-top: 10px; font-weight: 800; font-size: 0.82rem; text-transform: uppercase; color: #000;">
            6 MONTHS WARRANTY FOAM SEAT ONLY
          </div>
        </td>
        <td style="padding: 10px 8px; text-align: center; font-weight: 700; width: 60px;">${itemQty}</td>
        <td style="padding: 10px 8px; text-align: right; font-weight: 700; width: 110px;">₱ ${itemPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="padding: 10px 8px; text-align: right; font-weight: 700; width: 110px;">₱ ${itemTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join("");

  area.innerHTML = `
    <div style="max-width: 760px; margin: 0 auto; color: #000;">
      ${headerHtml}

      <!-- Customer & Quotation Meta Grid -->
      <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 22px; font-size: 0.86rem; line-height: 1.5; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 260px;">
          <div><strong>NAME:</strong> <span style="text-transform: uppercase;">${escapeHtml(customerName)}</span></div>
          <div><strong>ADDRESS:</strong> <span style="text-transform: uppercase;">${escapeHtml(customerAddress)}</span></div>
          <div><strong>CONTACT#:</strong> <span>${escapeHtml(customerPhone)}</span></div>
        </div>
        <div style="min-width: 260px; text-align: right;">
          <div><strong>QUOTATION#</strong> <span>${escapeHtml(quotationNumber)}</span></div>
          <div><strong>DATE OF PURCHASE:</strong> <span>${escapeHtml(purchaseDate)}</span></div>
          <div><strong>DATE OF DELIVERY:</strong> <span style="text-transform: uppercase;">${escapeHtml(deliveryDate)}</span></div>
        </div>
      </div>

      <!-- Items Breakdown Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 0.86rem;">
        <thead>
          <tr style="border-top: 2px solid #000; border-bottom: 2px solid #000; text-align: left; font-size: 0.85rem;">
            <th style="padding: 8px 8px; width: 36px;">#</th>
            <th style="padding: 8px 8px;">Description</th>
            <th style="padding: 8px 8px; text-align: center; width: 60px;">QTY</th>
            <th style="padding: 8px 8px; text-align: right; width: 110px;">PRICE</th>
            <th style="padding: 8px 8px; text-align: right; width: 110px;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRowsHtml}
          <tr style="border-top: 2px solid #000;">
            <td style="padding: 8px 8px;"></td>
            <td style="padding: 8px 8px; font-weight: 800; color: #dc2626; text-transform: uppercase;">DELIVERY CHARGE</td>
            <td style="padding: 8px 8px; text-align: center; font-weight: 700;">1</td>
            <td style="padding: 8px 8px; text-align: right; font-weight: 700; color: #dc2626;">₱ ${deliveryCharge.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding: 8px 8px; text-align: right; font-weight: 700; color: #dc2626;">₱ ${deliveryCharge.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        </tbody>
      </table>

      <!-- Right Aligned Financial Totals -->
      <div style="display: flex; justify-content: flex-end; margin-bottom: 28px;">
        <div style="width: 320px; font-size: 0.88rem; line-height: 1.6;">
          <div style="display: flex; justify-content: space-between; font-weight: 800; color: #0891b2;">
            <span>TOTAL PURCHASED</span>
            <span>₱ ${itemsSubtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 800; color: #dc2626;">
            <span>DELIVERY CHARGE</span>
            <span>₱ ${deliveryCharge.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 800; border-top: 1.5px solid #000; padding-top: 4px; margin-top: 4px;">
            <span>TOTAL:</span>
            <span>₱ ${totalPlusDf.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          ${
            discountDf > 0
              ? `
            <div style="display: flex; justify-content: space-between; font-weight: 700; border-top: 1px dashed #cbd5e1; border-bottom: 1px dashed #cbd5e1; padding: 3px 0; margin: 4px 0;">
              <span>Discounted DF:</span>
              <span style="color: #dc2626; font-weight: 800;">LESS ₱ ${discountDf.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          `
              : ""
          }
          <div style="border: 2px solid #dc2626; padding: 7px 12px; margin-top: 8px; display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 900; color: #dc2626;">
            <span>GRAND TOTAL:</span>
            <span>₱ ${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      <!-- Quotation Footer Terms -->
      <div style="font-size: 0.82rem; color: #1e293b; margin-top: 36px;">
        <p style="margin: 0 0 14px;">We hope you find our offer to be in line with your requirement.</p>
        <div><strong>TERMS &amp; CONDITIONS:</strong></div>
        <div style="margin-top: 4px;">❖ Attached to the next page</div>
      </div>
    </div>
  `;
}

function initLanicaReceiptModalListeners() {
  const modal = document.getElementById("lanica-receipt-modal");
  const closeBtn = document.getElementById("btn-close-lanica-modal");
  const printBtn = document.getElementById("btn-print-lanica-doc");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");

  const closeModal = () => {
    if (modal) {
      modal.classList.remove("active");
      modal.style.display = "none";
    }
  };

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", closeModal);
  }

  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = "true";
  }

  if (tabVoucher && !tabVoucher.dataset.bound) {
    tabVoucher.dataset.bound = "true";
    tabVoucher.addEventListener("click", () => {
      activeCustomerReceiptTab = "voucher";
      renderCustomerReceiptDocument();
    });
  }

  if (tabQuotation && !tabQuotation.dataset.bound) {
    tabQuotation.dataset.bound = "true";
    tabQuotation.addEventListener("click", () => {
      activeCustomerReceiptTab = "quotation";
      renderCustomerReceiptDocument();
    });
  }

  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "true";
    printBtn.addEventListener("click", () => {
      if (activeCustomerReceiptOrder && activeCustomerReceiptOrder.receiptPdfUrl) {
        window.open(activeCustomerReceiptOrder.receiptPdfUrl, "_blank");
      } else {
        window.print();
      }
    });
  }

  const setBranch = (branchKey) => {
    activeCustomerReceiptBranch = branchKey;
    if (activeCustomerReceiptOrder) {
      activeCustomerReceiptOrder._selectedBranch = branchKey;
    }
    renderCustomerReceiptDocument();
  };

  if (branchCalamba && !branchCalamba.dataset.bound) {
    branchCalamba.dataset.bound = "true";
    branchCalamba.addEventListener("click", () => setBranch("calamba"));
  }

  if (branchPila && !branchPila.dataset.bound) {
    branchPila.dataset.bound = "true";
    branchPila.addEventListener("click", () => setBranch("pila"));
  }
}

// Blank document title during window print so browsers don't print "Lanica | My Orders"
let savedDocTitle = "";
window.addEventListener("beforeprint", () => {
  const modal = document.getElementById("lanica-receipt-modal");
  if (modal && modal.classList.contains("active")) {
    savedDocTitle = document.title;
    document.title = "";
  }
});
window.addEventListener("afterprint", () => {
  if (savedDocTitle) {
    document.title = savedDocTitle;
    savedDocTitle = "";
  }
});

