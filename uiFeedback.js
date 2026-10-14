/**
 * uiFeedback.js - Lanica Luxury UI/UX Toast & Modal Notification System
 * Replaces plain browser alert(), confirm(), and prompt() dialogs
 * with branded, animated, accessible, high-end UI components.
 */

// Helper to escape HTML and prevent injection
function escapeHtml(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --------------------------------------------------------------------------
// 1. TOAST NOTIFICATIONS
// --------------------------------------------------------------------------

function getOrCreateToastContainer() {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

const TOAST_ICONS = {
  success: `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 6L9 17l-5-5"/>
    </svg>`,
  error: `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="6"/>
    </svg>`,
  warning: `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
  info: `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>`,
};

/**
 * Display a luxury Lanica toast notification.
 * @param {string} message - Text to display
 * @param {"success"|"error"|"warning"|"info"} [type="info"]
 * @param {number} [duration=3800] - Duration in ms before auto-dismiss
 */
export function showToast(message, type = "info", duration = 3800) {
  if (!message) return;
  const container = getOrCreateToastContainer();
  const validTypes = ["success", "error", "warning", "info"];
  const toastType = validTypes.includes(type) ? type : "info";

  const toast = document.createElement("div");
  toast.className = `ui-toast ${toastType}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  const iconMarkup = TOAST_ICONS[toastType] || TOAST_ICONS.info;

  toast.innerHTML = `
    <div class="ui-toast-icon">${iconMarkup}</div>
    <div class="ui-toast-content">${escapeHtml(message)}</div>
    <button type="button" class="ui-toast-close" aria-label="Dismiss notification">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="6"/>
      </svg>
    </button>
    <div class="ui-toast-progress" style="animation-duration: ${duration}ms"></div>
  `;

  container.appendChild(toast);

  // Trigger entrance transition
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  let dismissTimeout = null;
  let remainingTime = duration;
  let startTime = Date.now();

  const dismiss = () => {
    if (toast.classList.contains("hiding")) return;
    toast.classList.remove("visible");
    toast.classList.add("hiding");
    setTimeout(() => {
      try {
        toast.remove();
      } catch (_) {}
    }, 280);
  };

  const startTimer = (ms) => {
    startTime = Date.now();
    dismissTimeout = setTimeout(dismiss, ms);
  };

  startTimer(duration);

  // Pause on hover
  toast.addEventListener("mouseenter", () => {
    clearTimeout(dismissTimeout);
    remainingTime -= Date.now() - startTime;
    const progressBar = toast.querySelector(".ui-toast-progress");
    if (progressBar) progressBar.style.animationPlayState = "paused";
  });

  toast.addEventListener("mouseleave", () => {
    if (remainingTime > 0) {
      startTimer(remainingTime);
      const progressBar = toast.querySelector(".ui-toast-progress");
      if (progressBar) progressBar.style.animationPlayState = "running";
    } else {
      dismiss();
    }
  });

  // Manual close button
  const closeBtn = toast.querySelector(".ui-toast-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTimeout(dismissTimeout);
      dismiss();
    });
  }

  return toast;
}

// --------------------------------------------------------------------------
// 2. MODAL CONFIRMATION DIALOG
// --------------------------------------------------------------------------

const MODAL_ICONS = {
  warning: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
  delete: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18"/>
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      <line x1="10" x2="10" y1="11" y2="17"/>
      <line x1="14" x2="14" y1="11" y2="17"/>
    </svg>`,
  logout: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>`,
  info: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>`,
  question: `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>`,
};

/**
 * Display a luxury confirmation dialog. Returns a Promise resolving to true or false.
 * @param {Object} options
 * @param {string} [options.title="Confirm Action"]
 * @param {string} options.message
 * @param {string} [options.confirmText="Confirm"]
 * @param {string} [options.cancelText="Cancel"]
 * @param {boolean} [options.isDestructive=false]
 * @param {"warning"|"delete"|"logout"|"info"|"question"} [options.icon]
 * @returns {Promise<boolean>}
 */
export function showConfirmModal({
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDestructive = false,
  icon = null,
} = {}) {
  return new Promise((resolve) => {
    const iconKey = icon || (isDestructive ? "delete" : "question");
    const iconSvg = MODAL_ICONS[iconKey] || MODAL_ICONS.question;

    const backdrop = document.createElement("div");
    backdrop.className = "ui-dialog-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    backdrop.innerHTML = `
      <div class="ui-dialog-card">
        <div class="ui-dialog-header">
          <div class="ui-dialog-avatar ${isDestructive ? "destructive" : "info"}">
            ${iconSvg}
          </div>
          <div class="ui-dialog-header-text">
            <h3 class="ui-dialog-title">${escapeHtml(title)}</h3>
            <p class="ui-dialog-message">${escapeHtml(message)}</p>
          </div>
        </div>
        <div class="ui-dialog-footer">
          <button type="button" class="ui-dialog-btn ui-dialog-btn-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="ui-dialog-btn ui-dialog-btn-confirm ${isDestructive ? "destructive" : ""}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("active"));

    const card = backdrop.querySelector(".ui-dialog-card");
    const confirmBtn = backdrop.querySelector(".ui-dialog-btn-confirm");
    const cancelBtn = backdrop.querySelector(".ui-dialog-btn-cancel");

    // Focus primary button
    setTimeout(() => {
      if (isDestructive) {
        cancelBtn?.focus();
      } else {
        confirmBtn?.focus();
      }
    }, 50);

    const cleanup = (result) => {
      backdrop.classList.remove("active");
      document.removeEventListener("keydown", onKeyDown);
      setTimeout(() => {
        try {
          backdrop.remove();
        } catch (_) {}
      }, 250);
      resolve(result);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      } else if (e.key === "Enter" && document.activeElement !== cancelBtn) {
        e.preventDefault();
        cleanup(true);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    confirmBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));

    // Outside click shake effect
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        card.classList.remove("modal-content-shake");
        void card.offsetWidth;
        card.classList.add("modal-content-shake");
      }
    });
  });
}

// --------------------------------------------------------------------------
// 3. MODAL ALERT DIALOG
// --------------------------------------------------------------------------

/**
 * Display a luxury alert dialog with a single "Acknowledge" button.
 * @param {Object|string} options - Message string or options object
 * @returns {Promise<void>}
 */
export function showAlertModal(options) {
  const opts = typeof options === "string" ? { message: options } : options || {};
  const {
    title = "Notification",
    message = "",
    confirmText = "Understood",
    type = "info",
  } = opts;

  return new Promise((resolve) => {
    const iconSvg = MODAL_ICONS[type] || MODAL_ICONS.info;

    const backdrop = document.createElement("div");
    backdrop.className = "ui-dialog-backdrop";
    backdrop.setAttribute("role", "alertdialog");
    backdrop.setAttribute("aria-modal", "true");

    backdrop.innerHTML = `
      <div class="ui-dialog-card">
        <div class="ui-dialog-header">
          <div class="ui-dialog-avatar info">
            ${iconSvg}
          </div>
          <div class="ui-dialog-header-text">
            <h3 class="ui-dialog-title">${escapeHtml(title)}</h3>
            <p class="ui-dialog-message">${escapeHtml(message)}</p>
          </div>
        </div>
        <div class="ui-dialog-footer">
          <button type="button" class="ui-dialog-btn ui-dialog-btn-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("active"));

    const confirmBtn = backdrop.querySelector(".ui-dialog-btn-confirm");
    setTimeout(() => confirmBtn?.focus(), 50);

    const cleanup = () => {
      backdrop.classList.remove("active");
      document.removeEventListener("keydown", onKeyDown);
      setTimeout(() => {
        try {
          backdrop.remove();
        } catch (_) {}
      }, 250);
      resolve();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        cleanup();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    confirmBtn.addEventListener("click", cleanup);
  });
}

// --------------------------------------------------------------------------
// 4. MODAL PROMPT DIALOG
// --------------------------------------------------------------------------

/**
 * Display a luxury text prompt modal. Returns a Promise resolving to string value or null if cancelled.
 * @param {Object} options
 * @param {string} [options.title="Input Required"]
 * @param {string} options.message
 * @param {string} [options.placeholder=""]
 * @param {string} [options.defaultValue=""]
 * @param {string} [options.inputType="text"]
 * @param {string} [options.confirmText="Submit"]
 * @param {string} [options.cancelText="Cancel"]
 * @returns {Promise<string|null>}
 */
export function showPromptModal({
  title = "Input Required",
  message = "Please enter your details:",
  placeholder = "",
  defaultValue = "",
  inputType = "text",
  confirmText = "Submit",
  cancelText = "Cancel",
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "ui-dialog-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    backdrop.innerHTML = `
      <div class="ui-dialog-card">
        <div class="ui-dialog-header">
          <div class="ui-dialog-avatar info">
            ${MODAL_ICONS.question}
          </div>
          <div class="ui-dialog-header-text">
            <h3 class="ui-dialog-title">${escapeHtml(title)}</h3>
            <p class="ui-dialog-message">${escapeHtml(message)}</p>
          </div>
        </div>
        <div class="ui-dialog-input-wrap">
          <input
            type="${escapeHtml(inputType)}"
            class="ui-dialog-input"
            placeholder="${escapeHtml(placeholder)}"
            value="${escapeHtml(defaultValue)}"
            autocomplete="off"
          />
        </div>
        <div class="ui-dialog-footer">
          <button type="button" class="ui-dialog-btn ui-dialog-btn-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="ui-dialog-btn ui-dialog-btn-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("active"));

    const input = backdrop.querySelector(".ui-dialog-input");
    const confirmBtn = backdrop.querySelector(".ui-dialog-btn-confirm");
    const cancelBtn = backdrop.querySelector(".ui-dialog-btn-cancel");

    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 60);

    const cleanup = (val) => {
      backdrop.classList.remove("active");
      document.removeEventListener("keydown", onKeyDown);
      setTimeout(() => {
        try {
          backdrop.remove();
        } catch (_) {}
      }, 250);
      resolve(val);
    };

    const submit = () => {
      const val = input ? input.value.trim() : "";
      cleanup(val);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    confirmBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => cleanup(null));
  });
}

// --------------------------------------------------------------------------
// 5. GLOBAL ATTACHMENTS & SAFETY OVERRIDES
// --------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.showToast = showToast;
  window.showConfirmModal = showConfirmModal;
  window.showAlertModal = showAlertModal;
  window.showPromptModal = showPromptModal;

  // Short aliases for maximum compatibility
  window.showConfirm = showConfirmModal;
  window.showAlert = showAlertModal;
  window.showPrompt = showPromptModal;

  // Global safety fallback for any rogue alert() calls:
  // Intercept window.alert so that raw browser popups NEVER show!
  window.alert = function (msg) {
    console.info("[Lanica UI Intercept] alert() intercepted:", msg);
    showToast(typeof msg === "object" ? JSON.stringify(msg) : String(msg), "info");
  };
}
