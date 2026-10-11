/**
 * Lanica Furniture Platform - Dynamic PayMongo QR Ph 30% Downpayment Controller
 * Handles serverless QR Ph generation, verification, modal rendering, downloading & auto-polling.
 */
import { db, auth } from "./firebaseConfig.js";
import {
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

let activePollInterval = null;
let currentPaymentIntentId = null;
let currentOrderId = null;
let currentQrImageUrl = null;
let currentDownpaymentPhp = 0;
let isPaymentVerified = false;
let modalOnConfirmPaymentCallback = null;
let modalOnSuccessCallback = null;
let modalOnCloseCallback = null;

/**
 * Creates a dynamic PayMongo QR Ph payment intent, payment method, and attach action
 * via the serverless Cloudflare / Express backend.
 */
export async function createPaymongoQrPayment({ orderId, totalAmount }) {
  if (!orderId) {
    throw new Error("Order ID is required to generate PayMongo QR Ph.");
  }
  const parsedTotal = Number(totalAmount);
  if (isNaN(parsedTotal) || parsedTotal <= 0) {
    throw new Error("Valid totalAmount is required.");
  }

  const res = await fetch("/api/paymongo/create-qr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      orderId: String(orderId).trim(),
      totalAmount: parsedTotal,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const errorMsg = data.error || data.message || "Failed to generate PayMongo QR Ph.";
    throw new Error(errorMsg);
  }

  return {
    success: true,
    paymentIntentId: data.paymentIntentId,
    qrImageUrl: data.qrImageUrl,
    downpaymentPhp: data.downpaymentPhp,
  };
}

/**
 * Verifies PayMongo payment status via the serverless backend.
 * Upon verified payment, updates Firestore order records.
 */
export async function verifyPaymongoPayment({ paymentIntentId, orderId }) {
  if (!paymentIntentId) {
    throw new Error("paymentIntentId is required for verification.");
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Attach Firebase ID token if user is signed in
  if (auth?.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) {
        headers["Authorization"] = `Bearer ${idToken}`;
      }
    } catch (tokenErr) {
      console.warn("Could not retrieve ID token:", tokenErr);
    }
  }

  const res = await fetch("/api/paymongo/verify-payment", {
    method: "POST",
    headers,
    body: JSON.stringify({
      paymentIntentId: String(paymentIntentId).trim(),
      orderId: String(orderId || "").trim(),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.error || data.message || "Failed to verify PayMongo payment.";
    throw new Error(errorMsg);
  }

  // For pre-existing orders being paid, update Firestore directly upon verification
  if (data.isPaid && orderId && !modalOnConfirmPaymentCallback) {
    try {
      const orderRef = doc(db, "orders", String(orderId).trim());
      await updateDoc(orderRef, {
        paymentStatus: "downpayment_paid",
        paymentIntentId: paymentIntentId,
        downpaymentPaidAt: serverTimestamp(),
        orderStatus: "downpayment confirmed",
        status: "Downpayment Confirmed",
      });
    } catch (fsErr) {
      console.warn("Client Firestore update notice:", fsErr);
    }
  }

  return {
    isPaid: Boolean(data.isPaid),
    status: data.status || "",
    paymentIntentId: paymentIntentId,
  };
}

/**
 * Downloads the Base64 QR code image as `lanica-order-<orderId>-qrph.png`
 */
export async function downloadPaymongoQrCode(qrImageUrl, orderId) {
  if (!qrImageUrl) return;
  const filename = `lanica-order-${orderId || "payment"}-qrph.png`;

  if (qrImageUrl.startsWith("data:")) {
    const link = document.createElement("a");
    link.href = qrImageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  try {
    const res = await fetch(qrImageUrl);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    const link = document.createElement("a");
    link.href = qrImageUrl;
    link.target = "_blank";
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Expose global actions on window for inline handlers & fail-safe access
if (typeof window !== "undefined") {
  window.lanicaClosePaymongoModal = () => closePaymongoQrModal(true);
  window.lanicaVerifyPaymongoPayment = () => handleManualVerification();
  window.lanicaSavePaymongoQr = () => {
    if (currentQrImageUrl && currentOrderId) {
      downloadPaymongoQrCode(currentQrImageUrl, currentOrderId);
    }
  };
  window.openPaymongoQrModal = openPaymongoQrModal;
  window.closePaymongoQrModal = closePaymongoQrModal;
}

// Global document-level event delegation (guarantees clicks work across all pages and re-renders)
if (typeof document !== "undefined" && !window.__lanicaPaymongoDelegated) {
  window.__lanicaPaymongoDelegated = true;
  document.addEventListener("click", (e) => {
    // 1. Close Button
    const closeBtn = e.target.closest("#paymongo-modal-close-btn, .paymongo-qr-close");
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      closePaymongoQrModal(true);
      return;
    }

    // 2. Verify Button
    const verifyBtn = e.target.closest("#paymongo-verify-btn, .paymongo-btn-verify");
    if (verifyBtn) {
      e.preventDefault();
      e.stopPropagation();
      handleManualVerification();
      return;
    }

    // 3. Save QR Button
    const saveBtn = e.target.closest("#paymongo-save-qr-btn, .paymongo-btn-save");
    if (saveBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (currentQrImageUrl && currentOrderId) {
        downloadPaymongoQrCode(currentQrImageUrl, currentOrderId);
      }
      return;
    }

    // 4. Modal Backdrop click (clicking outside the card)
    const modalEl = document.getElementById("paymongo-qr-modal");
    if (modalEl && modalEl.classList.contains("active") && e.target === modalEl) {
      e.preventDefault();
      closePaymongoQrModal(true);
      return;
    }
  });

  // Escape key closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
      const modalEl = document.getElementById("paymongo-qr-modal");
      if (modalEl && modalEl.classList.contains("active")) {
        closePaymongoQrModal(true);
      }
    }
  });
}

/**
 * Wires or re-wires event listeners directly onto modal elements
 */
function wirePaymongoModalEvents(modal) {
  if (!modal) return;

  const closeBtn = modal.querySelector("#paymongo-modal-close-btn, .paymongo-qr-close");
  if (closeBtn && !closeBtn._lanicaWired) {
    closeBtn._lanicaWired = true;
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closePaymongoQrModal(true);
    });
  }

  const saveBtn = modal.querySelector("#paymongo-save-qr-btn, .paymongo-btn-save");
  if (saveBtn && !saveBtn._lanicaWired) {
    saveBtn._lanicaWired = true;
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (currentQrImageUrl && currentOrderId) {
        downloadPaymongoQrCode(currentQrImageUrl, currentOrderId);
      }
    });
  }

  const verifyBtn = modal.querySelector("#paymongo-verify-btn, .paymongo-btn-verify");
  if (verifyBtn && !verifyBtn._lanicaWired) {
    verifyBtn._lanicaWired = true;
    verifyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleManualVerification();
    });
  }

  if (!modal._lanicaBackdropWired) {
    modal._lanicaBackdropWired = true;
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        e.preventDefault();
        closePaymongoQrModal(true);
      }
    });
  }
}

/**
 * Injects or ensures the PayMongo QR Ph Modal DOM exists
 */
function ensurePaymongoModalDom() {
  let modal = document.getElementById("paymongo-qr-modal");
  if (!modal) {
    const modalHtml = `
      <div id="paymongo-qr-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card paymongo-qr-card">
          <!-- Header -->
          <div class="paymongo-qr-header">
            <div class="paymongo-qr-header-left">
              <div class="paymongo-qr-icon-badge">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
              </div>
              <div>
                <h3 class="paymongo-qr-title">LIVE PAYMONGO QR PH</h3>
                <p class="paymongo-qr-sub">GCash • Maya • GoTyme • Banks</p>
              </div>
            </div>
            <button type="button" id="paymongo-modal-close-btn" class="paymongo-qr-close" aria-label="Close QR Modal" onclick="window.lanicaClosePaymongoModal && window.lanicaClosePaymongoModal()">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="paymongo-qr-body">
            <!-- Metric Pill -->
            <div class="paymongo-metric-pill">
              <div class="paymongo-metric-info">
                <span class="paymongo-metric-sub">30% Downpayment Due</span>
                <span id="paymongo-order-ref" class="paymongo-metric-order">Order #---</span>
              </div>
              <div id="paymongo-amount-display" class="paymongo-metric-amount">₱0</div>
            </div>

            <!-- White QR Container -->
            <div class="paymongo-white-qr-container">
              <div class="paymongo-qrph-branding">
                <span>QR</span> PH
              </div>
              <div class="paymongo-qr-image-frame">
                <img id="paymongo-qr-img" src="" alt="Live PayMongo QR Ph" style="display: none;" />
                <div id="paymongo-qr-spinner" class="paymongo-loading-spinner"></div>
              </div>
              <div class="paymongo-qr-instructions">
                SCAN OR UPLOAD QR PH VIA YOUR BANK / WALLET APP
              </div>
            </div>

            <!-- Info Panel -->
            <div class="paymongo-info-panel">
              <div class="paymongo-info-title">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                Supported QR Ph Wallets & Banks
              </div>
              <div class="paymongo-wallets-list">
                <span class="paymongo-wallet-tag">GCash</span>
                <span class="paymongo-wallet-tag">Maya</span>
                <span class="paymongo-wallet-tag">ShopeePay</span>
                <span class="paymongo-wallet-tag">GrabPay</span>
                <span class="paymongo-wallet-tag">StarPay</span>
                <span class="paymongo-wallet-tag">GoTyme</span>
                <span class="paymongo-wallet-tag">BDO</span>
                <span class="paymongo-wallet-tag">BPI</span>
                <span class="paymongo-wallet-tag">UnionBank</span>
                <span class="paymongo-wallet-tag">RCBC</span>
                <span class="paymongo-wallet-tag">SeaBank</span>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="paymongo-btn-grid">
              <button type="button" id="paymongo-save-qr-btn" class="paymongo-btn-save" onclick="window.lanicaSavePaymongoQr && window.lanicaSavePaymongoQr()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                SAVE QR
              </button>
              <button type="button" id="paymongo-verify-btn" class="paymongo-btn-verify" onclick="window.lanicaVerifyPaymongoPayment && window.lanicaVerifyPaymongoPayment()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                VERIFY & SUBMIT
              </button>
            </div>

            <div id="paymongo-status-toast" class="paymongo-status-toast polling">
              Awaiting payment detection...
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHtml);
    modal = document.getElementById("paymongo-qr-modal");
  }

  wirePaymongoModalEvents(modal);
  return modal;
}

/**
 * Handles manual verification click on the modal
 */
export async function handleManualVerification() {
  if (!currentPaymentIntentId || !currentOrderId) {
    console.warn("PayMongo verify clicked without active intent or order ID:", { currentPaymentIntentId, currentOrderId });
    const toast = document.getElementById("paymongo-status-toast");
    if (toast) {
      toast.className = "paymongo-status-toast error";
      toast.textContent = "Payment session is still initializing. Please wait a moment and try again.";
    }
    return;
  }
  const verifyBtn = document.getElementById("paymongo-verify-btn");
  const toast = document.getElementById("paymongo-status-toast");

  try {
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.innerHTML = `
        <div class="paymongo-loading-spinner" style="width: 16px; height: 16px; border-width: 2px; border-color: rgba(0,0,0,0.2); border-top-color: #000;"></div>
        Verifying...
      `;
    }
    if (toast) {
      toast.className = "paymongo-status-toast polling";
      toast.textContent = "Connecting to PayMongo payment gateway...";
    }

    const result = await verifyPaymongoPayment({
      paymentIntentId: currentPaymentIntentId,
      orderId: currentOrderId,
    });

    if (result.isPaid) {
      await handlePaymentSuccessful();
    } else {
      if (toast) {
        toast.className = "paymongo-status-toast error";
        toast.textContent = "Payment not detected yet. Complete the payment in your banking or wallet app, then try again.";
      }
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          VERIFY & SUBMIT
        `;
      }
    }
  } catch (err) {
    console.error("Manual verification error:", err);
    if (toast) {
      toast.className = "paymongo-status-toast error";
      toast.textContent = err.message || "Verification request failed. Please check your connection.";
    }
    if (verifyBtn) {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="pointer-events: none;">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        VERIFY & SUBMIT
      `;
    }
  }
}

/**
 * Starts automatic 3.5-second polling for payment intent status
 */
function startVerificationPolling() {
  stopVerificationPolling();
  activePollInterval = setInterval(async () => {
    if (!currentPaymentIntentId || !currentOrderId) return;
    try {
      const result = await verifyPaymongoPayment({
        paymentIntentId: currentPaymentIntentId,
        orderId: currentOrderId,
      });

      if (result.isPaid) {
        await handlePaymentSuccessful();
      }
    } catch (err) {
      // Background poll silently continues
      console.debug("Auto-poll verification ping:", err.message);
    }
  }, 3500);
}

/**
 * Clears active polling timer
 */
function stopVerificationPolling() {
  if (activePollInterval) {
    clearInterval(activePollInterval);
    activePollInterval = null;
  }
}

/**
 * Handles successful verified payment
 */
async function handlePaymentSuccessful() {
  if (isPaymentVerified) return;
  isPaymentVerified = true;
  stopVerificationPolling();

  const toast = document.getElementById("paymongo-status-toast");
  const verifyBtn = document.getElementById("paymongo-verify-btn");
  const saveBtn = document.getElementById("paymongo-save-qr-btn");

  if (toast) {
    toast.className = "paymongo-status-toast success";
    toast.textContent = "✓ 30% Downpayment Verified! Finalizing your order...";
  }

  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.style.background = "#10B981";
    verifyBtn.style.borderColor = "#10B981";
    verifyBtn.style.color = "#ffffff";
    verifyBtn.textContent = "PAYMENT VERIFIED ✓";
  }

  if (saveBtn) {
    saveBtn.disabled = true;
  }

  const finishedOrderId = currentOrderId;

  // Execute post-verification atomic order creation gate if provided
  if (typeof modalOnConfirmPaymentCallback === "function") {
    try {
      await modalOnConfirmPaymentCallback({
        paymentIntentId: currentPaymentIntentId,
        orderId: finishedOrderId,
        downpaymentPhp: currentDownpaymentPhp,
      });
      if (toast) {
        toast.className = "paymongo-status-toast success";
        toast.textContent = "✓ Order Placed Successfully! Redirecting to orders...";
      }
    } catch (commitErr) {
      console.error("Post-verification order placement error:", commitErr);
      isPaymentVerified = false; // Allow retry
      if (toast) {
        toast.className = "paymongo-status-toast error";
        toast.textContent = `Payment verified, but order placement failed: ${commitErr.message}. Please click to retry.`;
      }
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.style.background = "#FFD700";
        verifyBtn.style.borderColor = "#FFD700";
        verifyBtn.style.color = "#000000";
        verifyBtn.textContent = "RETRY ORDER PLACEMENT";
      }
      return;
    }
  }

  setTimeout(() => {
    closePaymongoQrModal(false);
    if (typeof modalOnSuccessCallback === "function") {
      modalOnSuccessCallback(finishedOrderId);
    } else {
      window.location.href = `orders.html?orderId=${encodeURIComponent(finishedOrderId)}&payment=success`;
    }
  }, 1200);
}

/**
 * Closes the PayMongo QR Ph Modal cleanly
 */
export function closePaymongoQrModal(isDismissedByUser = true) {
  stopVerificationPolling();
  const modal = document.getElementById("paymongo-qr-modal");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
    modal.style.visibility = "hidden";
    modal.style.opacity = "0";
    modal.style.pointerEvents = "none";
  }
  const wasVerified = isPaymentVerified;
  const isDismissed = typeof isDismissedByUser === "boolean" ? isDismissedByUser : true;
  if (typeof modalOnCloseCallback === "function") {
    modalOnCloseCallback({ wasPaid: wasVerified, isDismissed: isDismissed });
  }
}

/**
 * Opens the Live PayMongo QR Ph Modal with dynamic backend generation
 */
export async function openPaymongoQrModal({
  orderId,
  totalAmount,
  onConfirmPayment,
  onSuccess,
  onClose,
}) {
  const modal = ensurePaymongoModalDom();
  currentOrderId = String(orderId).trim();
  isPaymentVerified = false;
  modalOnConfirmPaymentCallback = onConfirmPayment || null;
  modalOnSuccessCallback = onSuccess || null;
  modalOnCloseCallback = onClose || null;

  // Reset modal state
  const orderRefEl = document.getElementById("paymongo-order-ref");
  const amountDisplayEl = document.getElementById("paymongo-amount-display");
  const qrImg = document.getElementById("paymongo-qr-img");
  const spinner = document.getElementById("paymongo-qr-spinner");
  const toast = document.getElementById("paymongo-status-toast");
  const verifyBtn = document.getElementById("paymongo-verify-btn");
  const saveBtn = document.getElementById("paymongo-save-qr-btn");

  const expectedDownpayment = Math.round(Number(totalAmount) * 0.30);
  if (orderRefEl) orderRefEl.textContent = `Order #${currentOrderId}`;
  if (amountDisplayEl) amountDisplayEl.textContent = `₱${expectedDownpayment.toLocaleString()}`;

  if (qrImg) qrImg.style.display = "none";
  if (spinner) spinner.style.display = "block";
  if (toast) {
    toast.className = "paymongo-status-toast polling";
    toast.textContent = "Generating official PayMongo QR Ph code...";
  }

  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.style.background = "#FFD700";
    verifyBtn.style.borderColor = "#FFD700";
    verifyBtn.style.color = "#000000";
    verifyBtn.textContent = "VERIFY & SUBMIT";
  }
  if (saveBtn) saveBtn.disabled = true;

  // Show modal with explicit visibility and flex display
  modal.style.display = "flex";
  modal.style.visibility = "visible";
  modal.style.opacity = "1";
  modal.style.pointerEvents = "auto";
  void modal.offsetWidth;
  modal.classList.add("active");
  wirePaymongoModalEvents(modal);

  try {
    // Generate QR Ph via Backend
    const qrResult = await createPaymongoQrPayment({
      orderId: currentOrderId,
      totalAmount: totalAmount,
    });

    currentPaymentIntentId = qrResult.paymentIntentId;
    currentQrImageUrl = qrResult.qrImageUrl;
    currentDownpaymentPhp = qrResult.downpaymentPhp;

    if (amountDisplayEl) {
      amountDisplayEl.textContent = `₱${currentDownpaymentPhp.toLocaleString()}`;
    }

    if (qrImg) {
      qrImg.src = currentQrImageUrl;
      qrImg.onload = () => {
        if (spinner) spinner.style.display = "none";
        qrImg.style.display = "block";
      };
    }

    if (verifyBtn) verifyBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;

    if (toast) {
      toast.className = "paymongo-status-toast polling";
      toast.textContent = "Awaiting payment (Auto-verifying every 3s)...";
    }

    // Start 3.5-second polling
    startVerificationPolling();
  } catch (err) {
    console.error("Failed to initialize PayMongo QR modal:", err);
    if (spinner) spinner.style.display = "none";
    if (toast) {
      toast.className = "paymongo-status-toast error";
      toast.textContent = err.message || "Failed to generate PayMongo QR Ph. Please try again.";
    }
  }
}
