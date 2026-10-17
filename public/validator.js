/**
 * validator.js - Comprehensive Input Sanitization, Keystroke Guarding & Boundary Validation
 * Lanica Furniture Web Application (Customer, Staff, and Admin)
 */

export const Validators = {
  /**
   * Philippine Mobile Numbers
   * Matches: 09XXXXXXXXX (11 digits), +639XXXXXXXXX (13 chars), 639XXXXXXXXX (12 digits)
   */
  isPhilippinePhone(val) {
    if (!val || typeof val !== "string") return false;
    const cleaned = val.replace(/[\s\-().]/g, "");
    return /^(\+639|639|09)\d{9}$/.test(cleaned);
  },

  /**
   * Normalizes any valid Philippine phone number into standard local (09XXXXXXXXX) or international format (+639XXXXXXXXX)
   */
  normalizePhilippinePhone(val, international = false) {
    if (!this.isPhilippinePhone(val)) return null;
    const cleaned = val.replace(/[\s\-().]/g, "");
    let digits10 = "";
    if (cleaned.startsWith("+639")) {
      digits10 = cleaned.slice(3); // 9XXXXXXXXX
    } else if (cleaned.startsWith("639")) {
      digits10 = cleaned.slice(2); // 9XXXXXXXXX
    } else if (cleaned.startsWith("09")) {
      digits10 = cleaned.slice(1); // 9XXXXXXXXX
    } else {
      return null;
    }
    return international ? `+63${digits10}` : `0${digits10}`;
  },

  /**
   * Philippine Postal Code (Strictly 4 digits, 1000 - 9999)
   */
  isPhilippinePostalCode(val) {
    if (!val) return false;
    const trimmed = String(val).trim();
    return /^[1-9]\d{3}$/.test(trimmed);
  },

  /**
   * Person & Recipient Names (Letters, spaces, hyphens, periods, apostrophes, 2 to 60 chars)
   * Strictly disallows numbers, HTML/script tags, and random symbols.
   */
  isValidName(val) {
    if (!val || typeof val !== "string") return false;
    const trimmed = val.trim();
    if (trimmed.length < 2 || trimmed.length > 60) return false;
    return /^[A-Za-zÀ-ÿ\s.\'-]+$/.test(trimmed);
  },

  /**
   * Standard Email Format (RFC 5322 compliant subset)
   */
  isValidEmail(val) {
    if (!val || typeof val !== "string") return false;
    const trimmed = val.trim();
    if (trimmed.length < 5 || trimmed.length > 100) return false;
    return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(trimmed);
  },

  /**
   * Positive Integer Quantities (1 to maxLimit)
   */
  isValidQuantity(val, maxLimit = 30) {
    const num = Number(val);
    return Number.isInteger(num) && num >= 1 && num <= maxLimit;
  },

  /**
   * Product Price & Monetary Amounts (Positive number, min to max)
   */
  isValidCurrency(val, min = 1, max = 5000000) {
    const num = Number(String(val).replace(/,/g, "").trim());
    return !isNaN(num) && isFinite(num) && num >= min && num <= max;
  },

  /**
   * Product Dimensions (Height, Width, Length in inches/cm: positive number up to 1500)
   */
  isValidDimension(val, max = 1500) {
    const num = parseFloat(val);
    return !isNaN(num) && isFinite(num) && num > 0 && num <= max;
  },

  /**
   * Whitelisted Role Check
   */
  isValidRole(role) {
    const allowed = ["customer", "staff", "admin"];
    return allowed.includes(String(role || "").trim().toLowerCase());
  },

  /**
   * Sanitize text against control characters, XSS script tags, and enforce length boundaries
   */
  sanitizeText(val, maxLength = 250) {
    if (!val) return "";
    return String(val)
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, maxLength);
  }
};

// =========================================================================
// FIELD IDENTIFIERS & DETECTORS
// =========================================================================

export function isNameField(el) {
  if (!el) return false;
  const id = (el.id || "").toLowerCase();
  const name = (el.name || "").toLowerCase();
  const placeholder = (el.placeholder || "").toLowerCase();
  const autocomplete = (el.autocomplete || "").toLowerCase();
  const dtype = (el.getAttribute("data-input-type") || "").toLowerCase();

  if (dtype === "name") return true;
  if (autocomplete === "name") return true;

  return (
    id === "reg-name" ||
    id === "addr-name" ||
    id === "addr-recipient" ||
    id === "edit-full-name" ||
    id === "staff-display-name" ||
    id === "role-modal-user-name" ||
    id === "customer-name" ||
    placeholder.includes("juan dela cruz") ||
    placeholder.includes("heidi amatorio") ||
    (placeholder.includes("full name") && !placeholder.includes("product")) ||
    (id.includes("name") &&
      !id.includes("category") &&
      !id.includes("product") &&
      !id.includes("addon") &&
      !id.includes("size") &&
      !id.includes("file") &&
      !id.includes("brand"))
  );
}

export function isPhoneField(el) {
  if (!el) return false;
  const id = (el.id || "").toLowerCase();
  const name = (el.name || "").toLowerCase();
  const type = (el.type || "").toLowerCase();
  const placeholder = (el.placeholder || "").toLowerCase();
  const dtype = (el.getAttribute("data-input-type") || "").toLowerCase();

  if (dtype === "phone") return true;

  return (
    type === "tel" ||
    id === "addr-phone" ||
    id === "edit-phone-number" ||
    id.includes("phone") ||
    name.includes("phone") ||
    id.includes("contact") ||
    placeholder.includes("0917") ||
    placeholder.includes("+639")
  );
}

export function isZipField(el) {
  if (!el) return false;
  const id = (el.id || "").toLowerCase();
  const name = (el.name || "").toLowerCase();
  const placeholder = (el.placeholder || "").toLowerCase();
  const dtype = (el.getAttribute("data-input-type") || "").toLowerCase();

  if (dtype === "zip") return true;

  return (
    id === "addr-zip" ||
    id.includes("zip") ||
    name.includes("zip") ||
    id.includes("postal") ||
    placeholder.includes("4027")
  );
}

export function isCityOrProvinceField(el) {
  if (!el) return false;
  const id = (el.id || "").toLowerCase();
  return id === "addr-city" || id === "addr-province";
}

// =========================================================================
// REAL-TIME INPUT GUARDS & KEYSTROKE FILTERS
// =========================================================================

export function initGlobalInputGuards() {
  if (typeof document === "undefined") return;
  if (window.__lanicaGuardsInitialized) return;
  window.__lanicaGuardsInitialized = true;

  // Real-time input event (handles typing, pasting, autofill, voice-to-text, drag-drop)
  document.addEventListener(
    "input",
    (e) => {
      const target = e.target;
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return;

      // 1. NAME FIELDS: Strictly letters, spaces, hyphens, periods, apostrophes only. NO NUMBERS!
      if (isNameField(target)) {
        const raw = target.value;
        const cleaned = raw.replace(/[^A-Za-zÀ-ÿ\s.\'-]/g, "").slice(0, 60);
        if (raw !== cleaned) {
          const start = target.selectionStart;
          target.value = cleaned;
          if (target.setSelectionRange && start !== null) {
            target.setSelectionRange(Math.min(start, cleaned.length), Math.min(start, cleaned.length));
          }
        }
        return;
      }

      // 2. PHONE FIELDS: Strictly digits and leading '+' only. NO LETTERS!
      if (isPhoneField(target)) {
        const raw = target.value;
        let cleaned = raw.replace(/[^\d+]/g, "");
        if (cleaned.includes("+")) {
          const startsWithPlus = cleaned.startsWith("+");
          cleaned = (startsWithPlus ? "+" : "") + cleaned.replace(/\+/g, "");
        }
        cleaned = cleaned.slice(0, 13);
        if (raw !== cleaned) {
          target.value = cleaned;
        }
        return;
      }

      // 3. ZIP CODE FIELDS: Strictly 4 digits (0-9 only). NO LETTERS!
      if (isZipField(target)) {
        const raw = target.value;
        const cleaned = raw.replace(/\D/g, "").slice(0, 4);
        if (raw !== cleaned) {
          target.value = cleaned;
        }
        return;
      }

      // 4. CITY / PROVINCE: Strictly letters, spaces, hyphens, periods. NO NUMBERS!
      if (isCityOrProvinceField(target)) {
        const raw = target.value;
        const cleaned = raw.replace(/[^A-Za-zÀ-ÿ\s.\'-]/g, "").slice(0, 50);
        if (raw !== cleaned) {
          target.value = cleaned;
        }
        return;
      }

      // 5. ADDON / BED-SIZE NAME FIELDS: Max 60 characters, strip dangerous brackets
      if (
        target.classList.contains("addon-input-name") ||
        target.classList.contains("bed-size-input-name")
      ) {
        const raw = target.value;
        const cleaned = raw.replace(/[<>]/g, "").slice(0, 60);
        if (raw !== cleaned) {
          target.value = cleaned;
        }
        return;
      }

      // 6. ADDON / BED-SIZE PRICE FIELDS: Strictly non-negative, limit length to 7 digits
      if (
        target.classList.contains("addon-input-price") ||
        target.classList.contains("bed-size-input-price")
      ) {
        let val = target.value;
        if (val && parseFloat(val) < 0) {
          target.value = "0";
        } else if (val.length > 7) {
          target.value = val.slice(0, 7);
        }
        return;
      }

      // 7. PRODUCT PRICE INPUT (Admin)
      if (target.id === "product-price") {
        let val = target.value;
        if (val.length > 8) {
          target.value = val.slice(0, 8);
        }
        return;
      }

      // 8. GENERAL NUMERIC FIELDS: disallow scientific notation 'e' or negative where min="0"
      if (target.type === "number") {
        if (target.min === "0" && parseFloat(target.value) < 0) {
          target.value = "0";
        }
        if (target.max && target.value.length > String(target.max).length + 3) {
          target.value = target.value.slice(0, String(target.max).length);
        }
      }
    },
    true
  );

  // Keydown guard to immediately block invalid keystrokes before they hit the DOM
  document.addEventListener(
    "keydown",
    (e) => {
      const target = e.target;
      if (!target || target.tagName !== "INPUT") return;

      // Control keys (Shift, Backspace, Tab, Enter, Arrows, Delete, Copy/Paste) are ALWAYS allowed
      if (
        e.key.length > 1 ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }

      // In Name field: block digits (0-9) and symbol keys immediately
      if (isNameField(target)) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (!/^[A-Za-zÀ-ÿ\s.\'-]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (target.value.length >= 60 && target.selectionStart === target.selectionEnd) {
          e.preventDefault();
          return;
        }
      }

      // In City / Province field: block digits (0-9)
      if (isCityOrProvinceField(target)) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (!/^[A-Za-zÀ-ÿ\s.\'-]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (target.value.length >= 50 && target.selectionStart === target.selectionEnd) {
          e.preventDefault();
          return;
        }
      }

      // In Phone field: block letters and symbols other than '+'
      if (isPhoneField(target)) {
        if (e.key === "+") {
          if (target.value.length > 0 && target.selectionStart !== 0) {
            e.preventDefault();
          }
          return;
        }
        if (!/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (target.value.length >= 13 && target.selectionStart === target.selectionEnd) {
          e.preventDefault();
          return;
        }
      }

      // In Zip field: block any non-digit
      if (isZipField(target)) {
        if (!/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          return;
        }
        if (target.value.length >= 4 && target.selectionStart === target.selectionEnd) {
          e.preventDefault();
          return;
        }
      }

      // In Number fields: block 'e', 'E', '+', '-' (if non-negative)
      if (target.type === "number") {
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          return;
        }
        if ((target.min === "0" || target.min === "0.01") && (e.key === "-" || e.key === "+")) {
          e.preventDefault();
          return;
        }
      }
    },
    true
  );

  // Paste guard for instant sanitization upon clipboard paste
  document.addEventListener(
    "paste",
    (e) => {
      const target = e.target;
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return;

      if (isNameField(target)) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        const cleaned = text.replace(/[^A-Za-zÀ-ÿ\s.\'-]/g, "");
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const current = target.value;
        const next = (current.slice(0, start) + cleaned + current.slice(end)).slice(0, 60);
        target.value = next;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      if (isCityOrProvinceField(target)) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        const cleaned = text.replace(/[^A-Za-zÀ-ÿ\s.\'-]/g, "");
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const current = target.value;
        const next = (current.slice(0, start) + cleaned + current.slice(end)).slice(0, 50);
        target.value = next;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      if (isPhoneField(target)) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        let cleaned = text.replace(/[^\d+]/g, "");
        if (cleaned.includes("+")) {
          const startsWithPlus = cleaned.startsWith("+");
          cleaned = (startsWithPlus ? "+" : "") + cleaned.replace(/\+/g, "");
        }
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const current = target.value;
        const next = (current.slice(0, start) + cleaned + current.slice(end)).slice(0, 13);
        target.value = next;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }

      if (isZipField(target)) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        const cleaned = text.replace(/\D/g, "");
        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const current = target.value;
        const next = (current.slice(0, start) + cleaned + current.slice(end)).slice(0, 4);
        target.value = next;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    },
    true
  );
}

// Automatically initialize input guards on DOM load
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initGlobalInputGuards());
  } else {
    initGlobalInputGuards();
  }
}
