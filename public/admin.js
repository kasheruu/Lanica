import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  Timestamp,
  where,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  reload,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";
import {
  subscribeToAllChats,
  subscribeToMessages,
  sendChatMessage,
  uploadChatAttachment,
  markOrderMessagesAsRead,
} from "./chatService.js";

import {
  renderPagination,
  showTableSkeleton,
  renderTableEmptyState,
} from "./paginationService.js";

import { compressAndResizeImage } from "./imageOptimizationService.js";

import {
  logActivity,
  fetchAuditLogs,
} from "./auditService.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAb2kDAVp9N_afxgOw5hSzDIvQ3UAIZVNU",
  authDomain: "jobsync-745a6.firebaseapp.com",
  projectId: "jobsync-745a6",
  storageBucket: "jobsync-745a6.firebasestorage.app",
  messagingSenderId: "845585113791",
  appId: "1:845585113791:web:921482be545bb9604ddc0a",
  measurementId: "G-LQ41PCS4HD",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const MESHY_API_BASE = "/api/meshy-image-to-3d";

let currentUser = null;

// Protect Admin Route (admin role only)
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  currentUser = user;

  try {
    await reload(user);
  } catch (e) {
    console.warn("Could not reload auth user:", e);
  }
  if (!user.emailVerified) {
    window.location.replace("/login.html");
    return;
  }

  const role = await getUserRole(user);

  // Debug logging
  console.log("=== ADMIN PAGE AUTH DEBUG ===");
  console.log("Admin page - User UID:", user.uid);
  console.log("Admin page - User Email:", user.email);
  console.log("Admin page - Detected Role:", role);
  console.log("Admin page - Role type:", typeof role);
  console.log("Admin page - Current URL:", window.location.href);

  // Only allow admin users on admin page
  if (role === null || role === undefined || role === "") {
    console.warn(" ADMIN PAGE - Role not found, redirecting to login");
    window.location.replace("/login.html");
    return;
  } else if (role !== "admin") {
    console.log(
      " ADMIN PAGE - Non-admin user detected, redirecting to appropriate page. Role:",
      role
    );
    if (role === "staff") {
      console.log(" Redirecting staff user to staff page");
      window.location.replace("/staff.html");
    } else {
      console.log(" Redirecting customer to main site");
      window.location.replace("/index.html"); // Redirect customers to main site
    }
    return;
  } else {
    console.log(" ADMIN PAGE - Admin user confirmed, staying on admin page");
    loadStaffMembers();
  }

  // If role is null/undefined, stay on admin page and let the user see what happens
  // This prevents the infinite redirect loop
});

const productsCollection = collection(db, "products");

// Global Shared State
let allProducts = [];
let staffMembers = [];

// DOM Elements
const addProductBtn = document.getElementById("add-product-btn");
const modalOverlay = document.getElementById("product-modal");
const closeModalBtn = document.getElementById("close-modal");
const cancelBtn = document.getElementById("cancel-btn");
const productForm = document.getElementById("product-form");
const inventoryList = document.getElementById("inventory-list");
const submitBtn = document.querySelector('#product-form button[type="submit"]');
const productModal = document.getElementById("product-modal"); // Assuming modalOverlay is productModal

// Stat Elements
const totalProductsStat = document.getElementById("total-products");
const lowStockStat = document.getElementById("low-stock");
const totalValueStat = document.getElementById("total-value");
const analyticsCashCollectedEl = document.getElementById("analytics-cash-collected");
const analyticsBalanceDueEl = document.getElementById("analytics-balance-due");
const ordersBalanceDueEl = document.getElementById("orders-balance-due");
const analyticsMtoCountBadgeEl = document.getElementById("analytics-mto-count-badge");
const analyticsMtoSubEl = document.getElementById("analytics-mto-sub");
const analyticsTotalUnitsEl = document.getElementById("analytics-total-units");
const analyticsOutOfStockEl = document.getElementById("analytics-out-of-stock");
const analyticsAvgPriceEl = document.getElementById("analytics-avg-price");
const analyticsAvgStockEl = document.getElementById("analytics-avg-stock");
const analyticsMaterialBarsEl = document.getElementById("analytics-material-bars");
const analyticsCategoryBarsEl = document.getElementById("analytics-category-bars");
const analyticsLowStockListEl = document.getElementById("analytics-low-stock-list");
const ordersDateStartEl = document.getElementById("orders-date-start");
const ordersDateEndEl = document.getElementById("orders-date-end");
const ordersRevenueGraphEl = document.getElementById("orders-revenue-graph");
const ordersTotalRevenueEl = document.getElementById("orders-total-revenue");
const ordersTotalProfitEl = document.getElementById("orders-total-profit");
const ordersDateValidationEl = document.getElementById("orders-date-validation");
const exportAnalyticsPdfBtn = document.getElementById("export-analytics-pdf-btn");
const analyticsExportArea = document.getElementById("analytics-export-area");

// Auto-resize description text area
const productDescriptionTextarea = document.getElementById("product-description");
if (productDescriptionTextarea) {
  productDescriptionTextarea.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  });
}

// ==========================================================================
// Custom Materials Input / Tags Field & Dynamic Quick Add (with Limit & Remove)
// ==========================================================================
const QUICK_ADD_LIMIT = 8;
const DEFAULT_QUICK_ADD_MATERIALS = [
  "Solid Oak",
  "Tempered Glass",
  "Linen blend",
  "Velvet",
  "Italian Leather",
  "Mahogany",
  "Bouclé",
  "Stainless Steel"
];

function loadQuickAddMaterials() {
  try {
    const raw = localStorage.getItem("lanica_quick_add_materials");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, QUICK_ADD_LIMIT);
      }
    }
  } catch (err) {
    console.warn("Could not load quick add materials from localStorage:", err);
  }
  return [...DEFAULT_QUICK_ADD_MATERIALS];
}

function saveQuickAddMaterials(list) {
  try {
    const capped = list.slice(0, QUICK_ADD_LIMIT);
    localStorage.setItem("lanica_quick_add_materials", JSON.stringify(capped));
  } catch (err) {
    console.warn("Could not save quick add materials to localStorage:", err);
  }
}

let quickAddMaterials = loadQuickAddMaterials();
let currentMaterialTags = [];
const materialTagsList = document.getElementById("material-tags-list");
const materialInput = document.getElementById("product-material-input");
const materialHiddenInput = document.getElementById("product-material");
const addMaterialTagBtn = document.getElementById("btn-add-material-tag");
const quickAddMaterialsListEl = document.getElementById("quick-add-materials-list");
const btnResetQuickAdd = document.getElementById("btn-reset-quick-add");

function renderMaterialTags() {
  if (!materialTagsList) return;
  materialTagsList.innerHTML = currentMaterialTags
    .map(
      (tag, idx) => `
      <span class="material-tag-pill">
        ${escapeHtml(tag)}
        <button type="button" class="material-tag-remove" data-index="${idx}" title="Remove material">&times;</button>
      </span>
    `
    )
    .join("");
  if (materialHiddenInput) {
    materialHiddenInput.value = currentMaterialTags.join(", ");
  }
}

function renderQuickAddMaterials() {
  if (!quickAddMaterialsListEl) return;
  if (!quickAddMaterials || quickAddMaterials.length === 0) {
    quickAddMaterialsListEl.innerHTML = `<span style="font-size: 0.75rem; color: #9ca3af; font-style: italic;">No recent suggestions. Click "Reset defaults" to restore.</span>`;
    return;
  }
  quickAddMaterialsListEl.innerHTML = quickAddMaterials
    .map(
      (mat) => `
      <div class="quick-add-chip" data-val="${escapeHtml(mat)}">
        <button type="button" class="quick-add-chip-btn" data-val="${escapeHtml(mat)}" title="Add ${escapeHtml(mat)}">${escapeHtml(mat)}</button>
        <button type="button" class="quick-add-chip-remove" data-val="${escapeHtml(mat)}" title="Remove ${escapeHtml(mat)} from quick add">&times;</button>
      </div>
    `
    )
    .join("");
}

function addRecentQuickAddMaterial(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const existingIdx = quickAddMaterials.findIndex((m) => m.toLowerCase() === clean.toLowerCase());
  if (existingIdx !== -1) {
    quickAddMaterials.splice(existingIdx, 1);
  }
  quickAddMaterials.unshift(clean);
  if (quickAddMaterials.length > QUICK_ADD_LIMIT) {
    quickAddMaterials = quickAddMaterials.slice(0, QUICK_ADD_LIMIT);
  }
  saveQuickAddMaterials(quickAddMaterials);
  renderQuickAddMaterials();
}

function removeQuickAddMaterial(val) {
  if (!val) return;
  quickAddMaterials = quickAddMaterials.filter((m) => m.toLowerCase() !== val.toLowerCase());
  saveQuickAddMaterials(quickAddMaterials);
  renderQuickAddMaterials();
}

function addMaterialTag(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const parts = clean
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  parts.forEach((p) => {
    if (!currentMaterialTags.some((t) => t.toLowerCase() === p.toLowerCase())) {
      currentMaterialTags.push(p);
      addRecentQuickAddMaterial(p);
    }
  });
  renderMaterialTags();
  if (materialInput) materialInput.value = "";
}

function removeMaterialTag(idx) {
  currentMaterialTags.splice(idx, 1);
  renderMaterialTags();
}

function clearMaterialTags() {
  currentMaterialTags = [];
  renderMaterialTags();
  if (materialInput) materialInput.value = "";
}

if (addMaterialTagBtn) {
  addMaterialTagBtn.addEventListener("click", () => {
    if (materialInput) addMaterialTag(materialInput.value);
  });
}

if (materialInput) {
  materialInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addMaterialTag(materialInput.value);
    }
  });
}

if (materialTagsList) {
  materialTagsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".material-tag-remove");
    if (btn) {
      e.preventDefault();
      const idx = parseInt(btn.dataset.index, 10);
      if (!isNaN(idx)) removeMaterialTag(idx);
    }
  });
}

// Event delegations for quick add chips (Add or Remove)
if (quickAddMaterialsListEl) {
  quickAddMaterialsListEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".quick-add-chip-remove");
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = removeBtn.dataset.val;
      removeQuickAddMaterial(val);
      return;
    }
    const addBtn = e.target.closest(".quick-add-chip-btn");
    if (addBtn) {
      e.preventDefault();
      const val = addBtn.dataset.val;
      addMaterialTag(val);
    }
  });
}

if (btnResetQuickAdd) {
  btnResetQuickAdd.addEventListener("click", (e) => {
    e.preventDefault();
    quickAddMaterials = [...DEFAULT_QUICK_ADD_MATERIALS];
    saveQuickAddMaterials(quickAddMaterials);
    renderQuickAddMaterials();
  });
}

// Initial render of quick add chips
renderQuickAddMaterials();

// ==========================================================================
// Dimensions & Size: Real-Time Unit Conversion Logic
// ==========================================================================
const UNIT_TO_CM = {
  cm: 1,
  m: 100,
  in: 2.54,
  ft: 30.48, // 12 * 2.54
};

function convertDimension(val, fromUnit, toUnit) {
  if (fromUnit === toUnit || !UNIT_TO_CM[fromUnit] || !UNIT_TO_CM[toUnit]) return val;
  const cmVal = val * UNIT_TO_CM[fromUnit];
  const targetVal = cmVal / UNIT_TO_CM[toUnit];
  return Math.round(targetVal * 100) / 100;
}

const heightInput = document.getElementById("product-height");
const widthInput = document.getElementById("product-width");
const lengthInput = document.getElementById("product-length");
const length2Input = document.getElementById("product-length2");
const length2Field = document.getElementById("dim-field-length2");
const length1Label = document.getElementById("label-product-length");
const isLTypeSelect = document.getElementById("product-is-ltype");
const unitSelect = document.getElementById("product-unit");
let currentDimensionUnit = unitSelect ? unitSelect.value : "in";

function toggleLTypeFields(isLType) {
  if (length2Field) {
    if (isLType) {
      length2Field.style.display = "block";
      if (length1Label) length1Label.textContent = "Side A Length";
      if (length2Input) length2Input.required = true;
    } else {
      length2Field.style.display = "none";
      if (length1Label) length1Label.textContent = "Length";
      if (length2Input) length2Input.required = false;
    }
  }
}

if (isLTypeSelect) {
  isLTypeSelect.addEventListener("change", () => {
    const isL = isLTypeSelect.value === "true";
    toggleLTypeFields(isL);
    if (typeof triggerDraftAutosave === "function") {
      triggerDraftAutosave();
    }
  });
}

if (unitSelect) {
  unitSelect.addEventListener("change", () => {
    const newUnit = unitSelect.value;
    const oldUnit = currentDimensionUnit;
    if (newUnit !== oldUnit) {
      const h = parseFloat(heightInput.value);
      const w = parseFloat(widthInput.value);
      const l = parseFloat(lengthInput ? lengthInput.value : 0);
      const l2 = parseFloat(length2Input ? length2Input.value : 0);
      if (!isNaN(h) && h > 0) {
        heightInput.value = convertDimension(h, oldUnit, newUnit);
      }
      if (!isNaN(w) && w > 0) {
        widthInput.value = convertDimension(w, oldUnit, newUnit);
      }
      if (!isNaN(l) && l > 0 && lengthInput) {
        lengthInput.value = convertDimension(l, oldUnit, newUnit);
      }
      if (!isNaN(l2) && l2 > 0 && length2Input) {
        length2Input.value = convertDimension(l2, oldUnit, newUnit);
      }
      currentDimensionUnit = newUnit;
      if (typeof triggerDraftAutosave === "function") {
        triggerDraftAutosave();
      }
    }
  });
}

// ==========================================================================
// Multi-Thumbnail Upload & Gallery State Management
// ==========================================================================
let thumbnailItems = []; // Array of { id, file: File|null, url: string }
const thumbnailFileInput = document.getElementById("thumbnail-upload-input");
const addThumbnailBtn = document.getElementById("btn-add-thumbnail");
const thumbnailPreviewsList = document.getElementById("thumbnail-previews-list");
const thumbnailGalleryContainer = document.getElementById("thumbnail-gallery-container");
const thumbnailErrorMsg = document.getElementById("thumbnail-validation-error");

function renderThumbnailPreviews() {
  if (!thumbnailPreviewsList) return;
  if (thumbnailErrorMsg && thumbnailItems.length > 0) {
    thumbnailErrorMsg.style.display = "none";
  }
  thumbnailPreviewsList.innerHTML = thumbnailItems
    .map(
      (item, idx) => `
      <div class="thumbnail-preview-card ${idx === 0 ? "is-primary" : ""}" data-index="${idx}">
        <img src="${item.url}" alt="Thumbnail ${idx + 1}" onerror="this.src='assets/product_sofa.png'" />
        ${idx === 0 ? '<span class="thumb-badge primary">Primary</span>' : `<span class="thumb-badge num">#${idx + 1}</span>`}
        <div class="thumb-actions">
          <button type="button" class="btn-thumb-action move-left" data-index="${idx}" title="Move left" ${idx === 0 ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button type="button" class="btn-thumb-action move-right" data-index="${idx}" title="Move right" ${idx === thumbnailItems.length - 1 ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button type="button" class="btn-thumb-action delete-thumb" data-index="${idx}" title="Remove thumbnail">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `
    )
    .join("");
}

function addThumbnailFiles(files) {
  if (!files || !files.length) return;
  Array.from(files).forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      thumbnailItems.push({
        id: `thumb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        url: e.target.result,
      });
      renderThumbnailPreviews();
      if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
    };
    reader.readAsDataURL(file);
  });
  if (thumbnailFileInput) thumbnailFileInput.value = "";
}

function clearThumbnailItems() {
  thumbnailItems = [];
  renderThumbnailPreviews();
  if (thumbnailFileInput) thumbnailFileInput.value = "";
  if (thumbnailErrorMsg) thumbnailErrorMsg.style.display = "none";
}

if (addThumbnailBtn && thumbnailFileInput) {
  addThumbnailBtn.addEventListener("click", () => {
    thumbnailFileInput.click();
  });
  thumbnailFileInput.addEventListener("change", (e) => {
    addThumbnailFiles(e.target.files);
  });
}

if (thumbnailGalleryContainer) {
  thumbnailGalleryContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
    thumbnailGalleryContainer.classList.add("dragover");
  });
  thumbnailGalleryContainer.addEventListener("dragleave", () => {
    thumbnailGalleryContainer.classList.remove("dragover");
  });
  thumbnailGalleryContainer.addEventListener("drop", (e) => {
    e.preventDefault();
    thumbnailGalleryContainer.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files) {
      addThumbnailFiles(e.dataTransfer.files);
    }
  });
}

if (thumbnailPreviewsList) {
  thumbnailPreviewsList.addEventListener("click", (e) => {
    const leftBtn = e.target.closest(".btn-thumb-action.move-left");
    const rightBtn = e.target.closest(".btn-thumb-action.move-right");
    const deleteBtn = e.target.closest(".btn-thumb-action.delete-thumb");

    if (leftBtn && !leftBtn.disabled) {
      e.preventDefault();
      const idx = parseInt(leftBtn.dataset.index, 10);
      if (idx > 0) {
        const temp = thumbnailItems[idx];
        thumbnailItems[idx] = thumbnailItems[idx - 1];
        thumbnailItems[idx - 1] = temp;
        renderThumbnailPreviews();
        if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
      }
    } else if (rightBtn && !rightBtn.disabled) {
      e.preventDefault();
      const idx = parseInt(rightBtn.dataset.index, 10);
      if (idx < thumbnailItems.length - 1) {
        const temp = thumbnailItems[idx];
        thumbnailItems[idx] = thumbnailItems[idx + 1];
        thumbnailItems[idx + 1] = temp;
        renderThumbnailPreviews();
        if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
      }
    } else if (deleteBtn) {
      e.preventDefault();
      const idx = parseInt(deleteBtn.dataset.index, 10);
      thumbnailItems.splice(idx, 1);
      renderThumbnailPreviews();
      if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
    }
  });
}

// ==========================================================================
// Auto-Formatting Price with Thousands Separator (Commas)
// ==========================================================================
function formatPriceWithCommas(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === "") return "";
  const str = String(rawVal).trim();
  // Strip any characters that are not digits or dot
  const clean = str.replace(/[^0-9.]/g, "");
  if (!clean) return "";

  const parts = clean.split(".");
  let intPart = parts[0];
  const hasDecimal = parts.length > 1;
  const decPart = hasDecimal ? parts.slice(1).join("") : null;

  // Cap integer part at 8 digits (99,999,999) to match max validation
  if (intPart.length > 8) {
    intPart = intPart.slice(0, 8);
  }

  // Remove leading zeros unless it's just "0"
  if (intPart.length > 1 && intPart.startsWith("0")) {
    intPart = intPart.replace(/^0+/, "") || "0";
  }

  // Format integer with commas
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (hasDecimal) {
    // Keep max 2 decimal places for cents
    return `${formattedInt}.${decPart.slice(0, 2)}`;
  }
  return formattedInt;
}

function handlePriceInput(input) {
  if (!input) return;
  const originalVal = input.value;
  const cursorPos = input.selectionStart || originalVal.length;

  // Count non-comma characters before the cursor
  const rawBefore = originalVal.slice(0, cursorPos).replace(/,/g, "");
  const charsBeforeCount = rawBefore.length;

  const formatted = formatPriceWithCommas(originalVal);
  input.value = formatted;

  // Reposition cursor after the same number of raw characters
  let newCursorPos = 0;
  let charsCounted = 0;
  while (newCursorPos < formatted.length && charsCounted < charsBeforeCount) {
    if (formatted[newCursorPos] !== ",") {
      charsCounted++;
    }
    newCursorPos++;
  }
  input.setSelectionRange(newCursorPos, newCursorPos);
}

// Attach auto-comma formatter and backspace handler to product-price
const priceFieldInput = document.getElementById("product-price");
if (priceFieldInput) {
  priceFieldInput.addEventListener("input", () => {
    handlePriceInput(priceFieldInput);
  });
  priceFieldInput.addEventListener("keydown", (e) => {
    if (e.key === "Backspace") {
      const start = priceFieldInput.selectionStart;
      const end = priceFieldInput.selectionEnd;
      // If cursor is right after a comma, delete the digit preceding the comma
      if (start === end && start > 0 && priceFieldInput.value[start - 1] === ",") {
        e.preventDefault();
        const val = priceFieldInput.value;
        priceFieldInput.value = val.slice(0, start - 2) + val.slice(start);
        handlePriceInput(priceFieldInput);
      }
    }
  });
}

// --- Input Validation with Warnings ---
const validationRules = [
  { id: "product-name", max: 100, msg: "Product name cannot exceed 100 characters" },
  { id: "product-description", max: 500, msg: "Description cannot exceed 500 characters" },
  { id: "product-price", max: 99999999, msg: "Price cannot exceed ₱99,999,999" },
  { id: "product-stock", max: 99999, msg: "Stock cannot exceed 99,999 units" },
  { id: "product-height", max: 99999, msg: "Height cannot exceed 99,999" },
  { id: "product-width", max: 99999, msg: "Width cannot exceed 99,999" },
  { id: "product-length", max: 99999, msg: "Length cannot exceed 99,999" },
];

function showWarning(input, message) {
  // Remove existing warning
  const existingWarning = input.parentNode.querySelector(".input-warning");
  if (existingWarning) existingWarning.remove();

  // Create warning element
  const warning = document.createElement("div");
  warning.className = "input-warning";
  warning.textContent = message;
  warning.style.cssText = `
    color: #dc2626;
    font-size: 0.75rem;
    margin-top: 4px;
    font-weight: 500;
  `;
  input.parentNode.appendChild(warning);
  input.style.borderColor = "#dc2626";
}

function clearWarning(input) {
  const warning = input.parentNode.querySelector(".input-warning");
  if (warning) warning.remove();
  input.style.borderColor = "";
}

validationRules.forEach((rule) => {
  const input = document.getElementById(rule.id);
  if (!input) return;

  input.addEventListener("input", () => {
    const value = input.value;
    const length = value.length;

    if (rule.id === "product-name" || rule.id === "product-description") {
      // Character count validation
      if (length > rule.max) {
        showWarning(input, `${rule.msg} (${length}/${rule.max})`);
      } else {
        clearWarning(input);
      }
    } else {
      // Number max validation
      const numVal =
        rule.id === "product-price"
          ? parseFloat(String(value).replace(/,/g, "")) || 0
          : parseFloat(value) || 0;
      if (value && numVal > rule.max) {
        showWarning(input, rule.msg);
        input.value = rule.id === "product-price" ? formatPriceWithCommas(rule.max) : rule.max; // Cap at max
      } else {
        clearWarning(input);
      }
    }
  });

  input.addEventListener("blur", () => {
    clearWarning(input);
  });
});

// Modal state
let isEditing = false;
let currentEditId = null;

// ==========================================================================
// Dynamic Category Management
// ==========================================================================
const CATEGORIES_STORAGE_KEY = "lanica_custom_categories";
const DEFAULT_CATEGORIES = ["Sofa", "Bed", "Living Room", "Bedroom"];

function getStoredCategories() {
  let cats = [];
  try {
    const raw = localStorage.getItem(CATEGORIES_STORAGE_KEY);
    cats = raw ? JSON.parse(raw) : [...DEFAULT_CATEGORIES];
  } catch (e) {
    cats = [...DEFAULT_CATEGORIES];
  }

  if (Array.isArray(allProducts)) {
    allProducts.forEach((p) => {
      if (p.category && !cats.some((c) => c.toLowerCase() === p.category.toLowerCase())) {
        cats.push(p.category);
      }
    });
  }

  const unique = [];
  cats.forEach((c) => {
    const trimmed = (c || "").trim();
    if (trimmed && !unique.some((u) => u.toLowerCase() === trimmed.toLowerCase())) {
      unique.push(trimmed);
    }
  });
  return unique;
}

function saveStoredCategories(cats) {
  try {
    localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(cats));
  } catch (e) {
    console.error("Error saving categories:", e);
  }
}

function ensureCategoryOption(categoryName) {
  const trimmed = (categoryName || "").trim();
  if (!trimmed) return;
  const cats = getStoredCategories();
  if (!cats.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
    cats.push(trimmed);
    saveStoredCategories(cats);
    renderCategoryDropdowns(trimmed);
  }
}

function renderCategoryDropdowns(selectedCategory = null) {
  const cats = getStoredCategories();
  const productCatSelect = document.getElementById("product-category");
  const filterCatSelect = document.getElementById("category-filter");
  const customTriggerName = document.getElementById("custom-cat-selected-name");
  const customTriggerBadge = document.getElementById("custom-cat-selected-badge");
  const customItemsList = document.getElementById("custom-cat-items-list");

  let currentVal = selectedCategory;
  if (!currentVal && productCatSelect) {
    currentVal = productCatSelect.value;
  }
  if (!currentVal && cats.length > 0) {
    currentVal = cats[0];
  }

  // 1. Sync native select options
  if (productCatSelect) {
    productCatSelect.innerHTML = cats
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("");
    if (currentVal && cats.some((c) => c.toLowerCase() === currentVal.toLowerCase())) {
      const match = cats.find((c) => c.toLowerCase() === currentVal.toLowerCase());
      productCatSelect.value = match;
      currentVal = match;
    } else if (cats.length > 0) {
      productCatSelect.value = cats[0];
      currentVal = cats[0];
    }
  }

  // 2. Sync Custom Dropdown Trigger (showing Category Name + Pill Badge)
  if (customTriggerName && currentVal) {
    const count = Array.isArray(allProducts)
      ? allProducts.filter((p) => (p.category || "").toLowerCase() === currentVal.toLowerCase()).length
      : 0;
    customTriggerName.textContent = currentVal;
    if (customTriggerBadge) {
      customTriggerBadge.textContent = `${count} ${count === 1 ? "product" : "products"}`;
      customTriggerBadge.className = `custom-cat-count-badge ${count > 0 ? "has-products" : "zero-products"}`;
    }
  }

// ==========================================================================
// Add-ons / Optional Upgrades Repeater State & Handlers
// ==========================================================================
let currentAddonsList = [];

function renderAddonsRepeater() {
  const container = document.getElementById("addons-repeater-list");
  if (!container) return;

  if (currentAddonsList.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.8rem; color: #94a3b8; text-align: center; padding: 10px 0;">
        No optional upgrades added yet. Click "+ Add Optional Upgrade" below to offer add-ons.
      </div>`;
    return;
  }

  container.innerHTML = currentAddonsList
    .map((addon, index) => `
      <div class="addon-row" style="display: flex; gap: 8px; align-items: center; background: #ffffff; padding: 8px 10px; border-radius: 8px; border: 1px solid #cbd5e1;">
        <input type="text" class="addon-name-input" data-index="${index}" placeholder="Add-on Name (e.g. Throw Pillows)" value="${escapeHtml(addon.name || '')}" style="flex: 2; padding: 6px 10px; font-size: 0.82rem; border: 1px solid #cbd5e1; border-radius: 6px; outline: none;" />
        <div style="display: flex; align-items: center; flex: 1; position: relative;">
          <span style="position: absolute; left: 8px; font-size: 0.78rem; color: #64748b; font-weight: 600;">₱</span>
          <input type="number" step="any" min="0" class="addon-price-input" data-index="${index}" placeholder="Price" value="${addon.price !== undefined ? addon.price : ''}" style="width: 100%; padding: 6px 10px 6px 20px; font-size: 0.82rem; border: 1px solid #cbd5e1; border-radius: 6px; outline: none;" />
        </div>
        <label style="display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #475569; cursor: pointer; white-space: nowrap; user-select: none;">
          <input type="checkbox" class="addon-active-toggle" data-index="${index}" ${addon.active !== false ? 'checked' : ''} /> Active
        </label>
        <button type="button" class="btn-remove-addon-row" data-index="${index}" style="background: #fef2f2; border: 1px solid #fecaca; color: #ef4444; font-weight: 700; font-size: 1rem; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer;" title="Remove upgrade">&times;</button>
      </div>
    `)
    .join('');

  container.querySelectorAll(".addon-name-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (currentAddonsList[idx]) currentAddonsList[idx].name = e.target.value;
      triggerDraftAutosave();
    });
  });

  container.querySelectorAll(".addon-price-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (currentAddonsList[idx]) currentAddonsList[idx].price = parseFloat(e.target.value) || 0;
      triggerDraftAutosave();
    });
  });

  container.querySelectorAll(".addon-active-toggle").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (currentAddonsList[idx]) currentAddonsList[idx].active = e.target.checked;
      triggerDraftAutosave();
    });
  });

  container.querySelectorAll(".btn-remove-addon-row").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      currentAddonsList.splice(idx, 1);
      renderAddonsRepeater();
      triggerDraftAutosave();
    });
  });
}

function clearAddonsRepeater() {
  currentAddonsList = [];
  renderAddonsRepeater();
}

document.addEventListener("DOMContentLoaded", () => {
  const addAddonBtn = document.getElementById("btn-add-addon-row");
  if (addAddonBtn) {
    addAddonBtn.addEventListener("click", () => {
      currentAddonsList.push({
        id: `addon_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: "",
        price: 0,
        active: true,
      });
      renderAddonsRepeater();
      triggerDraftAutosave();
    });
  }
});

  // 3. Render Custom Dropdown Menu Items
  if (customItemsList) {
    customItemsList.innerHTML = cats
      .map((cat) => {
        const count = Array.isArray(allProducts)
          ? allProducts.filter((p) => (p.category || "").toLowerCase() === cat.toLowerCase()).length
          : 0;
        const isSelected = currentVal && cat.toLowerCase() === currentVal.toLowerCase();
        return `
          <div class="custom-cat-item ${isSelected ? "selected" : ""}" data-val="${escapeHtml(cat)}">
            <div class="custom-cat-item-left">
              <span class="custom-cat-item-name">${escapeHtml(cat)}</span>
            </div>
            <div class="custom-cat-item-right">
              <span class="custom-cat-count-badge ${count > 0 ? "has-products" : "zero-products"}">
                ${count} ${count === 1 ? "product" : "products"}
              </span>
              ${isSelected ? `<span class="custom-cat-check">✓</span>` : ""}
            </div>
          </div>
        `;
      })
      .join("");
  }

  // 4. Render Inventory Filter Select Options
  if (filterCatSelect) {
    const currentFilter = filterCatSelect.value || "All";
    filterCatSelect.innerHTML =
      `<option value="All">All Categories (${Array.isArray(allProducts) ? allProducts.length : 0})</option>` +
      cats
        .map((c) => {
          const count = Array.isArray(allProducts)
            ? allProducts.filter((p) => (p.category || "").toLowerCase() === c.toLowerCase()).length
            : 0;
          return `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${count})</option>`;
        })
        .join("");
    if (currentFilter && (currentFilter === "All" || cats.some((c) => c.toLowerCase() === currentFilter.toLowerCase()))) {
      filterCatSelect.value = currentFilter;
    }
  }
}

function renderCategoryManagerList() {
  const listEl = document.getElementById("category-manager-list");
  const badgeEl = document.getElementById("inline-category-total-badge");
  if (!listEl) return;
  const cats = getStoredCategories();

  if (badgeEl) {
    badgeEl.textContent = `${cats.length} ${cats.length === 1 ? "Category" : "Categories"}`;
  }

  if (cats.length === 0) {
    listEl.innerHTML = `
      <div class="cat-empty-state">
        <p>No categories configured.</p>
        <span>Add a new category above.</span>
      </div>`;
    return;
  }

  listEl.innerHTML = cats
    .map((cat) => {
      const count = Array.isArray(allProducts)
        ? allProducts.filter((p) => (p.category || "").toLowerCase() === cat.toLowerCase()).length
        : 0;
      return `
        <div class="category-item-card" data-cat="${escapeHtml(cat)}">
          <div class="cat-item-left">
            <span class="cat-item-name">${escapeHtml(cat)}</span>
            <span class="cat-item-count ${count > 0 ? "has-products" : "zero-products"}">
              ${count} ${count === 1 ? "product" : "products"}
            </span>
          </div>
          <button type="button" class="btn-category-delete" data-cat="${escapeHtml(cat)}" title="Delete category">&times;</button>
        </div>
      `;
    })
    .join("");
}

// Custom Category Dropdown Elements
const customCatDropdown = document.getElementById("custom-category-dropdown");
const customCatTrigger = document.getElementById("custom-cat-trigger");
const customCatMenu = document.getElementById("custom-cat-menu");
const customCatItemsList = document.getElementById("custom-cat-items-list");
const btnDropdownManageCat = document.getElementById("btn-dropdown-manage-cat");

// Inline Category Manager Elements
const categoryMgrPanel = document.getElementById("category-manager-inline-panel");
const btnToggleCategoryMgr = document.getElementById("btn-toggle-category-mgr");
const btnCloseInlineCategoryMgr = document.getElementById("btn-close-inline-category-mgr");
const btnInlineSubmitNewCategory = document.getElementById("btn-inline-submit-new-category");
const inlineNewCategoryInput = document.getElementById("inline-new-category-input");
const inlineCategoryFeedback = document.getElementById("inline-category-feedback-msg");

function showInlineCategoryFeedback(msg, isSuccess = true) {
  if (!inlineCategoryFeedback) return;
  inlineCategoryFeedback.textContent = msg;
  inlineCategoryFeedback.className = `cat-feedback-msg ${isSuccess ? "success" : "error"}`;
  inlineCategoryFeedback.style.display = "block";
  setTimeout(() => {
    if (inlineCategoryFeedback) inlineCategoryFeedback.style.display = "none";
  }, 3500);
}

function openInlineCategoryManager() {
  if (!categoryMgrPanel) return;
  categoryMgrPanel.style.display = "block";
  renderCategoryManagerList();
  if (inlineCategoryFeedback) inlineCategoryFeedback.style.display = "none";
  if (inlineNewCategoryInput) {
    inlineNewCategoryInput.value = "";
    setTimeout(() => inlineNewCategoryInput.focus(), 100);
  }
}

function closeInlineCategoryManager() {
  if (!categoryMgrPanel) return;
  categoryMgrPanel.style.display = "none";
  if (inlineNewCategoryInput) inlineNewCategoryInput.value = "";
  if (inlineCategoryFeedback) inlineCategoryFeedback.style.display = "none";
}

if (btnToggleCategoryMgr) {
  btnToggleCategoryMgr.addEventListener("click", () => {
    const isClosed = !categoryMgrPanel || categoryMgrPanel.style.display === "none";
    if (isClosed) {
      openInlineCategoryManager();
    } else {
      closeInlineCategoryManager();
    }
  });
}

if (btnCloseInlineCategoryMgr) {
  btnCloseInlineCategoryMgr.addEventListener("click", closeInlineCategoryManager);
}

if (btnDropdownManageCat) {
  btnDropdownManageCat.addEventListener("click", () => {
    closeCustomCategoryDropdown();
    openInlineCategoryManager();
  });
}

// Custom Dropdown Open/Close
function toggleCustomCategoryDropdown() {
  if (!customCatMenu || !customCatTrigger) return;
  const isOpen = customCatMenu.style.display === "block";
  if (isOpen) {
    closeCustomCategoryDropdown();
  } else {
    customCatMenu.style.display = "block";
    customCatTrigger.classList.add("active");
    customCatTrigger.setAttribute("aria-expanded", "true");
  }
}

function closeCustomCategoryDropdown() {
  if (!customCatMenu || !customCatTrigger) return;
  customCatMenu.style.display = "none";
  customCatTrigger.classList.remove("active");
  customCatTrigger.setAttribute("aria-expanded", "false");
}

if (customCatTrigger) {
  customCatTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCustomCategoryDropdown();
  });
}

if (customCatItemsList) {
  customCatItemsList.addEventListener("click", (e) => {
    const item = e.target.closest(".custom-cat-item");
    if (!item) return;
    const selectedVal = item.dataset.val;
    if (!selectedVal) return;

    const productCatSelect = document.getElementById("product-category");
    if (productCatSelect) {
      productCatSelect.value = selectedVal;
      productCatSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    renderCategoryDropdowns(selectedVal);
    closeCustomCategoryDropdown();
    triggerDraftAutosave();
  });
}

// Click outside to close dropdown
document.addEventListener("click", (e) => {
  if (customCatDropdown && !customCatDropdown.contains(e.target)) {
    closeCustomCategoryDropdown();
  }
});

// Adding new category
function handleAddNewCategory(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    showInlineCategoryFeedback("Please enter a category name.", false);
    if (inlineNewCategoryInput) inlineNewCategoryInput.focus();
    return;
  }
  const cats = getStoredCategories();
  const existing = cats.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    renderCategoryDropdowns(existing);
    renderCategoryManagerList();
    showInlineCategoryFeedback(`Category "${existing}" already exists. Selected!`, true);
    if (inlineNewCategoryInput) inlineNewCategoryInput.value = "";
    triggerDraftAutosave();
    return;
  }

  cats.push(trimmed);
  saveStoredCategories(cats);
  renderCategoryDropdowns(trimmed);
  renderCategoryManagerList();
  showInlineCategoryFeedback(`✓ Category "${trimmed}" added and selected!`, true);
  if (inlineNewCategoryInput) {
    inlineNewCategoryInput.value = "";
    inlineNewCategoryInput.focus();
  }
  triggerDraftAutosave();
}

if (btnInlineSubmitNewCategory && inlineNewCategoryInput) {
  btnInlineSubmitNewCategory.addEventListener("click", () => {
    handleAddNewCategory(inlineNewCategoryInput.value);
  });
  inlineNewCategoryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddNewCategory(inlineNewCategoryInput.value);
    }
  });
}

// Deleting category
const categoryManagerList = document.getElementById("category-manager-list");
if (categoryManagerList) {
  categoryManagerList.addEventListener("click", (e) => {
    const delBtn = e.target.closest(".btn-category-delete");
    if (!delBtn) return;
    const catToDelete = delBtn.dataset.cat;
    if (!catToDelete) return;

    const count = Array.isArray(allProducts)
      ? allProducts.filter((p) => (p.category || "").toLowerCase() === catToDelete.toLowerCase()).length
      : 0;

    if (count > 0) {
      const confirmDelete = confirm(
        `Category "${catToDelete}" currently has ${count} product(s) assigned to it.\n\nAre you sure you want to remove this category option? (Existing products will keep their category value until edited.)`
      );
      if (!confirmDelete) return;
    } else {
      if (!confirm(`Are you sure you want to remove category "${catToDelete}"?`)) return;
    }

    let cats = getStoredCategories().filter((c) => c.toLowerCase() !== catToDelete.toLowerCase());
    saveStoredCategories(cats);
    renderCategoryDropdowns();
    renderCategoryManagerList();
    showInlineCategoryFeedback(`Category "${catToDelete}" removed.`, true);
    triggerDraftAutosave();
  });
}

// Initial category dropdown render
renderCategoryDropdowns();

// ==========================================================================
// Form Autosave & Draft Recovery
// ==========================================================================
const PRODUCT_DRAFT_KEY = "lanica_product_form_draft";
const productDraftBanner = document.getElementById("product-draft-banner");
const productDraftStatusText = document.getElementById("product-draft-status-text");
const btnDiscardDraft = document.getElementById("btn-discard-draft");
let draftAutosaveTimeout = null;

function hideDraftBanner() {
  if (productDraftBanner) productDraftBanner.style.display = "none";
}

function showDraftBanner(message, isSaved = true) {
  if (!productDraftBanner) return;
  productDraftBanner.style.display = "flex";
  if (productDraftStatusText) productDraftStatusText.textContent = message;
  const dot = productDraftBanner.querySelector(".draft-indicator-dot");
  if (dot) {
    dot.className = isSaved ? "draft-indicator-dot" : "draft-indicator-dot saving";
  }
}

function saveFormDraft() {
  if (isEditing) return;
  const name = document.getElementById("product-name")?.value || "";
  const description = document.getElementById("product-description")?.value || "";
  const category = document.getElementById("product-category")?.value || "";
  const price = document.getElementById("product-price")?.value || "";
  const stock = document.getElementById("product-stock")?.value || "0";
  const height = document.getElementById("product-height")?.value || "72";
  const width = document.getElementById("product-width")?.value || "72";
  const length = document.getElementById("product-length")?.value || "72";
  const length2 = document.getElementById("product-length2")?.value || "72";
  const isLType = document.getElementById("product-is-ltype")?.value === "true";
  const unit = document.getElementById("product-unit")?.value || "in";

  const hasContent =
    name.trim() ||
    description.trim() ||
    (price && price !== "0") ||
    currentMaterialTags.length > 0 ||
    thumbnailItems.length > 0;
  if (!hasContent) return;

  const thumbnailData = thumbnailItems.map((item) => ({
    url: item.url,
  }));

  const draft = {
    name,
    description,
    category,
    price,
    stock,
    isLType,
    height,
    width,
    length,
    length2,
    unit,
    materials: currentMaterialTags,
    thumbnailData,
    savedAt: Date.now(),
  };

  try {
    localStorage.setItem(PRODUCT_DRAFT_KEY, JSON.stringify(draft));
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    showDraftBanner(`Draft saved automatically (${timeStr})`, true);
  } catch (err) {
    console.warn("Storage quota exceeded, saving text-only draft", err);
    try {
      draft.thumbnailData = [];
      localStorage.setItem(PRODUCT_DRAFT_KEY, JSON.stringify(draft));
      showDraftBanner("Draft text saved automatically", true);
    } catch (e) {
      console.error("Failed to save draft:", e);
    }
  }
}

function triggerDraftAutosave() {
  if (isEditing) return;
  showDraftBanner("Saving draft...", false);
  if (draftAutosaveTimeout) clearTimeout(draftAutosaveTimeout);
  draftAutosaveTimeout = setTimeout(() => {
    saveFormDraft();
  }, 400);
}

function restoreFormDraft() {
  if (isEditing) return false;
  try {
    const raw = localStorage.getItem(PRODUCT_DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft) return false;

    if (draft.name !== undefined) document.getElementById("product-name").value = draft.name;
    if (draft.description !== undefined) {
      document.getElementById("product-description").value = draft.description;
      if (productDescriptionTextarea) {
        setTimeout(() => {
          productDescriptionTextarea.style.height = "auto";
          productDescriptionTextarea.style.height = productDescriptionTextarea.scrollHeight + "px";
        }, 0);
      }
    }
    if (draft.category) {
      ensureCategoryOption(draft.category);
      const catSelect = document.getElementById("product-category");
      if (catSelect) catSelect.value = draft.category;
      renderCategoryDropdowns(draft.category);
    }
    if (draft.price !== undefined) document.getElementById("product-price").value = formatPriceWithCommas(draft.price);
    if (draft.stock !== undefined) document.getElementById("product-stock").value = draft.stock;
    if (draft.isLType !== undefined && isLTypeSelect) {
      isLTypeSelect.value = draft.isLType ? "true" : "false";
      toggleLTypeFields(draft.isLType);
    }
    if (draft.height !== undefined && heightInput) heightInput.value = draft.height;
    if (draft.width !== undefined && widthInput) widthInput.value = draft.width;
    if (draft.length !== undefined && lengthInput) lengthInput.value = draft.length;
    if (draft.length2 !== undefined && length2Input) length2Input.value = draft.length2;
    if (draft.unit !== undefined && unitSelect) {
      unitSelect.value = draft.unit;
      currentDimensionUnit = draft.unit;
    }

    clearMaterialTags();
    if (Array.isArray(draft.materials) && draft.materials.length > 0) {
      draft.materials.forEach((m) => addMaterialTag(m));
    }

    clearThumbnailItems();
    if (Array.isArray(draft.thumbnailData) && draft.thumbnailData.length > 0) {
      draft.thumbnailData.forEach((it, idx) => {
        if (it && it.url) {
          thumbnailItems.push({
            id: `draft_${Date.now()}_${idx}`,
            file: null,
            url: it.url,
          });
        }
      });
      renderThumbnailPreviews();
    }

    const timeFormatted = draft.savedAt
      ? new Date(draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
    showDraftBanner(`Draft restored • Saved ${timeFormatted || "previously"}`, true);
    return true;
  } catch (err) {
    console.error("Error restoring product form draft:", err);
    return false;
  }
}

function clearFormDraft() {
  try {
    localStorage.removeItem(PRODUCT_DRAFT_KEY);
  } catch (err) {
    console.error("Error clearing draft:", err);
  }
  hideDraftBanner();
}

if (btnDiscardDraft) {
  btnDiscardDraft.addEventListener("click", () => {
    if (confirm("Discard this saved draft and clear the form?")) {
      clearFormDraft();
      window.closeModal();
      window.openModal();
    }
  });
}

// Bind input listeners for autosave
[
  "product-name",
  "product-description",
  "product-category",
  "product-price",
  "product-stock",
  "product-height",
  "product-width",
  "product-length",
  "product-unit",
].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", triggerDraftAutosave);
    el.addEventListener("change", triggerDraftAutosave);
  }
});

// ==========================================================================
// Live Progress Bar for Product Saving
// ==========================================================================
let isSavingProduct = false;

function updateSaveProgress(pct, statusText) {
  const container = document.getElementById("product-save-progress-container");
  const bar = document.getElementById("product-save-progress-bar");
  const status = document.getElementById("product-save-status-text");
  const percent = document.getElementById("product-save-percent-text");
  if (container) container.style.display = "block";
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (status) status.textContent = statusText;
  if (percent) percent.textContent = `${Math.round(pct)}%`;
}

function hideSaveProgress() {
  const container = document.getElementById("product-save-progress-container");
  const bar = document.getElementById("product-save-progress-bar");
  if (container) container.style.display = "none";
  if (bar) bar.style.width = "0%";
}

// ==========================================================================
// Modal Dismissal Prevention (Backdrop Protection)
// ==========================================================================
function triggerModalShake() {
  const modalContent = productModal ? productModal.querySelector(".modal-content") : null;
  if (modalContent) {
    modalContent.classList.remove("modal-content-shake");
    void modalContent.offsetWidth; // trigger reflow
    modalContent.classList.add("modal-content-shake");
  }
}

function hasUnsavedFormChanges() {
  if (isEditing) {
    const orig = productForm.dataset.origFormData ? JSON.parse(productForm.dataset.origFormData) : null;
    if (!orig) return false;
    const currentName = document.getElementById("product-name")?.value || "";
    const currentDesc = document.getElementById("product-description")?.value || "";
    const currentCat = document.getElementById("product-category")?.value || "";
    const currentPrice = document.getElementById("product-price")?.value || "";
    const currentStock = document.getElementById("product-stock")?.value || "0";
    const currentH = document.getElementById("product-height")?.value || "";
    const currentW = document.getElementById("product-width")?.value || "";
    const currentL = document.getElementById("product-length")?.value || "";
    const currentU = document.getElementById("product-unit")?.value || "in";
    const bgChanged = !!(
      document.getElementById("img-bg")?.files?.length ||
      document.getElementById("img-bg-left")?.files?.length ||
      document.getElementById("img-bg-right")?.files?.length ||
      document.getElementById("img-bg-back")?.files?.length
    );
    const newThumbs = thumbnailItems.some((it) => it.file);
    const thumbsCountChanged = thumbnailItems.length !== (orig.thumbnailsCount || 0);

    return (
      bgChanged ||
      newThumbs ||
      thumbsCountChanged ||
      currentName !== orig.name ||
      currentDesc !== orig.description ||
      currentCat !== orig.category ||
      String(currentPrice).replace(/,/g, "") !== String(orig.price).replace(/,/g, "") ||
      String(currentStock) !== String(orig.stock) ||
      String(currentH) !== String(orig.height) ||
      String(currentW) !== String(orig.width) ||
      String(currentL) !== String(orig.length) ||
      currentU !== orig.unit ||
      JSON.stringify(currentMaterialTags) !== JSON.stringify(orig.materials || [])
    );
  } else {
    const name = document.getElementById("product-name")?.value.trim() || "";
    const desc = document.getElementById("product-description")?.value.trim() || "";
    const price = (document.getElementById("product-price")?.value.trim() || "").replace(/,/g, "");
    const stock = document.getElementById("product-stock")?.value.trim() || "0";
    const hasFiles = !!(
      document.getElementById("img-bg")?.files?.length ||
      document.getElementById("img-bg-left")?.files?.length ||
      document.getElementById("img-bg-right")?.files?.length ||
      document.getElementById("img-bg-back")?.files?.length
    );
    const hasThumbnails = thumbnailItems.length > 0;
    const hasMaterials = currentMaterialTags.length > 0;
    return (
      name !== "" ||
      desc !== "" ||
      (price !== "" && price !== "0") ||
      stock !== "0" ||
      hasFiles ||
      hasThumbnails ||
      hasMaterials
    );
  }
}

function handleModalCloseAttempt() {
  if (isSavingProduct) return;
  if (hasUnsavedFormChanges()) {
    const confirmDiscard = confirm("You have unsaved changes. Are you sure you want to discard them and exit?");
    if (!confirmDiscard) return;
  }
  window.closeModal();
}

// --- Modal Functions ---
window.openModal = () => {
  productModal.classList.add("active");
  if (!isEditing) {
    document.getElementById("modal-title").textContent = "Add New Product";
    // When adding new, front bg is required as minimum
    document.getElementById("img-bg").required = true;
    restoreFormDraft();
    renderCategoryDropdowns();
  }
};

window.closeModal = () => {
  productModal.classList.remove("active");
  productForm.reset();
  isEditing = false;
  currentEditId = null;
  delete productForm.dataset.existingImages;
  delete productForm.dataset.existingThumbnails;
  delete productForm.dataset.meshyTaskId;
  delete productForm.dataset.origFormData;

  // Reset custom components
  clearMaterialTags();
  closeCustomCategoryDropdown();
  closeInlineCategoryManager();
  renderCategoryDropdowns();
  clearThumbnailItems();
  clearAddonsRepeater();
  if (heightInput) heightInput.value = "72";
  if (widthInput) widthInput.value = "72";
  if (lengthInput) lengthInput.value = "72";
  if (length2Input) length2Input.value = "72";
  if (isLTypeSelect) isLTypeSelect.value = "false";
  toggleLTypeFields(false);
  if (unitSelect) unitSelect.value = "in";
  currentDimensionUnit = "in";

  // Reset required states
  document.getElementById("img-bg").required = true;

  // Reset textarea height
  if (productDescriptionTextarea) {
    productDescriptionTextarea.style.height = "auto";
  }

  hideDraftBanner();
  hideSaveProgress();
  if (categoryMgrPanel) categoryMgrPanel.style.display = "none";
};

addProductBtn.addEventListener("click", window.openModal);
closeModalBtn.addEventListener("click", handleModalCloseAttempt);
cancelBtn.addEventListener("click", handleModalCloseAttempt);

// Backdrop Protection (Disable closing on background click)
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    triggerModalShake();
  }
});

// Escape Key Protection (Disable closing on accidental Escape)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOverlay.classList.contains("active")) {
    e.preventDefault();
    triggerModalShake();
  }
});

// Logout Feature
const logoutBtn = document.getElementById("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await signOut(auth);
      window.location.replace("/index.html");
    } catch (error) {
      console.error("Error signing out:", error);
      alert("Failed to log out. Try again.");
    }
  });
}

// --- Firestore Functions ---

// Listen to Realtime Updates
allProducts = [];

let inventoryLoaded = false;
let inventoryLoadTimer = setTimeout(() => {
  if (inventoryLoaded) return;
  if (inventoryList) {
    inventoryList.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #b45309;">
      Inventory is taking too long to load. Check the browser console for Firestore errors.
    </td></tr>`;
  }
}, 10000);

onSnapshot(
  productsCollection,
  (snapshot) => {
    inventoryLoaded = true;
    if (inventoryLoadTimer) clearTimeout(inventoryLoadTimer);
    allProducts = [];
    snapshot.forEach((doc) => {
      allProducts.push({ id: doc.id, ...doc.data() });
    });
    renderCategoryDropdowns();
    renderCategoryManagerList();
    applyCategoryFilter();
    updateStats(allProducts); // Stats always reflect full inventory
  },
  (err) => {
    inventoryLoaded = true;
    if (inventoryLoadTimer) clearTimeout(inventoryLoadTimer);
    console.error("Error loading products:", err);
    if (inventoryList) {
      inventoryList.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #b91c1c;">
        Failed to load inventory. ${err?.message ? err.message : "Check Firestore permissions/rules."}
      </td></tr>`;
    }
  }
);

// Category Filter Logic
const categoryFilter = document.getElementById("category-filter");
if (categoryFilter) {
  categoryFilter.addEventListener("change", applyCategoryFilter);
}

function applyCategoryFilter() {
  const selectedCategory = categoryFilter ? categoryFilter.value : "All";
  let filteredProducts = allProducts;

  if (selectedCategory && selectedCategory !== "All") {
    filteredProducts = allProducts.filter((p) => p.category === selectedCategory);
  }

  renderInventory(filteredProducts);
  renderRevenueGraph();
}

// Helper function to upload an image/video to Firebase Storage and return its URL
async function uploadImage(file, folderPath) {
  if (!file) return null;

  try {
    const compressedFile = await compressAndResizeImage(file, 500, 500, 80 * 1024);
    console.log("Starting upload for compressed file:", compressedFile.name, "Size:", compressedFile.size, "Type:", compressedFile.type);

    const safeName = compressedFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `${Date.now()}_${safeName}`;
    const targetPath = folderPath ? `${folderPath}/${uniqueName}` : `products/${uniqueName}`;
    const storageRef = ref(storage, targetPath);

    const metadata = {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: compressedFile.type || "image/webp",
    };

    console.log("Uploading to path:", targetPath, "with cache-control metadata");
    const snapshot = await uploadBytes(storageRef, compressedFile, metadata);
    console.log("Upload successful, getting download URL...");

    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log("Download URL obtained:", downloadURL);

    return downloadURL;
  } catch (error) {
    console.error("Firebase Storage error:", error);
    console.error("Error details:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    throw new Error("Failed to upload media to Firebase Storage: " + error.message, {
      cause: error,
    });
  }
}

async function waitForMeshyModelUrl(taskId, maxAttempts = 40, delayMs = 3000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const statusRes = await fetch(`${MESHY_API_BASE}/${encodeURIComponent(taskId)}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const status = String(statusData.status || "").toUpperCase();
        if (status === "SUCCEEDED") {
          const url =
            (statusData.model_urls && (statusData.model_urls.glb || statusData.model_urls.usdz)) ||
            null;
          return { status, modelUrl: url };
        }
        if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
          return { status, modelUrl: null };
        }
      }
    } catch (e) {
      console.warn("Meshy polling retry due to transient error:", e);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { status: "PENDING", modelUrl: null };
}

async function createMeshyTask(imagesPayload, prompt = null) {
  const body = {
    enable_pbr: true,
  };

  if (typeof imagesPayload === "string") {
    body.image_url = imagesPayload;
  } else if (imagesPayload && typeof imagesPayload === "object") {
    body.image_url = imagesPayload.frontUrl || imagesPayload.bgImage || "";
    if (imagesPayload.leftUrl || imagesPayload.leftBgImage) {
      body.left_image_url = imagesPayload.leftUrl || imagesPayload.leftBgImage;
    }
    if (imagesPayload.rightUrl || imagesPayload.rightBgImage) {
      body.right_image_url = imagesPayload.rightUrl || imagesPayload.rightBgImage;
    }
    if (imagesPayload.backUrl || imagesPayload.backBgImage) {
      body.back_image_url = imagesPayload.backUrl || imagesPayload.backBgImage;
    }
  }

  if (prompt && prompt.trim()) {
    body.prompt = prompt.trim();
  }

  const response = await fetch(MESHY_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to start Meshy API");
  }

  return response.json();
}

// Helper to fetch GLB from Meshy URL and upload it to Firebase Storage in "products/productsmodel" folder
async function uploadGlbFromUrl(url, folderPath = "products/productsmodel", filenameHint = "model.glb") {
  if (!url) return null;
  if (url.includes("firebasestorage.googleapis.com")) {
    return url;
  }

  try {
    console.log("Fetching GLB file from Meshy URL:", url);
    const fetchUrl = url.includes("meshy.ai") ? `/api/meshy-glb?url=${encodeURIComponent(url)}` : url;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to download GLB file from Meshy: ${response.statusText}`);
    }
    const blob = await response.blob();
    const file = new File([blob], filenameHint.endsWith(".glb") ? filenameHint : `${filenameHint}.glb`, {
      type: "model/gltf-binary",
    });
    console.log("Uploading GLB to Firebase Storage path:", folderPath);
    const storageUrl = await uploadImage(file, folderPath);
    console.log("GLB successfully saved to Firebase Storage:", storageUrl);
    return storageUrl;
  } catch (err) {
    console.error("Failed to upload GLB to Firebase Storage:", err);
    return url;
  }
}

// Add / Update Product
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  isSavingProduct = true;
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  closeModalBtn.disabled = true;
  updateSaveProgress(5, "Preparing media and form data...");

  try {
    // Validate thumbnails
    if (!thumbnailItems || thumbnailItems.length === 0) {
      if (thumbnailErrorMsg) thumbnailErrorMsg.style.display = "block";
      submitBtn.textContent = isEditing ? "Update Product" : "Save Product";
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      closeModalBtn.disabled = false;
      isSavingProduct = false;
      hideSaveProgress();
      alert("Please add at least one product thumbnail image.");
      return;
    }

    // Auto-commit any material typed in the input
    if (materialInput && materialInput.value.trim()) {
      addMaterialTag(materialInput.value);
    }
    const materials = currentMaterialTags.length > 0 ? [...currentMaterialTags] : ["Standard"];
    const material = materials.join(", ");

    const transparentFrontFile = document.getElementById("img-bg").files[0];
    const leftBgFile = document.getElementById("img-bg-left")?.files[0] || null;
    const rightBgFile = document.getElementById("img-bg-right")?.files[0] || null;
    const backBgFile = document.getElementById("img-bg-back")?.files[0] || null;

    const existingImages = isEditing ? JSON.parse(productForm.dataset.existingImages || "{}") : {};

    // Calculate total media uploads to track 0% - 70% progress
    let totalMediaFiles = 0;
    thumbnailItems.forEach((item) => {
      if (item.file || (item.url && item.url.startsWith("data:"))) totalMediaFiles += 1;
    });
    if (transparentFrontFile) totalMediaFiles += 1;
    if (leftBgFile) totalMediaFiles += 1;
    if (rightBgFile) totalMediaFiles += 1;
    if (backBgFile) totalMediaFiles += 1;

    let completedMediaFiles = 0;
    const reportMediaProgress = () => {
      completedMediaFiles += 1;
      const targetPct = Math.round(10 + (completedMediaFiles / Math.max(1, totalMediaFiles)) * 60);
      updateSaveProgress(targetPct, `Uploading media (${completedMediaFiles}/${totalMediaFiles})...`);
    };

    if (totalMediaFiles === 0) {
      updateSaveProgress(65, "Verifying media references...");
    } else {
      updateSaveProgress(10, `Uploading media (0/${totalMediaFiles})...`);
    }

    // Upload thumbnails concurrently
    const thumbnailUrls = await Promise.all(
      thumbnailItems.map(async (item, idx) => {
        if (item.file) {
          const url = await uploadImage(item.file, "products/thumbnails");
          reportMediaProgress();
          return url;
        } else if (item.url && item.url.startsWith("data:")) {
          const blob = await (await fetch(item.url)).blob();
          const fileFromBlob = new File([blob], `thumb_${Date.now()}_${idx}.png`, { type: blob.type || "image/png" });
          const url = await uploadImage(fileFromBlob, "products/thumbnails");
          reportMediaProgress();
          return url;
        }
        return item.url;
      })
    );
    const primaryThumbnail = thumbnailUrls[0] || "";

    // Upload transparent background files concurrently into specified Firebase Storage folders
    const [bgImage, leftBgImage, rightBgImage, backBgImage] = await Promise.all([
      transparentFrontFile
        ? uploadImage(transparentFrontFile, "products/productsnobg").then((url) => {
            reportMediaProgress();
            return url;
          })
        : existingImages.bgImage || existingImages.frontBg || "",
      leftBgFile
        ? uploadImage(leftBgFile, "products/productsnobg").then((url) => {
            reportMediaProgress();
            return url;
          })
        : existingImages.leftBgImage || "",
      rightBgFile
        ? uploadImage(rightBgFile, "products/productsnobg").then((url) => {
            reportMediaProgress();
            return url;
          })
        : existingImages.rightBgImage || "",
      backBgFile
        ? uploadImage(backBgFile, "products/productsnobg").then((url) => {
            reportMediaProgress();
            return url;
          })
        : existingImages.backBgImage || "",
    ]);

    // Keep previous Meshy artifacts only when we are NOT regenerating from a new transparent image.
    let meshyTaskId = isEditing ? productForm.dataset.meshyTaskId || null : null;
    let modelUrl = isEditing ? productForm.dataset.modelUrl || null : null;
    let meshyStatus = isEditing ? productForm.dataset.meshyStatus || null : null;
    const shouldRegenerateMeshy = !!(transparentFrontFile || leftBgFile || rightBgFile || backBgFile);

    if (shouldRegenerateMeshy) {
      meshyTaskId = null;
      modelUrl = null;
      meshyStatus = "PENDING";
    }

    const meshyPayload = {
      frontUrl: bgImage || existingImages.bgImage || existingImages.frontBg || "",
      leftUrl: leftBgImage || existingImages.leftBgImage || "",
      rightUrl: rightBgImage || existingImages.rightBgImage || "",
      backUrl: backBgImage || existingImages.backBgImage || "",
    };

    // Automatically trigger Meshy.ai API when new transparent background image(s) were uploaded.
    if (shouldRegenerateMeshy) {
      if (!meshyPayload.frontUrl) {
        throw new Error("Front transparent background image is required for Meshy generation.");
      }
      updateSaveProgress(68, isEditing ? "Regenerating 3D Model..." : "Generating 3D model with Meshy AI...");
      try {
        const originalTask = await createMeshyTask(meshyPayload);
        meshyTaskId = originalTask.result;
        meshyStatus = "PENDING";

        updateSaveProgress(70, "Waiting for 3D model calibration...");
        const originalResult = await waitForMeshyModelUrl(meshyTaskId, 40, 3000);
        const rawModelUrl = originalResult.modelUrl || null;
        meshyStatus = originalResult.status || meshyStatus;

        if (rawModelUrl) {
          updateSaveProgress(72, "Saving 3D model to storage...");
          const productName = document.getElementById("product-name").value || "product";
          const safeName = productName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          modelUrl = await uploadGlbFromUrl(rawModelUrl, "products/productsmodel", `${safeName}.glb`);
        } else {
          modelUrl = null;
        }
      } catch (err) {
        console.error("Failed to generate 3D model", err);
        alert("Failed to generate 3D model: " + err.message);
        submitBtn.textContent = isEditing ? "Update Product" : "Save Product";
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        closeModalBtn.disabled = false;
        isSavingProduct = false;
        hideSaveProgress();
        return; // ABORT SAVE
      }
    }

    // 70% - 90%: Payload validation and database save
    updateSaveProgress(75, "Validating product details...");

    const stock = parseInt(document.getElementById("product-stock").value, 10) || 0;
    const isLType = isLTypeSelect ? (isLTypeSelect.value === "true") : false;
    const height = parseFloat(document.getElementById("product-height").value) || 0;
    const width = parseFloat(document.getElementById("product-width").value) || 0;
    const length = parseFloat(document.getElementById("product-length").value) || 0;
    const length2 = isLType && length2Input ? (parseFloat(length2Input.value) || 0) : null;
    const unit = document.getElementById("product-unit").value || "in";
    const dimensions = {
      isLType,
      height,
      width,
      length,
      length2: isLType ? length2 : null,
      unit,
      heightCm: convertDimension(height, unit, "cm"),
      widthCm: convertDimension(width, unit, "cm"),
      lengthCm: convertDimension(length, unit, "cm"),
      length2Cm: isLType && length2 ? convertDimension(length2, unit, "cm") : null,
    };
    let size = "";
    if (isLType && length2) {
      size = `${length} × ${length2} (L-Type) × ${width} × ${height} ${unit}`;
    } else if (length > 0) {
      size = `${length} × ${width} × ${height} ${unit}`;
    } else {
      size = `${width} × ${height} ${unit}`;
    }

    const allowPreorder = document.getElementById("product-allow-preorder")
      ? document.getElementById("product-allow-preorder").checked
      : true;
    const leadTime = document.getElementById("product-lead-time")?.value?.trim() || "14-21 Business Days";

    const productData = {
      name: document.getElementById("product-name").value,
      description: document.getElementById("product-description").value,
      category: document.getElementById("product-category").value,
      price: parseFloat(String(document.getElementById("product-price").value).replace(/,/g, "").trim()) || 0,
      stock,
      allowPreorder,
      isMadeToOrder: allowPreorder,
      leadTime,
      estimated_lead_time: leadTime,
      materials,
      material,
      dimensions,
      size,
      thumbnails: thumbnailUrls,
      thumbnail: primaryThumbnail,
      images: {
        isoImage: primaryThumbnail,
        thumbnails: thumbnailUrls,
        bgImage,
        leftBgImage: leftBgImage || "",
        rightBgImage: rightBgImage || "",
        backBgImage: backBgImage || "",
      },
      addons: currentAddonsList.filter((a) => a && (a.name || "").trim() !== ""),
      meshyTaskId: meshyTaskId,
      modelUrl: modelUrl,
      meshyStatus: meshyStatus,
      meshyRegeneratedAt: shouldRegenerateMeshy ? Timestamp.now() : null,
    };

    updateSaveProgress(85, "Saving product details to database...");

    let savedProductRef = null;
    if (isEditing) {
      savedProductRef = doc(db, "products", currentEditId);
      await updateDoc(savedProductRef, productData);
      logActivity(
        "PRODUCT_UPDATE",
        `Updated product "${productData.name}" (Stock: ${stock}, Price: ₱${productData.price.toLocaleString()}, Pre-Order: ${allowPreorder ? "Allowed" : "Disabled"})`,
        { productId: currentEditId, category: productData.category, stock, allowPreorder }
      );
    } else {
      savedProductRef = await addDoc(productsCollection, productData);
      logActivity(
        "PRODUCT_CREATE",
        `Created product "${productData.name}" (Stock: ${stock}, Price: ₱${productData.price.toLocaleString()}, Pre-Order: ${allowPreorder ? "Allowed" : "Disabled"})`,
        { productId: savedProductRef.id, category: productData.category, stock, allowPreorder }
      );
    }

    // Ensure regenerated products eventually store Meshy URLs uploaded to Firebase Storage.
    if (shouldRegenerateMeshy && savedProductRef) {
      const updates = {};
      if (meshyTaskId && !modelUrl) {
        updateSaveProgress(92, "Finalizing 3D model URL...");
        const finalMeshy = await waitForMeshyModelUrl(meshyTaskId, 40, 3000);
        updates.meshyStatus = finalMeshy.status;
        if (finalMeshy.modelUrl) {
          const productName = document.getElementById("product-name").value || "product";
          const safeName = productName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          updates.modelUrl = await uploadGlbFromUrl(finalMeshy.modelUrl, "products/productsmodel", `${safeName}.glb`);
        } else {
          updates.modelUrl = null;
        }
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = Timestamp.now();
        await updateDoc(savedProductRef, updates);
      }
    }

    // 100%: Finalizing and success state
    updateSaveProgress(100, "Done! Product saved successfully.");
    clearFormDraft();

    // Short visual pause so user sees progress bar at 100%
    await new Promise((r) => setTimeout(r, 450));
    window.closeModal();
  } catch (e) {
    console.error("Error saving product: ", e);
    updateSaveProgress(0, "Error: " + e.message);
    alert("Failed to save product. See console for details.");
  } finally {
    isSavingProduct = false;
    submitBtn.textContent = isEditing ? "Update Product" : "Save Product";
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    closeModalBtn.disabled = false;
    hideSaveProgress();
  }
});

// Delete Product
window.deleteProduct = async (id) => {
  if (confirm("Are you sure you want to delete this product?")) {
    try {
      await deleteDoc(doc(db, "products", id));
    } catch (error) {
      console.error("Error deleting product: ", error);
    }
  }
};

// --- 3D Viewer Logic ---
const viewerModal = document.getElementById("viewer-modal");
const closeViewerBtn = document.getElementById("close-viewer-btn");
const viewerStatus = document.getElementById("viewer-status");
const modelViewer = document.getElementById("product-model-viewer");
const viewerLoading = document.getElementById("viewer-loading");
const viewerLoadingText = document.getElementById("viewer-loading-text");
let viewerPollTimer = null;

function stopViewerPolling() {
  if (viewerPollTimer) {
    clearTimeout(viewerPollTimer);
    viewerPollTimer = null;
  }
}

function setViewerLoading(active, text) {
  if (viewerLoading) viewerLoading.classList.toggle("active", active);
  if (viewerLoadingText && text) viewerLoadingText.textContent = text;
}

function hideViewerLoading() {
  if (viewerStatus) viewerStatus.style.visibility = "hidden";
  setViewerLoading(false);
}

// Show percentage while downloading the heavy .glb file into the browser
modelViewer.addEventListener("progress", (e) => {
  const progress = e.detail.totalProgress;
  if (progress < 1) {
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = `Downloading and Opening 3D Model... ${Math.round(progress * 100)}%`;
    setViewerLoading(true, "Calibrating 3D object...");
  } else {
    hideViewerLoading();
  }
});

// Hide loading state as soon as 3D model finishes rendering
modelViewer.addEventListener("load", hideViewerLoading);
modelViewer.addEventListener("poster-dismissed", hideViewerLoading);
modelViewer.addEventListener("model-visibility", (e) => {
  if (e && e.detail && e.detail.visible) {
    hideViewerLoading();
  }
});

// Handle loading error
modelViewer.addEventListener("error", (err) => {
  console.error("Model viewer error:", err);
  setViewerLoading(false);
  viewerStatus.style.visibility = "visible";
  viewerStatus.textContent = "Failed to load 3D model.";
});

async function fetchProductData(productId) {
  const pRef = doc(db, "products", productId);
  const snap = await getDoc(pRef);
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data;
}

function getGlbViewerUrl(url) {
  if (!url) return "";
  // Always proxy 3D GLB model URLs through /api/meshy-glb to eliminate CORS errors on Cloudflare Pages
  return `/api/meshy-glb?url=${encodeURIComponent(url)}`;
}

async function pollMeshyAndLoad(taskId, attempt = 0) {
  const response = await fetch(`${MESHY_API_BASE}/${encodeURIComponent(taskId)}`);

  if (!response.ok) throw new Error("Failed to fetch Meshy status.");

  const data = await response.json();
  const status = String(data.status || "").toUpperCase();
  const progress = Number(data.progress || 0);

  if (status === "SUCCEEDED" && data.model_urls && data.model_urls.glb) {
    const targetUrl = getGlbViewerUrl(data.model_urls.glb);
    if (modelViewer.loaded && modelViewer.src === targetUrl) {
      hideViewerLoading();
      return;
    }
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = "Starting 3D download...";
    setViewerLoading(true, "Calibrating 3D object...");
    modelViewer.src = targetUrl;
    setTimeout(() => {
      if (modelViewer.loaded) hideViewerLoading();
    }, 300);
    return;
  }

  if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
    setViewerLoading(false);
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = `Model generation failed. Status: ${status}`;
    return;
  }

  if (attempt >= 30) {
    setViewerLoading(false);
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = "Still processing. Please try again in a moment.";
    return;
  }

  viewerStatus.style.visibility = "visible";
  viewerStatus.textContent = `Model is generating... Progress: ${progress}%`;
  setViewerLoading(true, "Calibrating 3D object...");

  viewerPollTimer = setTimeout(() => {
    pollMeshyAndLoad(taskId, attempt + 1).catch((e) => {
      console.error(e);
      setViewerLoading(false);
      viewerStatus.style.visibility = "visible";
      viewerStatus.textContent = e.message || "Network error fetching model.";
    });
  }, 2500);
}

window.view3DModel = async (productId) => {
  if (!productId) return;
  stopViewerPolling();
  viewerModal.classList.add("active");
  viewerStatus.textContent = "Checking model status...";
  viewerStatus.style.visibility = "visible";
  setViewerLoading(true, "Calibrating 3D object...");
  modelViewer.removeAttribute("src");

  try {
    const productData = await fetchProductData(productId);
    if (!productData) {
      setViewerLoading(false);
      viewerStatus.textContent = "Product not found.";
      return;
    }

    // First check if there's already a modelUrl stored
    if (productData.modelUrl) {
      const targetUrl = getGlbViewerUrl(productData.modelUrl);

      // If model is already loaded, hide loading spinner immediately
      if (modelViewer.loaded && modelViewer.src === targetUrl) {
        hideViewerLoading();
        return;
      }

      viewerStatus.style.visibility = "visible";
      viewerStatus.textContent = "Loading 3D model...";
      setViewerLoading(true, "Calibrating 3D object...");
      modelViewer.src = targetUrl;

      // Fallback check for instant browser cache loads
      setTimeout(() => {
        if (modelViewer.loaded) hideViewerLoading();
      }, 300);
      return;
    }

    // If no modelUrl, check for meshyTaskId and poll
    const taskId = productData.meshyTaskId;
    if (!taskId) {
      setViewerLoading(false);
      viewerStatus.textContent = "No 3D model available for this product yet.";
      return;
    }

    await pollMeshyAndLoad(taskId, 0);
  } catch (e) {
    console.error(e);
    setViewerLoading(false);
    viewerStatus.textContent = e.message || "Network error fetching model.";
  }
};

window.closeViewer = () => {
  stopViewerPolling();
  setViewerLoading(false);
  viewerModal.classList.remove("active");
  modelViewer.removeAttribute("src");
};

if (closeViewerBtn) closeViewerBtn.addEventListener("click", window.closeViewer);
if (viewerModal)
  viewerModal.addEventListener("click", (e) => {
    if (e.target === viewerModal) window.closeViewer();
  });

// Add-ons / Optional Upgrades Repeater State & Logic

function clearAddonsRepeater() {
  currentAddonsList = [];
  renderAddonsRepeater();
}

function renderAddonsRepeater() {
  const container = document.getElementById("addons-repeater-list");
  if (!container) return;

  if (currentAddonsList.length === 0) {
    container.innerHTML = `<p style="font-size: 0.78rem; color: #9ca3af; margin: 4px 0; font-style: italic;">No optional upgrades added yet. Click below to add upgrade options.</p>`;
    return;
  }

  container.innerHTML = currentAddonsList
    .map((addon, index) => {
      const isActive = addon.active !== false;
      return `
    <div class="addon-repeater-row" data-index="${index}" style="display: flex; align-items: center; gap: 8px; background: #ffffff; padding: 8px 10px; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
      <input type="text" class="addon-input-name" placeholder="Upgrade Name (e.g. Throw Pillows)" value="${escapeHtml(addon.name || "")}" style="flex: 2; height: 38px; padding: 0 12px; font-size: 0.85rem; border: 1px solid #cbd5e1; border-radius: 8px; outline: none; box-sizing: border-box; transition: border-color 0.2s;" />
      
      <div style="display: flex; align-items: center; gap: 6px; flex: 1.2; height: 38px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 10px; box-sizing: border-box;">
        <span style="font-size: 0.85rem; font-weight: 700; color: #64748b; line-height: 1;">₱</span>
        <input type="number" class="addon-input-price" placeholder="Price" min="0" step="any" value="${addon.price != null ? addon.price : ""}" style="width: 100%; height: 100%; font-size: 0.85rem; font-weight: 600; border: none; background: transparent; outline: none; margin: 0; padding: 0;" />
      </div>

      <button type="button" class="btn-toggle-addon-status" data-index="${index}" title="Click to toggle Active/Inactive" style="display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; user-select: none; box-sizing: border-box; transition: all 0.2s; ${
        isActive
          ? "background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;"
          : "background: #f3f4f6; color: #4b5563; border: 1px solid #e5e7eb;"
      }">
        <span class="status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${isActive ? "#10b981" : "#9ca3af"}; display: inline-block;"></span>
        <span style="line-height: 1;">${isActive ? "Active" : "Inactive"}</span>
      </button>

      <button type="button" class="btn-remove-addon-row" data-index="${index}" title="Remove Upgrade" style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 8px; width: 38px; height: 38px; min-width: 38px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-sizing: border-box; padding: 0; transition: all 0.2s;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  `;
    })
    .join("");

  // Attach input listeners
  container.querySelectorAll(".addon-repeater-row").forEach((row) => {
    const idx = parseInt(row.dataset.index, 10);
    const nameInp = row.querySelector(".addon-input-name");
    const priceInp = row.querySelector(".addon-input-price");
    const toggleBtn = row.querySelector(".btn-toggle-addon-status");
    const removeBtn = row.querySelector(".btn-remove-addon-row");

    if (nameInp) {
      nameInp.addEventListener("input", (e) => {
        if (currentAddonsList[idx]) currentAddonsList[idx].name = e.target.value;
      });
    }

    if (priceInp) {
      priceInp.addEventListener("input", (e) => {
        if (currentAddonsList[idx]) currentAddonsList[idx].price = parseFloat(e.target.value) || 0;
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        if (currentAddonsList[idx]) {
          const newActive = currentAddonsList[idx].active === false;
          currentAddonsList[idx].active = newActive;
          renderAddonsRepeater();
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        currentAddonsList.splice(idx, 1);
        renderAddonsRepeater();
      });
    }
  });
}

function setupAddonsRepeaterUI() {
  document.addEventListener("click", (e) => {
    const addBtn = e.target && e.target.closest ? e.target.closest("#btn-add-addon-row") : null;
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      currentAddonsList.push({
        id: `addon_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: "",
        price: 0,
        active: true,
      });
      renderAddonsRepeater();
    }
  });
}

// Edit Product (Load data into form)
window.editProduct = (id, productJsonBase64) => {
  try {
    const product = JSON.parse(decodeURIComponent(atob(productJsonBase64)));
    document.getElementById("product-name").value = product.name;
    document.getElementById("product-description").value = product.description || "";
    ensureCategoryOption(product.category);
    document.getElementById("product-category").value = product.category;
    renderCategoryDropdowns(product.category);
    document.getElementById("product-price").value = formatPriceWithCommas(product.price);
    document.getElementById("product-stock").value = product.stock || 0;

    if (document.getElementById("product-allow-preorder")) {
      document.getElementById("product-allow-preorder").checked = product.allowPreorder !== false && product.isMadeToOrder !== false;
    }
    if (document.getElementById("product-lead-time")) {
      document.getElementById("product-lead-time").value = product.leadTime || product.estimated_lead_time || "14-21 Business Days";
    }

    // Materials tags
    clearMaterialTags();
    if (Array.isArray(product.materials) && product.materials.length > 0) {
      product.materials.forEach((m) => addMaterialTag(m));
    } else if (product.material) {
      addMaterialTag(product.material);
    }

    // Dimensions
    const isLType = (product.dimensions && product.dimensions.isLType === true) || product.isLType === true;
    if (isLTypeSelect) isLTypeSelect.value = isLType ? "true" : "false";
    toggleLTypeFields(isLType);

    let height = 72;
    let width = 72;
    let length = 72;
    let length2 = 72;
    let unit = "in";
    if (product.dimensions && typeof product.dimensions.height === "number") {
      height = product.dimensions.height;
      width = product.dimensions.width;
      length = typeof product.dimensions.length === "number" ? product.dimensions.length : 72;
      length2 = typeof product.dimensions.length2 === "number" ? product.dimensions.length2 : (length || 72);
      unit = product.dimensions.unit || "in";
    } else if (product.size) {
      const sizeParts = (product.size || "").split(" × ");
      if (sizeParts.length >= 4 && product.size.includes("L-Type")) {
        length = parseFloat(sizeParts[0]) || 72;
        length2 = parseFloat(sizeParts[1]) || 72;
        width = parseFloat(sizeParts[2]) || 72;
        height = parseFloat(sizeParts[3]) || 72;
      } else if (sizeParts.length >= 3) {
        length = parseFloat(sizeParts[0]) || 72;
        width = parseFloat(sizeParts[1]) || 72;
        height = parseFloat(sizeParts[2]) || 72;
      } else if (sizeParts.length === 2) {
        width = parseFloat(sizeParts[0]) || 72;
        height = parseFloat(sizeParts[1]) || 72;
        length = 72;
      }
      if (product.size.includes("cm")) unit = "cm";
      else if (product.size.includes("ft")) unit = "ft";
      else if (product.size.includes("m")) unit = "m";
      else unit = "in";
    }
    if (heightInput) heightInput.value = height;
    if (widthInput) widthInput.value = width;
    if (lengthInput) lengthInput.value = length;
    if (length2Input) length2Input.value = length2;
    if (unitSelect) unitSelect.value = unit;
    currentDimensionUnit = unit;

    // Multi-Thumbnails
    clearThumbnailItems();
    const existingThumbs = Array.isArray(product.thumbnails) && product.thumbnails.length > 0
      ? product.thumbnails
      : (Array.isArray(product.images?.thumbnails) && product.images.thumbnails.length > 0)
        ? product.images.thumbnails
        : [product.thumbnail || (product.images && (product.images.isoImage || product.images.frontBg))].filter(Boolean);

    existingThumbs.forEach((url, i) => {
      thumbnailItems.push({
        id: `existing_${i}`,
        file: null,
        url: url,
      });
    });
    renderThumbnailPreviews();

    // Add-ons / Optional Upgrades
    clearAddonsRepeater();
    if (Array.isArray(product.addons) && product.addons.length > 0) {
      currentAddonsList = product.addons.map((a) => ({ ...a }));
    }
    renderAddonsRepeater();

    // When editing, front bg is not required unless replacing
    document.getElementById("img-bg").required = false;

    // Trigger auto-resize for the description if it has content
    if (productDescriptionTextarea) {
      setTimeout(() => {
        productDescriptionTextarea.style.height = "auto";
        productDescriptionTextarea.style.height = productDescriptionTextarea.scrollHeight + "px";
      }, 0);
    }

    // Store existing images so we don't overwrite with blank if no new file is selected
    productForm.dataset.existingImages = JSON.stringify(product.images || {});
    productForm.dataset.existingThumbnails = JSON.stringify(product.thumbnails || []);
    productForm.dataset.meshyTaskId = product.meshyTaskId || "";
    productForm.dataset.modelUrl = product.modelUrl || "";
    productForm.dataset.meshyStatus = product.meshyStatus || "";
    productForm.dataset.productName = product.name || "";
    productForm.dataset.productDescription = product.description || "";

    // Snapshot original form data for unsaved changes detection
    productForm.dataset.origFormData = JSON.stringify({
      name: product.name || "",
      description: product.description || "",
      category: product.category || "",
      price: product.price || "",
      stock: product.stock || 0,
      height,
      width,
      length,
      unit,
      materials: [...currentMaterialTags],
      thumbnailsCount: existingThumbs.length,
    });

    isEditing = true;
    currentEditId = id;
    document.getElementById("modal-title").textContent = "Edit Product";
    hideDraftBanner();
    window.openModal();
  } catch (e) {
    console.error("Failed to parse product for editing", e);
  }
};

// --- Rendering ---
const renderInventory = (products) => {
  if (!inventoryList) return;
  inventoryList.innerHTML = "";

  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminInvPerPage));
  if (adminInvCurrentPage > totalPages) adminInvCurrentPage = totalPages;
  if (adminInvCurrentPage < 1) adminInvCurrentPage = 1;

  const startIndex = (adminInvCurrentPage - 1) * adminInvPerPage;
  const pagedProducts = products.slice(startIndex, startIndex + adminInvPerPage);

  if (pagedProducts.length === 0) {
    inventoryList.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">No products found. Add some!</td></tr>`;
  } else {
    pagedProducts.forEach((product) => {
      let statusClass = "status-in-stock";
      let statusText = "In Stock";

      if (product.stock === 0) {
        statusClass = "status-mto";
        statusText = "Made-to-Order";
      } else if (product.stock <= 2) {
        statusClass = "status-low-stock";
        statusText = `Showroom (${product.stock})`;
      } else {
        statusClass = "status-in-stock";
        statusText = `In Stock (${product.stock})`;
      }

      const thumbImage =
        (product.thumbnails && product.thumbnails[0]) ||
        (product.images && (product.images.isoImage || product.images.frontBg)) ||
        product.thumbnail ||
        "https://via.placeholder.com/48";
      const productPayload = btoa(encodeURIComponent(JSON.stringify(product)));

      const tr = document.createElement("tr");
      const priceFormatted = Number(product.price || 0).toLocaleString();
      tr.innerHTML = `
              <td>
                  <div class="table-product-info">
                      <img src="${thumbImage}" alt="${escapeHtml(product.name)}" class="table-product-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
                      <strong>${escapeHtml(product.name)}</strong>
                  </div>
              </td>
              <td>${escapeHtml(product.category)}</td>
              <td>₱${priceFormatted}</td>
              <td><span class="mat-val">${escapeHtml(product.material || "—")}</span></td>
              <td id="stock-cell-${product.id}">
                  ${product.stock !== undefined ? product.stock : 0}
              </td>
              <td><span class="status-badge ${statusClass}">${statusText}</span></td>
              <td>
                  <div class="action-btns">
                      ${
                        product.meshyTaskId || product.modelUrl
                          ? `<button class="btn-icon" title="View 3D Model" onclick="view3DModel('${product.id}')">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                      </button>`
                          : ""
                      }
                      <button class="btn-icon" title="Edit Product" onclick="editProduct('${product.id}', '${productPayload}')">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      </button>
                      <button class="btn-icon delete" onclick="deleteProduct('${product.id}')">
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                  </div>
              </td>
          `;
      inventoryList.appendChild(tr);
    });
  }

  renderInventoryPagination(totalItems, totalPages, startIndex);
};

function renderInventoryPagination(totalItems, totalPages) {
  const tableContainer = inventoryList ? inventoryList.closest(".table-container") : null;
  if (!tableContainer) return;

  renderPagination({
    container: tableContainer,
    currentPage: adminInvCurrentPage,
    totalPages,
    totalItems,
    pageSize: adminInvPerPage,
    pageSizeOptions: [5, 10, 25, 50, 100],
    urlParamPrefix: "inv",
    onPageChange: (newPage) => {
      adminInvCurrentPage = newPage;
      renderInventory(allProducts);
    },
    onPageSizeChange: (newSize) => {
      adminInvPerPage = newSize;
      adminInvCurrentPage = 1;
      renderInventory(allProducts);
    },
  });
}

function renderBars(container, entries, totalUnits) {
  if (!container) return;
  if (!entries.length || totalUnits <= 0) {
    container.innerHTML = `<div class="analytics-empty">No data yet.</div>`;
    return;
  }

  container.innerHTML = entries
    .map(([label, value]) => {
      const pct = Math.max(0, Math.min(100, (value / totalUnits) * 100));
      return `<div class="analytics-bar-row">
        <span class="analytics-bar-label">${escapeHtml(label)}</span>
        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="analytics-bar-value">${value}</span>
      </div>`;
    })
    .join("");
}

const CATEGORY_COLORS = [
  "#F3CA3E", // Lanica Yellow
  "#3B82F6", // Royal Blue
  "#10B981", // Emerald
  "#8B5CF6", // Purple
  "#F97316", // Orange
  "#EC4899", // Pink
  "#6366F1", // Indigo
  "#14B8A6", // Teal
];

function renderCategoryDonutChart(products) {
  if (!analyticsCategoryDonutEl || !analyticsCategoryLegendEl) return;
  if (!products || !products.length) {
    analyticsCategoryDonutEl.innerHTML = `<span style="color:#9ca3af; font-size:0.85rem;">No product categories</span>`;
    analyticsCategoryLegendEl.innerHTML = "";
    return;
  }

  const categoryCounts = {};
  products.forEach((p) => {
    const cat = String(p.category || "Uncategorized").trim() || "Uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const entries = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const total = products.length;

  let cumulativePercent = 0;
  const size = 180;
  const radius = 70;
  const strokeWidth = 22;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  let svgPaths = `<svg viewBox="0 0 ${size} ${size}">`;

  entries.forEach(([cat, count], idx) => {
    const percent = count / total;
    const dashArray = `${percent * circumference} ${circumference}`;
    const dashOffset = -cumulativePercent * circumference;
    const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];

    svgPaths += `<circle
      cx="${center}"
      cy="${center}"
      r="${radius}"
      fill="transparent"
      stroke="${color}"
      stroke-width="${strokeWidth}"
      stroke-dasharray="${dashArray}"
      stroke-dashoffset="${dashOffset}"
    />`;

    cumulativePercent += percent;
  });

  svgPaths += `<text x="50%" y="46%" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="bold" fill="#111827">${total}</text>`;
  svgPaths += `<text x="50%" y="60%" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="500" fill="#6b7280">Products</text>`;
  svgPaths += `</svg>`;

  analyticsCategoryDonutEl.innerHTML = svgPaths;

  analyticsCategoryLegendEl.innerHTML = entries
    .map(([cat, count], idx) => {
      const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
      const pct = ((count / total) * 100).toFixed(0);
      return `<div class="donut-legend-item">
        <span class="donut-legend-color" style="background-color: ${color};"></span>
        <span><strong>${escapeHtml(cat)}</strong>: ${count} (${pct}%)</span>
      </div>`;
    })
    .join("");
}

function renderMtoProductionWatchlist(orders) {
  if (!analyticsLowStockListEl) return;
  const activeOrders = Array.isArray(orders)
    ? orders.filter((o) => normalizeOrderAction(o.action) !== "delete")
    : [];

  // Filter for orders in the Made-to-Order lifecycle
  const mtoOrders = activeOrders
    .filter((o) => {
      const st = normalizeOrderStatus(o.status);
      return st === "placed" || st === "downpayment confirmed" || st === "in production" || st === "quality checked";
    })
    .sort((a, b) => {
      const tA = orderTimestampMs(a);
      const tB = orderTimestampMs(b);
      return tA - tB;
    });

  if (analyticsMtoCountBadgeEl) {
    analyticsMtoCountBadgeEl.textContent = `${mtoOrders.length} In Workshop Queue`;
  }

  if (!mtoOrders.length) {
    analyticsLowStockListEl.innerHTML = `
      <div class="analytics-empty" style="color: #059669; font-weight: 500; padding: 24px; text-align: center;">
        ✨ All Made-to-Order furniture requests are currently fulfilled and shipped! No backlog in workshop.
      </div>`;
    return;
  }

  analyticsLowStockListEl.innerHTML = mtoOrders
    .map((o) => {
      const st = normalizeOrderStatus(o.status);
      let pillClass = "production";
      let statusLabel = "In Production";
      if (st === "downpayment confirmed") {
        pillClass = "downpayment";
        statusLabel = "Downpayment Confirmed";
      } else if (st === "quality checked") {
        pillClass = "quality";
        statusLabel = "Quality Check Passed";
      } else if (st === "placed") {
        pillClass = "downpayment";
        statusLabel = "Order Placed";
      }

      const items = Array.isArray(o.items) ? o.items : [];
      const itemDesc = items.length
        ? items
            .map(
              (it) =>
                `${escapeHtml(it.name || "Custom Piece")}${it.material ? ` (${escapeHtml(it.material)})` : ""}${
                  it.quantity > 1 ? ` × ${it.quantity}` : ""
                }`
            )
            .join(", ")
        : "Custom Furniture Order";

      const customer = resolveCustomerDisplay(o);
      const totalAmount = formatPeso(Number(o.total != null ? o.total : o.totalAmount) || 0);

      let dateStr = "Recently";
      if (o.createdAt && typeof o.createdAt.toDate === "function") {
        dateStr = o.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } else if (o.createdAt && o.createdAt.seconds) {
        dateStr = new Date(o.createdAt.seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      const leadTime = o.estimatedLeadTime || "14–21 Business Days (Crafted Upon Order)";

      return `
        <div class="mto-watchlist-item">
          <div class="mto-item-main">
            <div class="mto-item-title">${itemDesc}</div>
            <div class="mto-item-meta">
              <span>Order <strong>#${escapeHtml(o.orderId || o.id || "—")}</strong></span>
              <span>•</span>
              <span>Customer: <strong>${escapeHtml(customer)}</strong></span>
              <span>•</span>
              <span>Value: <strong>${totalAmount}</strong></span>
              <span>•</span>
              <span>Ordered: ${dateStr}</span>
            </div>
          </div>
          <div class="mto-item-status-col">
            <span class="mto-status-pill ${pillClass}">${statusLabel}</span>
            <span class="mto-item-leadtime">⏱ ${escapeHtml(leadTime)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

const updateStats = (products) => {
  const totalCatalogListings = products ? products.length : 0;
  const activeOrders = Array.isArray(allOrders)
    ? allOrders.filter((o) => normalizeOrderAction(o.action) !== "delete")
    : [];

  const inProductionOrders = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "placed" || st === "downpayment confirmed" || st === "in production" || st === "quality checked";
  });
  const inProductionCount = inProductionOrders.length;

  const completedOrders = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "delivered" || st === "shipped";
  });

  const totalBookings = activeOrders.reduce((sum, o) => {
    const val = Number(o.total != null ? o.total : o.totalAmount) || 0;
    return sum + val;
  }, 0);

  const totalCashCollected = activeOrders.reduce((sum, o) => {
    const total = Number(o.total != null ? o.total : o.totalAmount) || 0;
    if (o.balanceStatus === "settled" || o.paymentOption === "full" || o.balanceSettlementMethod === "full_paid") {
      return sum + total;
    }
    const dp = Number(o.downpaymentAmount);
    if (!isNaN(dp) && dp > 0) return sum + dp;
    return sum + total * 0.3; // Standard 30% downpayment
  }, 0);

  const totalBalanceDue = Math.max(0, totalBookings - totalCashCollected);

  // Top stats grid
  if (totalProductsStat) totalProductsStat.textContent = totalCatalogListings;
  if (lowStockStat) lowStockStat.textContent = inProductionCount;
  if (analyticsMtoSubEl) {
    const pct = activeOrders.length ? ((inProductionCount / activeOrders.length) * 100).toFixed(0) : 0;
    analyticsMtoSubEl.textContent = `${pct}% of total bookings in queue`;
  }
  if (totalValueStat) {
    totalValueStat.textContent = formatPeso(totalBookings);
  }
  if (analyticsCashCollectedEl) {
    analyticsCashCollectedEl.textContent = formatPeso(totalCashCollected);
  }
  if (analyticsBalanceDueEl) {
    analyticsBalanceDueEl.textContent = `${formatPeso(totalBalanceDue)} balance pending`;
  }

  // Production & Order Health Card
  if (analyticsTotalUnitsEl) analyticsTotalUnitsEl.textContent = String(activeOrders.length);
  if (analyticsOutOfStockEl) analyticsOutOfStockEl.textContent = String(inProductionCount);
  if (analyticsAvgPriceEl) {
    const avgOrder = activeOrders.length ? totalBookings / activeOrders.length : 0;
    analyticsAvgPriceEl.textContent = formatPeso(avgOrder);
  }
  if (analyticsAvgStockEl) analyticsAvgStockEl.textContent = String(completedOrders.length);

  // Customer Material Preferences (from actual order items + catalog options)
  const materialCounts = {};
  activeOrders.forEach((o) => {
    (o.items || []).forEach((it) => {
      const mat = (it.material || "").trim();
      if (mat) {
        materialCounts[mat] = (materialCounts[mat] || 0) + (parseInt(it.quantity, 10) || 1);
      }
    });
  });
  if (products) {
    products.forEach((p) => {
      const mats = Array.isArray(p.materials) ? p.materials : (p.material ? p.material.split(",") : []);
      mats.forEach((m) => {
        const clean = m.trim();
        if (clean && !materialCounts[clean]) materialCounts[clean] = 0;
      });
    });
  }

  const materialEntries = Object.entries(materialCounts).sort((a, b) => b[1] - a[1]);
  const totalMaterialUnits = Object.values(materialCounts).reduce((a, b) => a + b, 0);
  renderBars(analyticsMaterialBarsEl, materialEntries, Math.max(1, totalMaterialUnits));

  if (products) renderCategoryDonutChart(products);
  renderMtoProductionWatchlist(allOrders);
  updateDashboardKpis(products, allOrders);
};

// --- Order Management (Firestore `orders` + inventory stock) ---
// App checkout should write orders with: items[{ productId, quantity, name?, price?, material? }],
// status, customerId / customerEmail, total, createdAt. Staff: users with role === "staff".

const ordersListEl = document.getElementById("orders-list");
const ordersHistoryListEl = document.getElementById("orders-history-list");
const ordersStatusFilter = document.getElementById("orders-status-filter");
const toggleBatchDeleteModeBtn = document.getElementById("toggle-batch-delete-mode-btn");
const batchDeleteControlsEl = document.getElementById("batch-delete-controls");
const ordersSelectHeaderEl = document.getElementById("orders-select-header");
const selectAllDeclinedEl = document.getElementById("select-all-declined");
const batchDeleteDeclinedBtn = document.getElementById("batch-delete-declined-btn");
const usersRoleFilter = document.getElementById("users-role-filter");
const usersListEl = document.getElementById("users-list");
const usersTotalEl = document.getElementById("users-total");
const usersAdminsEl = document.getElementById("users-admins");
const usersStaffEl = document.getElementById("users-staff");
const usersInactiveEl = document.getElementById("users-inactive");
const navDashboard = document.getElementById("nav-dashboard");
const navInventory = document.getElementById("nav-inventory");
const navAnalytics = document.getElementById("nav-analytics");
const navWorkshop = document.getElementById("nav-workshop");
const navChats = document.getElementById("nav-chats");
const navOrders = document.getElementById("nav-orders");
const navTransactions = document.getElementById("nav-transactions");
const navUsers = document.getElementById("nav-users");
const navAuditLogs = document.getElementById("nav-audit-logs");
const dashboardSection = document.getElementById("dashboard-section");
const inventorySection = document.getElementById("inventory-section");
const analyticsSection = document.getElementById("analytics-section");
const workshopSection = document.getElementById("workshop-section");
const chatsSection = document.getElementById("chats-section");
const ordersSection = document.getElementById("orders-section");
const transactionsSection = document.getElementById("transactions-section");
const usersSection = document.getElementById("users-section");
const auditLogsSection = document.getElementById("audit-logs-section");

const dashTotalRevenueEl = document.getElementById("dash-total-revenue");
const dashPendingOrdersEl = document.getElementById("dash-pending-orders");
const dashLowStockEl = document.getElementById("dash-low-stock");
const dashTotalProductsEl = document.getElementById("dash-total-products");
const dashRecentOrdersListEl = document.getElementById("dash-recent-orders-list");
const dashActionAddProduct = document.getElementById("dash-action-add-product");
const dashActionViewOrders = document.getElementById("dash-action-view-orders");
const dashActionExportCsv = document.getElementById("dash-action-export-csv");
const dashLinkAllOrders = document.getElementById("dash-link-all-orders");

const analyticsCategoryDonutEl = document.getElementById("analytics-category-donut");
const analyticsCategoryLegendEl = document.getElementById("analytics-category-legend");

let allOrders = [];
let ordersFilterValue = "all";
let adminOrdersSearchQuery = "";
let adminChatSearchQuery = "";
const selectedDeclinedOrderIds = new Set();
let isBatchDeleteMode = false;
let allUsers = [];
let usersFilterValue = "all";
const customerNameByUid = new Map();
const customerNameByEmail = new Map();
let customerHydrationInFlight = false;

// Global pagination and user management state
let activeUserTab = "customers";
let usersCurrentPage = 1;
let usersPerPage = 10;
let usersSearchQuery = "";
let adminInvCurrentPage = 1;
let adminInvPerPage = 10;
let dashRecentOrdersCurrentPage = 1;
let dashRecentOrdersPerPage = 5;
let adminTransCurrentPage = 1;
let adminTransPerPage = 10;

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position: fixed; bottom: 24px; right: 24px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.style.cssText = `background: ${type === "error" ? "#ef4444" : "#10b981"}; color: #fff; padding: 12px 20px; border-radius: 8px; font-weight: 500; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 8px; transition: opacity 0.3s; z-index: 10000;`;
  toast.innerHTML = `<span>${type === "error" ? "⚠️" : "✓"}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

const ORDERS_COLLECTION = collection(db, "orders");

async function getUserRole(user) {
  if (!user) return null;

  try {
    const roleByUid = await getDoc(doc(db, "users", user.uid));
    if (roleByUid.exists()) {
      const role = (roleByUid.data().role || "").toLowerCase();
      console.log("Admin page - Role found by UID:", role);
      return role;
    }
  } catch (e) {
    console.warn("Admin page - Could not read user role by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const role = ((snap.docs[0].data() || {}).role || "").toLowerCase();
      console.log("Admin page - Role found by email:", role);
      return role;
    }
  } catch (e) {
    console.warn("Admin page - Could not read user role by email:", e);
  }

  console.log("Admin page - No role found for user, returning null");
  return null;
}

function escapeHtml(str) {
  if (str == null || str === undefined) return "";
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}

function pickFirstNonEmpty(...values) {
  for (const v of values) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function resolveCustomerDisplay(order) {
  if (!order) return "—";

  const first = pickFirstNonEmpty(order.firstName, order.firstname, order.fname);
  const last = pickFirstNonEmpty(order.lastName, order.lastname, order.lname);
  const fullFromParts = pickFirstNonEmpty(`${first} ${last}`.trim());

  const fromAddress =
    (order.shippingAddress &&
      pickFirstNonEmpty(order.shippingAddress.fullName, order.shippingAddress.name)) ||
    (order.deliveryAddress &&
      pickFirstNonEmpty(order.deliveryAddress.fullName, order.deliveryAddress.name)) ||
    (order.address && pickFirstNonEmpty(order.address.fullName, order.address.name)) ||
    (order.shippingInfo &&
      pickFirstNonEmpty(order.shippingInfo.fullName, order.shippingInfo.name)) ||
    (order.customer && pickFirstNonEmpty(order.customer.fullName, order.customer.name)) ||
    "";

  return (
    pickFirstNonEmpty(
      order.customerNameResolved,
      order.customerName,
      order.customerFullName,
      order.fullName,
      order.name,
      order.displayName,
      order.orderedByName,
      order.userName,
      order.customerDisplayName,
      order.orderByName,
      order.buyerName,
      fromAddress,
      fullFromParts,
      order.customerEmail,
      order.email,
      order.customerId
    ) || "—"
  );
}

async function fetchCustomerNameFromUsers(order) {
  const customerId = pickFirstNonEmpty(
    order.customerId,
    order.customerUid,
    order.userId,
    order.userUid,
    order.uid,
    order.orderedByUid,
    order.buyerUid,
    order.createdByUid
  );
  const customerEmail = pickFirstNonEmpty(
    order.customerEmail,
    order.userEmail,
    order.email,
    order.orderedByEmail,
    order.buyerEmail
  );

  if (customerId && customerNameByUid.has(customerId)) {
    return customerNameByUid.get(customerId) || "";
  }
  if (customerEmail && customerNameByEmail.has(customerEmail)) {
    return customerNameByEmail.get(customerEmail) || "";
  }

  // Fast path: users/{customerId}
  if (customerId) {
    try {
      const byDoc = await getDoc(doc(db, "users", customerId));
      if (byDoc.exists()) {
        const d = byDoc.data() || {};
        const name = pickFirstNonEmpty(d.displayName, d.name, d.fullName);
        if (name) {
          customerNameByUid.set(customerId, name);
          if (d.email) customerNameByEmail.set(String(d.email), name);
          return name;
        }
      }
    } catch (e) {
      console.warn("Could not read customer profile by id:", e);
    }
  }

  // Fallback by uid field
  if (customerId) {
    try {
      const qByUid = query(collection(db, "users"), where("uid", "==", customerId));
      const snapByUid = await getDocs(qByUid);
      if (!snapByUid.empty) {
        const d = snapByUid.docs[0].data() || {};
        const name = pickFirstNonEmpty(d.displayName, d.name, d.fullName);
        if (name) {
          customerNameByUid.set(customerId, name);
          if (d.email) customerNameByEmail.set(String(d.email), name);
          return name;
        }
      }
    } catch (e) {
      console.warn("Could not read customer profile by uid field:", e);
    }
  }

  // Fallback by email
  if (customerEmail) {
    try {
      const qByEmail = query(collection(db, "users"), where("email", "==", customerEmail));
      const snapByEmail = await getDocs(qByEmail);
      if (!snapByEmail.empty) {
        const d = snapByEmail.docs[0].data() || {};
        const name = pickFirstNonEmpty(d.displayName, d.name, d.fullName);
        if (name) {
          customerNameByEmail.set(customerEmail, name);
          if (d.uid) customerNameByUid.set(String(d.uid), name);
          return name;
        }
      }
    } catch (e) {
      console.warn("Could not read customer profile by email:", e);
    }
  }

  return "";
}

async function hydrateCustomerNamesForOrders(orders) {
  if (customerHydrationInFlight) return;
  customerHydrationInFlight = true;
  try {
    let changed = false;
    const targets = orders.filter((o) => {
      const alreadyHasName = pickFirstNonEmpty(
        o.customerNameResolved,
        o.customerName,
        o.customerFullName,
        o.fullName,
        o.name,
        o.displayName,
        o.orderedByName,
        o.orderByName,
        o.buyerName
      );
      return !alreadyHasName;
    });

    await Promise.allSettled(
      targets.map(async (o) => {
        const name = await fetchCustomerNameFromUsers(o);
        if (name && o.customerNameResolved !== name) {
          o.customerNameResolved = name;
          changed = true;
        }
      })
    );

    if (changed) applyOrdersFilter();
  } finally {
    customerHydrationInFlight = false;
  }
}

function normalizeOrderStatus(raw) {
  if (raw == null) return "placed";
  const s = String(raw).toLowerCase().trim();
  if (s === "pending" || s === "order placed" || s === "placed") return "placed";
  if (s === "accepted" || s === "confirmed" || s === "deposit confirmed" || s === "downpayment confirmed") return "downpayment confirmed";
  if (s === "processing" || s === "packed" || s === "crafting" || s === "fabrication" || s === "in production") return "in production";
  if (s === "inspected" || s === "qc passed" || s === "quality check" || s === "quality checked") return "quality checked";
  if (s === "dispatched" || s === "out for delivery" || s === "shipped" || s === "shipping" || s === "in transit") return "shipped";
  if (s === "completed" || s === "received" || s === "arrived" || s === "delivered") return "delivered";
  if (s === "declined" || s === "cancelled" || s === "canceled") return "cancelled";
  return "placed";
}

function normalizeOrderAction(raw) {
  if (raw == null) return "";
  return String(raw).toLowerCase().trim();
}

function isOrderCompleted(order) {
  const status = normalizeOrderStatus(order.status);
  return (
    status === "completed" ||
    status === "received" ||
    order.orderReceived === true ||
    !!order.orderReceivedAt ||
    !!order.receivedAt ||
    !!order.completedAt
  );
}

function getCompletedAtLabel(order) {
  const t = order.orderReceivedAt || order.receivedAt || order.completedAt || order.updatedAt;
  if (!t) return "—";
  if (typeof t.toDate === "function") return t.toDate().toLocaleString();
  if (t.seconds) return new Date(t.seconds * 1000).toLocaleString();
  return "—";
}

function resolveAssignedStaffName(order) {
  if (order.assignedToName) return order.assignedToName;
  if (!order.assignedToUid) return "Unassigned";
  const staff = staffMembers.find((s) => s.uid === order.assignedToUid);
  return staff ? staff.displayName : order.assignedToUid;
}

function orderTimestampMs(o) {
  const c = o.createdAt;
  if (!c) return 0;
  if (typeof c.toDate === "function") return c.toDate().getTime();
  if (c.seconds) return c.seconds * 1000;
  return 0;
}

function orderEventDate(order) {
  const t =
    order.orderReceivedAt ||
    order.receivedAt ||
    order.completedAt ||
    order.updatedAt ||
    order.createdAt ||
    null;
  if (!t) return null;
  if (typeof t.toDate === "function") return t.toDate();
  if (t.seconds) return new Date(t.seconds * 1000);
  return null;
}

function formatPeso(value) {
  return `₱${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateToInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function diffDaysInclusive(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.floor((endOnly - startOnly) / msPerDay) + 1;
}

function setDateValidationMessage(msg, isError = true) {
  if (!ordersDateValidationEl) return;
  ordersDateValidationEl.textContent = msg || "";
  ordersDateValidationEl.classList.toggle("is-error", !!msg && isError);
}

function validateDateRange() {
  if (!ordersDateStartEl || !ordersDateEndEl) return { valid: false };
  if (!ordersDateStartEl.value || !ordersDateEndEl.value) {
    setDateValidationMessage("Please select both start and end dates.");
    return { valid: false };
  }

  const start = new Date(`${ordersDateStartEl.value}T00:00:00`);
  const endDay = new Date(`${ordersDateEndEl.value}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endDay.getTime())) {
    setDateValidationMessage("Invalid date selected.");
    return { valid: false };
  }

  if (start > endDay) {
    setDateValidationMessage("Start date must be earlier than or equal to end date.");
    return { valid: false };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (endDay > today) {
    setDateValidationMessage("End date cannot be in the future.");
    return { valid: false };
  }

  const days = diffDaysInclusive(start, endDay);
  if (days > 366) {
    setDateValidationMessage("Please select a range of 366 days or less.");
    return { valid: false };
  }

  setDateValidationMessage("");
  const end = new Date(endDay);
  end.setHours(23, 59, 59, 999);
  return { valid: true, start, end, days };
}

function getOrderRevenue(order) {
  const total = Number(order.total != null ? order.total : order.totalAmount);
  if (!Number.isNaN(total) && Number.isFinite(total)) return total;

  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item) => {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const unitPrice = Number(item.price || item.unitPrice || 0);
    return sum + (Number.isFinite(unitPrice) ? unitPrice : 0) * qty;
  }, 0);
}

function getRevenueBuckets(orders, startDate, endDate, granularity) {
  const buckets = [];
  const keyOf = (dt) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    if (granularity === "month") return `${y}-${m}`;
    if (granularity === "week") {
      const startOfWeek = new Date(dt);
      startOfWeek.setHours(0, 0, 0, 0);
      const day = startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() - day);
      const swy = startOfWeek.getFullYear();
      const swm = String(startOfWeek.getMonth() + 1).padStart(2, "0");
      const swd = String(startOfWeek.getDate()).padStart(2, "0");
      return `${swy}-${swm}-${swd}`;
    }
    return `${y}-${m}-${d}`;
  };
  const labelOf = (dt) => {
    if (granularity === "month")
      return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    if (granularity === "week") {
      const end = new Date(dt);
      end.setDate(end.getDate() + 6);
      return `${dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    }
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  const seen = new Set();
  let guard = 0;
  while (cursor <= end && guard < 800) {
    const key = keyOf(cursor);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push({ key, label: labelOf(cursor), revenue: 0, profit: 0 }); // profit represents cash collections
    }
    if (granularity === "month") cursor.setMonth(cursor.getMonth() + 1, 1);
    else if (granularity === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  const indexByKey = new Map(buckets.map((b, idx) => [b.key, idx]));
  orders.forEach((order) => {
    const st = normalizeOrderStatus(order.status);
    if (st === "cancelled" || normalizeOrderAction(order.action) === "delete") return;
    const dt = orderEventDate(order);
    if (!dt) return;
    const ms = dt.getTime();
    if (ms < startDate.getTime() || ms > endDate.getTime()) return;
    const key = keyOf(dt);
    const idx = indexByKey.get(key);
    if (idx == null) return;

    const revenue = getOrderRevenue(order);
    let collected = 0;
    if (order.balanceStatus === "settled" || order.paymentOption === "full" || order.balanceSettlementMethod === "full_paid") {
      collected = revenue;
    } else {
      const dp = Number(order.downpaymentAmount);
      collected = !isNaN(dp) && dp > 0 ? dp : revenue * 0.3;
    }

    buckets[idx].revenue += revenue;
    buckets[idx].profit += collected;
  });

  return buckets;
}

function renderRevenueGraph() {
  if (!ordersRevenueGraphEl) return;
  const range = validateDateRange();
  if (!range.valid) {
    ordersRevenueGraphEl.innerHTML = `<div class="analytics-empty">Please correct the date range.</div>`;
    ordersRevenueGraphEl.style.gridTemplateColumns = "1fr";
    if (ordersTotalRevenueEl) ordersTotalRevenueEl.textContent = formatPeso(0);
    if (ordersTotalProfitEl) ordersTotalProfitEl.textContent = formatPeso(0);
    if (ordersBalanceDueEl) ordersBalanceDueEl.textContent = formatPeso(0);
    return;
  }

  const granularity = range.days > 180 ? "month" : range.days > 45 ? "week" : "day";
  const buckets = getRevenueBuckets(allOrders, range.start, range.end, granularity);
  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(Number(b.revenue) || 0, Number(b.profit) || 0))
  );
  const totalRevenue = buckets.reduce((sum, b) => sum + b.revenue, 0);
  const totalCollected = buckets.reduce((sum, b) => sum + b.profit, 0);
  const totalBalanceDue = Math.max(0, totalRevenue - totalCollected);

  if (ordersTotalRevenueEl) ordersTotalRevenueEl.textContent = formatPeso(totalRevenue);
  if (ordersTotalProfitEl) ordersTotalProfitEl.textContent = formatPeso(totalCollected);
  if (ordersBalanceDueEl) ordersBalanceDueEl.textContent = formatPeso(totalBalanceDue);

  if (!buckets.length) {
    ordersRevenueGraphEl.innerHTML = `<div class="analytics-empty">No revenue data yet.</div>`;
    ordersRevenueGraphEl.style.gridTemplateColumns = "1fr";
    return;
  }
  ordersRevenueGraphEl.style.gridTemplateColumns = `repeat(${buckets.length}, minmax(0, 1fr))`;
  const labelInterval =
    buckets.length > 36 ? 6 : buckets.length > 20 ? 3 : buckets.length > 12 ? 2 : 1;

  ordersRevenueGraphEl.innerHTML = buckets
    .map((bucket, index) => {
      const revPct = Math.max(0, Math.min(100, (bucket.revenue / maxValue) * 100));
      const profitPct = Math.max(0, Math.min(100, (Math.max(bucket.profit, 0) / maxValue) * 100));
      const hasData = bucket.revenue > 0 || bucket.profit > 0;
      const showLabel = index % labelInterval === 0 || index === buckets.length - 1;
      return `<div class="orders-revenue-row">
        <div class="orders-revenue-bars">
          <div class="orders-revenue-fill revenue" style="height:${revPct.toFixed(1)}%" title="Gross Bookings: ${escapeHtml(
            formatPeso(bucket.revenue)
          )}"></div>
          <div class="orders-revenue-fill profit" style="height:${profitPct.toFixed(1)}%" title="Cash Collected: ${escapeHtml(
            formatPeso(bucket.profit)
          )}"></div>
        </div>
        <span class="orders-revenue-label ${showLabel ? "is-visible" : ""} ${hasData ? "has-data" : ""}">${escapeHtml(
          bucket.label
        )}</span>
        <div class="orders-revenue-values" title="Bookings: ${escapeHtml(formatPeso(bucket.revenue))} | Collected: ${escapeHtml(
          formatPeso(bucket.profit)
        )}">
          ${hasData ? `Booked ${escapeHtml(formatPeso(bucket.revenue))}<br/>Paid ${escapeHtml(formatPeso(bucket.profit))}` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function materialHint(m) {
  const x = (m == null ? "" : String(m)).toLowerCase();
  if (x.includes("leather")) return "leather";
  if (x.includes("fabric")) return "fabric";
  return null;
}

function exportInventoryCsv() {
  if (!allProducts || !allProducts.length) {
    alert("No inventory data available to export.");
    return;
  }

  const headers = ["Product ID", "Name", "Category", "Price (PHP)", "Stock", "Materials", "Dimensions"];
  const csvRows = [headers.join(",")];

  allProducts.forEach((p) => {
    let dimsStr = "";
    if (p.dimensions && typeof p.dimensions.height === "number") {
      dimsStr = p.dimensions.length
        ? `${p.dimensions.length} × ${p.dimensions.width} × ${p.dimensions.height} ${p.dimensions.unit || "in"}`
        : `${p.dimensions.width} × ${p.dimensions.height} ${p.dimensions.unit || "in"}`;
    } else if (p.size) {
      dimsStr = typeof p.size === "string" ? p.size : `${p.size.w || 0} × ${p.size.h || 0} in`;
    }

    const matStr = Array.isArray(p.materials) ? p.materials.join("; ") : p.material || "";

    const row = [
      `"${(p.id || "").replace(/"/g, '""')}"`,
      `"${(p.name || "").replace(/"/g, '""')}"`,
      `"${(p.category || "").replace(/"/g, '""')}"`,
      Number(p.price || 0).toFixed(2),
      Number(p.stock || 0),
      `"${matStr.replace(/"/g, '""')}"`,
      `"${dimsStr.replace(/"/g, '""')}"`
    ];
    csvRows.push(row.join(","));
  });

  const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(csvRows.join("\n"));
  const link = document.createElement("a");
  link.setAttribute("href", csvContent);
  const dateStr = new Date().toISOString().split("T")[0];
  link.setAttribute("download", `lanica-inventory-${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function updateDashboardKpis(products, orders) {
  const totalProducts = products ? products.length : 0;
  const activeOrders = orders ? orders.filter((o) => normalizeOrderAction(o.action) !== "delete") : [];

  // Workshop Queue: active orders in Made-to-Order production lifecycle
  const workshopQueueCount = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "placed" || st === "downpayment confirmed" || st === "in production" || st === "quality checked";
  }).length;

  const pendingOrdersCount = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "placed" || st === "downpayment confirmed";
  }).length;

  const totalRevenue = activeOrders
    .filter((o) => {
      const st = normalizeOrderStatus(o.status);
      return st !== "cancelled";
    })
    .reduce((sum, o) => sum + (Number(o.total != null ? o.total : o.totalAmount) || 0), 0);

  if (dashTotalRevenueEl) {
    dashTotalRevenueEl.textContent =
      "₱" + totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (dashPendingOrdersEl) dashPendingOrdersEl.textContent = String(pendingOrdersCount);
  if (dashLowStockEl) dashLowStockEl.textContent = String(workshopQueueCount);
  if (dashTotalProductsEl) dashTotalProductsEl.textContent = String(totalProducts);

  renderDashboardRecentOrders(activeOrders.slice(0, 5));
}

function renderDashboardRecentOrders(recentOrders) {
  if (!dashRecentOrdersListEl) return;
  dashRecentOrdersListEl.innerHTML = "";

  if (!recentOrders || recentOrders.length === 0) {
    dashRecentOrdersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #6b7280;">No customer orders recorded yet.</td></tr>`;
    renderDashRecentOrdersPagination(0, 1);
    return;
  }

  const totalItems = recentOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / dashRecentOrdersPerPage));
  if (dashRecentOrdersCurrentPage > totalPages) dashRecentOrdersCurrentPage = totalPages;
  if (dashRecentOrdersCurrentPage < 1) dashRecentOrdersCurrentPage = 1;

  const startIndex = (dashRecentOrdersCurrentPage - 1) * dashRecentOrdersPerPage;
  const pagedOrders = recentOrders.slice(startIndex, startIndex + dashRecentOrdersPerPage);

  pagedOrders.forEach((order) => {
    const st = normalizeOrderStatus(order.status);
    const created = order.createdAt;
    let dateStr = "—";
    if (created && typeof created.toDate === "function") {
      dateStr = created.toDate().toLocaleDateString();
    } else if (created && created.seconds) {
      dateStr = new Date(created.seconds * 1000).toLocaleDateString();
    }

    const customer = resolveCustomerDisplay(order);
    const total = order.total != null ? order.total : order.totalAmount;
    const totalStr =
      total != null && total !== ""
        ? `₱${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="font-size:0.88rem;">${escapeHtml((order.id || "").slice(0, 8))}…</strong></td>
      <td>${escapeHtml(String(customer))}</td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td><strong>${totalStr}</strong></td>
      <td><span class="order-status-badge order-status-${escapeHtml(st)}">${escapeHtml(st.charAt(0).toUpperCase() + st.slice(1))}</span></td>
      <td style="font-size:0.85rem; color:#6b7280;">${escapeHtml(dateStr)}</td>
    `;
    dashRecentOrdersListEl.appendChild(tr);
  });

  renderDashRecentOrdersPagination(totalItems, totalPages);
}

function renderDashRecentOrdersPagination(totalItems, totalPages) {
  const container = dashRecentOrdersListEl ? dashRecentOrdersListEl.closest(".table-container") : null;
  if (!container) return;

  renderPagination({
    container,
    currentPage: dashRecentOrdersCurrentPage,
    totalPages,
    totalItems,
    pageSize: dashRecentOrdersPerPage,
    pageSizeOptions: [5, 10, 25, 50],
    urlParamPrefix: "dashOrders",
    onPageChange: (newPage) => {
      dashRecentOrdersCurrentPage = newPage;
      updateDashboardKpis(allProducts, allOrders);
    },
    onPageSizeChange: (newSize) => {
      dashRecentOrdersPerPage = newSize;
      dashRecentOrdersCurrentPage = 1;
      updateDashboardKpis(allProducts, allOrders);
    },
  });
}

function showAdminSection(name) {
  const showDash = name === "dashboard" || !name;
  const showInv = name === "inventory";
  const showAnalytics = name === "analytics";
  const showWorkshop = name === "workshop";
  const showChats = name === "chats";
  const showOrders = name === "orders";
  const showTransactions = name === "transactions";
  const showUsers = name === "users";
  const showAuditLogs = name === "audit-logs";

  if (dashboardSection) dashboardSection.classList.toggle("is-hidden", !showDash);
  if (inventorySection) inventorySection.classList.toggle("is-hidden", !showInv);
  if (analyticsSection) analyticsSection.classList.toggle("is-hidden", !showAnalytics);
  if (workshopSection) workshopSection.classList.toggle("is-hidden", !showWorkshop);
  if (chatsSection) chatsSection.classList.toggle("is-hidden", !showChats);
  if (ordersSection) ordersSection.classList.toggle("is-hidden", !showOrders);
  if (transactionsSection) transactionsSection.classList.toggle("is-hidden", !showTransactions);
  if (usersSection) usersSection.classList.toggle("is-hidden", !showUsers);
  if (auditLogsSection) auditLogsSection.classList.toggle("is-hidden", !showAuditLogs);

  if (navDashboard) navDashboard.classList.toggle("active", showDash);
  if (navInventory) navInventory.classList.toggle("active", showInv);
  if (navAnalytics) navAnalytics.classList.toggle("active", showAnalytics);
  if (navWorkshop) navWorkshop.classList.toggle("active", showWorkshop);
  if (navChats) navChats.classList.toggle("active", showChats);
  if (navOrders) navOrders.classList.toggle("active", showOrders);
  if (navTransactions) navTransactions.classList.toggle("active", showTransactions);
  if (navUsers) navUsers.classList.toggle("active", showUsers);
  if (navAuditLogs) navAuditLogs.classList.toggle("active", showAuditLogs);

  if (showWorkshop) renderWorkshopQueue(allOrders);
  if (showTransactions) renderAdminTransactionsList(allOrders);
  if (showAuditLogs) renderAuditLogsSection();

  window.location.hash = name || "dashboard";
}

function renderAdminTransactionsList(orders) {
  const tbody = document.getElementById("admin-transactions-table-body");
  const pagContainer = document.getElementById("admin-transactions-pagination-container");
  if (!tbody) return;

  const validOrders = Array.isArray(orders) ? orders : allOrders;
  if (!validOrders || validOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 32px; color: #9ca3af;">No transaction records found.</td></tr>`;
    if (pagContainer) pagContainer.innerHTML = "";
    return;
  }

  const totalItems = validOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminTransPerPage));
  if (adminTransCurrentPage > totalPages) adminTransCurrentPage = totalPages;
  if (adminTransCurrentPage < 1) adminTransCurrentPage = 1;

  const startIndex = (adminTransCurrentPage - 1) * adminTransPerPage;
  const pagedOrders = validOrders.slice(startIndex, startIndex + adminTransPerPage);

  tbody.innerHTML = "";
  pagedOrders.forEach((order) => {
    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
    const totalVal = Number(order.totalAmount || order.total || 0);
    const paidVal = Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.3) : totalVal));
    const payStatus = order.paymentStatus || (isDownpayment ? "Downpayment Confirmed" : "Paid");
    const pMethod = order.paymentMethod || "COD";
    const refNum = order.orderId || order.id || "N/A";

    let dateStr = "Recently";
    if (order.createdAt && typeof order.createdAt.toDate === "function") {
      dateStr = order.createdAt.toDate().toLocaleString();
    } else if (order.createdAt && order.createdAt.seconds) {
      dateStr = new Date(order.createdAt.seconds * 1000).toLocaleString();
    }

    const customer = order.customerName || order.shippingAddress?.recipientName || order.userEmail || "Customer";

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #f1f5f9";
    tr.innerHTML = `
      <td style="padding: 14px 18px;"><strong>TX-${escapeHtml(String(refNum).slice(0, 10))}</strong></td>
      <td style="padding: 14px 18px; font-size: 0.82rem; color: #64748b;">${escapeHtml(dateStr)}</td>
      <td style="padding: 14px 18px; font-weight: 600; color: #0f172a;">${escapeHtml(refNum)}</td>
      <td style="padding: 14px 18px; font-weight: 500;">${escapeHtml(customer)}</td>
      <td style="padding: 14px 18px;"><span style="font-size: 0.8rem; background: #f1f5f9; padding: 4px 8px; border-radius: 6px;">${isDownpayment ? "30% Downpayment" : "Full Payment"}</span></td>
      <td style="padding: 14px 18px; font-weight: 700; color: #059669;">₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td style="padding: 14px 18px; font-weight: 500; color: #334155;">💳 ${escapeHtml(pMethod)}</td>
      <td style="padding: 14px 18px;"><span class="status-badge" style="background: ${isDownpayment ? '#eff6ff' : '#ecfdf5'}; color: ${isDownpayment ? '#1d4ed8' : '#047857'}; font-weight: 600; padding: 4px 10px; border-radius: 20px; font-size: 0.78rem;">${escapeHtml(payStatus)}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (pagContainer && typeof renderPagination === "function") {
    renderPagination({
      container: pagContainer,
      currentPage: adminTransCurrentPage,
      totalPages,
      totalItems,
      pageSize: adminTransPerPage,
      pageSizeOptions: [10, 20, 50],
      urlParamPrefix: "adminTrans",
      onPageChange: (newPage) => {
        adminTransCurrentPage = newPage;
        renderAdminTransactionsList(validOrders);
      },
      onPageSizeChange: (newSize) => {
        adminTransPerPage = newSize;
        adminTransCurrentPage = 1;
        renderAdminTransactionsList(validOrders);
      },
    });
  }
}

// Global Kebab Menu Click & Outside Dismiss Handler
document.addEventListener("click", (e) => {
  const kebabBtn = e.target.closest(".kebab-menu-btn");
  if (kebabBtn) {
    e.stopPropagation();
    const dropdown = kebabBtn.nextElementSibling;
    if (dropdown) {
      document.querySelectorAll(".kebab-menu-dropdown.active").forEach((el) => {
        if (el !== dropdown) el.classList.remove("active");
      });
      dropdown.classList.toggle("active");
    }
  } else {
    document.querySelectorAll(".kebab-menu-dropdown.active").forEach((el) => {
      el.classList.remove("active");
    });
  }
});

if (navDashboard) {
  navDashboard.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("dashboard");
  });
}
if (navInventory) {
  navInventory.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("inventory");
  });
}
if (navAnalytics) {
  navAnalytics.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("analytics");
  });
}
if (navWorkshop) {
  navWorkshop.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("workshop");
  });
}
if (navChats) {
  navChats.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("chats");
  });
}
if (navOrders) {
  navOrders.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("orders");
    loadStaffMembers();
  });
}
if (navTransactions) {
  navTransactions.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("transactions");
  });
}
if (navUsers) {
  navUsers.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("users");
  });
}
if (navAuditLogs) {
  navAuditLogs.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("audit-logs");
  });
}

// Audit Logs Table Rendering with Smart Pagination
let allAuditLogsData = [];
let auditLogsCurrentPage = 1;
const AUDIT_LOGS_PER_PAGE = 15;

async function renderAuditLogsSection() {
  const tableBody = document.getElementById("audit-logs-table-body");
  const searchInput = document.getElementById("audit-log-search");
  const roleFilter = document.getElementById("audit-log-role-filter");
  const actionFilter = document.getElementById("audit-log-action-filter");
  const refreshBtn = document.getElementById("btn-refresh-audit-logs");

  if (!tableBody) return;
  showTableSkeleton(tableBody, 5, 5);

  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "true";
    refreshBtn.addEventListener("click", () => renderAuditLogsSection());
  }

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", () => {
      auditLogsCurrentPage = 1;
      applyAuditLogsFilters();
    });
  }

  if (roleFilter && !roleFilter.dataset.bound) {
    roleFilter.dataset.bound = "true";
    roleFilter.addEventListener("change", () => {
      auditLogsCurrentPage = 1;
      applyAuditLogsFilters();
    });
  }

  if (actionFilter && !actionFilter.dataset.bound) {
    actionFilter.dataset.bound = "true";
    actionFilter.addEventListener("change", () => {
      auditLogsCurrentPage = 1;
      applyAuditLogsFilters();
    });
  }

  allAuditLogsData = await fetchAuditLogs(300);
  applyAuditLogsFilters();
}

function applyAuditLogsFilters() {
  const tableBody = document.getElementById("audit-logs-table-body");
  const pagContainer = document.getElementById("audit-logs-pagination-container");
  const searchVal = (document.getElementById("audit-log-search")?.value || "").toLowerCase().trim();
  const roleVal = (document.getElementById("audit-log-role-filter")?.value || "all").toLowerCase();
  const actionVal = (document.getElementById("audit-log-action-filter")?.value || "all");

  let filtered = allAuditLogsData.filter((log) => {
    if (roleVal !== "all" && (log.userRole || "").toLowerCase() !== roleVal) return false;
    if (actionVal !== "all" && (log.actionType || log.action || "") !== actionVal) return false;
    if (searchVal) {
      const uName = (log.userName || "").toLowerCase();
      const uEmail = (log.userEmail || "").toLowerCase();
      const act = (log.actionType || log.action || "").toLowerCase();
      const det = (log.details || "").toLowerCase();
      return uName.includes(searchVal) || uEmail.includes(searchVal) || act.includes(searchVal) || det.includes(searchVal);
    }
    return true;
  });

  if (filtered.length === 0) {
    renderTableEmptyState(tableBody, 5, "No audit trail records found matching your filters.");
    if (pagContainer) pagContainer.innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(filtered.length / AUDIT_LOGS_PER_PAGE);
  if (auditLogsCurrentPage > totalPages) auditLogsCurrentPage = totalPages;

  const startIdx = (auditLogsCurrentPage - 1) * AUDIT_LOGS_PER_PAGE;
  const pageLogs = filtered.slice(startIdx, startIdx + AUDIT_LOGS_PER_PAGE);

  tableBody.innerHTML = "";
  pageLogs.forEach((log) => {
    const tr = document.createElement("tr");
    tr.style.cssText = "border-bottom: 1px solid #f3f4f6; font-size: 0.85rem;";

    const timeVal = log.timestamp?.toDate ? log.timestamp.toDate() : (log.createdAt ? new Date(log.createdAt) : new Date());
    const dateStr = timeVal.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const role = (log.userRole || "USER").toUpperCase();
    let roleBg = "#f3f4f6";
    let roleColor = "#4b5563";
    if (role === "ADMIN") { roleBg = "#fef3c7"; roleColor = "#92400e"; }
    else if (role === "STAFF") { roleBg = "#e0f2fe"; roleColor = "#0369a1"; }
    else if (role === "CUSTOMER") { roleBg = "#f3e8ff"; roleColor = "#6b21a8"; }

    const actType = log.actionType || log.action || "EVENT";
    let actBg = "#ecfdf5";
    let actColor = "#047857";
    if (actType.startsWith("AUTH_")) { actBg = "#eff6ff"; actColor = "#1d4ed8"; }
    else if (actType.includes("DELETE") || actType.includes("SUSPEND")) { actBg = "#fef2f2"; actColor = "#dc2626"; }
    else if (actType.includes("UPDATE") || actType.includes("ORDER")) { actBg = "#fef3c7"; actColor = "#b45309"; }

    tr.innerHTML = `
      <td style="padding: 12px 18px; color: #4b5563; font-size: 0.8rem; white-space: nowrap;">${dateStr}</td>
      <td style="padding: 12px 18px;">
        <strong style="color: #111827; display: block; font-size: 0.84rem;">${escapeHtml(log.userName || "System")}</strong>
        <span style="font-size: 0.74rem; color: #6b7280; display: block;">${escapeHtml(log.userEmail || "")}</span>
        <span style="display: inline-block; margin-top: 2px; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${roleBg}; color: ${roleColor};">${role}</span>
      </td>
      <td style="padding: 12px 18px;">
        <span style="display: inline-block; font-size: 0.74rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${actBg}; color: ${actColor}; letter-spacing: 0.02em;">${escapeHtml(actType)}</span>
      </td>
      <td style="padding: 12px 18px; color: #374151; max-width: 380px; word-break: break-word;">
        ${escapeHtml(log.details || "—")}
      </td>
      <td style="padding: 12px 18px; color: #9ca3af; font-size: 0.74rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(log.userAgent || "Web Browser")}
      </td>
    `;
    tableBody.appendChild(tr);
  });

  if (pagContainer) {
    renderPagination({
      container: pagContainer,
      currentPage: auditLogsCurrentPage,
      totalPages: totalPages,
      totalItems: filtered.length,
      itemsPerPage: AUDIT_LOGS_PER_PAGE,
      onPageChange: (newPage) => {
        auditLogsCurrentPage = newPage;
        applyAuditLogsFilters();
      },
    });
  }
}

if (dashActionAddProduct) {
  dashActionAddProduct.addEventListener("click", () => {
    showAdminSection("inventory");
    if (typeof window.openModal === "function") window.openModal();
  });
}

if (dashActionViewOrders) {
  dashActionViewOrders.addEventListener("click", () => {
    showAdminSection("orders");
    loadStaffMembers();
  });
}

if (dashActionExportCsv) {
  dashActionExportCsv.addEventListener("click", () => {
    exportInventoryCsv();
  });
}

if (dashLinkAllOrders) {
  dashLinkAllOrders.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("orders");
    loadStaffMembers();
  });
}

async function loadStaffMembers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    staffMembers = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => {
        const r = String(u.role || "").toLowerCase().trim();
        return r === "staff" || r === "artisan" || r === "admin";
      })
      .map((u) => ({
        uid: u.uid || u.id,
        email: u.email || "",
        displayName: pickFirstNonEmpty(u.displayName, u.name, u.fullName, u.email, u.id),
        role: u.role || "staff",
      }))
      .filter((u) => !!u.uid);

    applyOrdersFilter();
  } catch (e) {
    console.warn("Could not load staff users (check Firestore rules / index):", e);
  }
}

loadStaffMembers();

function normalizeUserRole(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  if (r === "admin" || r === "staff" || r === "customer") return r;
  return "customer";
}

function normalizeUserStatus(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "inactive" || s === "disabled") return "inactive";
  return "active";
}

function updateUsersStats(users) {
  const total = users.length;
  const customers = users.filter((u) => normalizeUserRole(u.role) === "customer").length;
  const admins = users.filter((u) => normalizeUserRole(u.role) === "admin").length;
  const staff = users.filter((u) => normalizeUserRole(u.role) === "staff").length;

  if (usersTotalEl) usersTotalEl.textContent = String(total);
  const custEl = document.getElementById("users-customers");
  if (custEl) custEl.textContent = String(customers);
  if (usersAdminsEl) usersAdminsEl.textContent = String(admins);
  if (usersStaffEl) usersStaffEl.textContent = String(staff);
}

function updateURLQueryParam(key, value) {
  const url = new URL(window.location.href);
  if (value !== null && value !== undefined) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.toString());
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

function renderUsersList(users) {
  if (!usersListEl) return;
  usersListEl.innerHTML = "";

  const tableHead = document.getElementById("users-table-thead");
  if (tableHead) {
    if (activeUserTab === "customers") {
      tableHead.innerHTML = `
        <tr>
          <th>Customer Name</th>
          <th>Email Address</th>
          <th>Total Orders</th>
          <th>Lifetime Value (LTV)</th>
          <th>Account Status</th>
          <th style="text-align: right;">Action</th>
        </tr>
      `;
    } else {
      tableHead.innerHTML = `
        <tr>
          <th>Staff Member</th>
          <th>Email Address</th>
          <th>Role & Access Level</th>
          <th>Permissions Scope</th>
          <th>Security Status</th>
          <th style="text-align: right;">Actions</th>
        </tr>
      `;
    }
  }

  const totalItems = users.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / usersPerPage));
  if (usersCurrentPage > totalPages) usersCurrentPage = totalPages;
  if (usersCurrentPage < 1) usersCurrentPage = 1;

  updateURLQueryParam("userPage", usersCurrentPage);
  updateURLQueryParam("userPerPage", usersPerPage);

  const startIndex = (usersCurrentPage - 1) * usersPerPage;
  const pagedUsers = users.slice(startIndex, startIndex + usersPerPage);

  if (!pagedUsers.length) {
    usersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:#64748b;">No ${activeUserTab === "customers" ? "customer" : "staff"} accounts found matching your query.</td></tr>`;
  } else {
    pagedUsers.forEach((u) => {
      const name = pickFirstNonEmpty(u.displayName, u.name, u.fullName, "—");
      const email = pickFirstNonEmpty(u.email, "—");
      const uid = pickFirstNonEmpty(u.uid, u.id, "—");
      const role = normalizeUserRole(u.role);
      const status = normalizeUserStatus(u.status);
      const isSelf = !!currentUser && (uid === currentUser.uid || u.id === currentUser.uid);

      const tr = document.createElement("tr");

      if (activeUserTab === "customers") {
        // Calculate Customer Metrics
        const custOrders = (Array.isArray(allOrders) ? allOrders : []).filter(
          (o) => (o.userId && o.userId === u.id) || (o.customerEmail && o.customerEmail.toLowerCase() === email.toLowerCase())
        );
        const totalOrdersCount = custOrders.length;
        const lifetimeValue = custOrders.reduce((sum, o) => {
          const val = parseFloat(o.total || o.pricing?.total || o.amount || 0);
          return sum + (isNaN(val) ? 0 : val);
        }, 0);

        tr.innerHTML = `
          <td>
            <div style="display:flex;flex-direction:column;">
              <strong style="color:#0f172a;font-weight:600;">${escapeHtml(name)}</strong>
              <span style="font-size:0.75rem;color:#94a3b8;">UID: ${escapeHtml(uid.slice(0, 10))}…</span>
            </div>
          </td>
          <td><span style="color:#334155;">${escapeHtml(email)}</span></td>
          <td><span style="font-weight:600;color:#0f172a;">${totalOrdersCount} ${totalOrdersCount === 1 ? "order" : "orders"}</span></td>
          <td><span style="font-weight:700;color:#059669;">₱${lifetimeValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></td>
          <td><span class="status-badge ${status === "active" ? "active" : "inactive"}">${status === "active" ? "● Active" : "● Inactive"}</span></td>
          <td style="text-align: right;">
            <button type="button" class="btn-secondary toggle-status-btn" data-user-doc-id="${escapeHtml(u.id)}" data-current-status="${status}" style="padding: 5px 12px; font-size: 0.8rem; border-radius: 6px;">
              ${status === "active" ? "Suspend" : "Activate"}
            </button>
          </td>
        `;
      } else {
        // Render Staff & Security Directory Row
        let roleBadgeClass = "staff";
        let roleLabel = "Staff";
        if (role === "admin" || role === "super_admin") {
          roleBadgeClass = "super-admin";
          roleLabel = role === "super_admin" ? "Super Admin" : "Administrator";
        } else if (role === "artisan") {
          roleBadgeClass = "artisan";
          roleLabel = "Artisan Lead";
        } else if (role === "inventory_manager") {
          roleBadgeClass = "staff";
          roleLabel = "Inventory Manager";
        }

        const permSummary = role === "admin" || role === "super_admin" ? "Full Access" : "Orders & Inventory";

        tr.innerHTML = `
          <td>
            <div style="display:flex;flex-direction:column;">
              <strong style="color:#0f172a;font-weight:600;">${escapeHtml(name)} ${isSelf ? `<span style="font-size:0.7rem;background:#e0f2fe;color:#0369a1;padding:2px 6px;border-radius:4px;margin-left:4px;">You</span>` : ""}</strong>
              <span style="font-size:0.75rem;color:#94a3b8;">UID: ${escapeHtml(uid.slice(0, 10))}…</span>
            </div>
          </td>
          <td><span style="color:#334155;">${escapeHtml(email)}</span></td>
          <td><span class="role-badge ${roleBadgeClass}">${escapeHtml(roleLabel)}</span></td>
          <td><span style="font-size:0.8rem;color:#475569;background:#f1f5f9;padding:3px 8px;border-radius:6px;font-weight:500;">${escapeHtml(permSummary)}</span></td>
          <td><span class="status-badge active">● Verified (2FA)</span></td>
          <td style="text-align: right;">
            ${
              isSelf
                ? `<span style="font-size:0.8rem;color:#94a3b8;font-style:italic;">Owner Account</span>`
                : `<button type="button" class="btn-secondary open-role-modal-btn" data-user-doc-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(name)}" data-user-role="${escapeHtml(role)}" style="padding: 5px 12px; font-size: 0.8rem; border-radius: 6px;">Edit</button>`
            }
          </td>
        `;
      }

      usersListEl.appendChild(tr);
    });
  }

  renderUsersPaginationFooter(totalItems, totalPages);
  bindUserTableActions();
}

function renderUsersPaginationFooter(totalItems, totalPages) {
  const container = usersListEl ? usersListEl.closest(".table-container") : null;
  if (!container) return;

  renderPagination({
    container,
    currentPage: usersCurrentPage,
    totalPages,
    totalItems,
    pageSize: usersPerPage,
    pageSizeOptions: [5, 10, 25, 50, 100],
    urlParamPrefix: "user",
    onPageChange: (newPage) => {
      usersCurrentPage = newPage;
      applyUsersFilter();
    },
    onPageSizeChange: (newSize) => {
      usersPerPage = newSize;
      usersCurrentPage = 1;
      applyUsersFilter();
    },
  });
}

function bindUserTableActions() {
  if (!usersListEl) return;

  // Toggle user status (Activate / Suspend)
  usersListEl.querySelectorAll(".toggle-status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const docId = btn.getAttribute("data-user-doc-id");
      const currentStatus = btn.getAttribute("data-current-status");
      const newStatus = currentStatus === "active" ? "inactive" : "active";

      try {
        btn.setAttribute("disabled", "true");
        await updateDoc(doc(db, "users", docId), {
          status: newStatus,
          updatedAt: new Date().toISOString(),
        });
        showToast(`Account status updated to ${newStatus}!`, "success");
        const u = allUsers.find((x) => String(x.id) === String(docId));
        if (u) u.status = newStatus;
        applyUsersFilter();
      } catch (err) {
        console.error("Failed to update status:", err);
        showToast("Failed to update account status.", "error");
        btn.removeAttribute("disabled");
      }
    });
  });

  // Open Role Assignment Modal
  usersListEl.querySelectorAll(".open-role-modal-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const docId = btn.getAttribute("data-user-doc-id");
      const name = btn.getAttribute("data-user-name");
      const role = btn.getAttribute("data-user-role");
      const targetUser = allUsers.find((x) => String(x.id) === String(docId));

      const modal = document.getElementById("user-role-modal");
      const userIdInput = document.getElementById("role-modal-user-id");
      const userNameInput = document.getElementById("role-modal-user-name");
      const roleSelect = document.getElementById("role-modal-select");

      const permOrders = document.getElementById("perm-orders");
      const permInventory = document.getElementById("perm-inventory");
      const permAnalytics = document.getElementById("perm-analytics");
      const permUsers = document.getElementById("perm-users");

      if (modal && userIdInput && userNameInput && roleSelect) {
        userIdInput.value = docId;
        userNameInput.value = name;
        roleSelect.value = role || "staff";

        const userPerms = targetUser?.permissions || {};
        const isFull = role === "admin" || role === "super_admin";

        if (permOrders) permOrders.checked = userPerms.manageOrders !== false;
        if (permInventory) permInventory.checked = userPerms.inventoryControl !== false;
        if (permAnalytics) permAnalytics.checked = isFull || !!userPerms.viewAnalytics;
        if (permUsers) permUsers.checked = isFull || !!userPerms.manageUsers;

        modal.classList.add("active");
      }
    });
  });
}

function setupUserManagementControls() {
  const tabsContainer = document.getElementById("user-management-tabs");
  if (tabsContainer) {
    tabsContainer.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        tabsContainer.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeUserTab = btn.getAttribute("data-user-tab") || "customers";
        usersCurrentPage = 1;
        applyUsersFilter();
      });
    });
  }

  const searchInput = document.getElementById("users-search-input");
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        usersSearchQuery = e.target.value.toLowerCase().trim();
        usersCurrentPage = 1;
        applyUsersFilter();
      }, 200);
    });
  }

  const roleSelect = document.getElementById("role-modal-select");
  if (roleSelect) {
    roleSelect.addEventListener("change", (e) => {
      const r = e.target.value;
      const isFull = r === "admin" || r === "super_admin";
      const permOrders = document.getElementById("perm-orders");
      const permInventory = document.getElementById("perm-inventory");
      const permAnalytics = document.getElementById("perm-analytics");
      const permUsers = document.getElementById("perm-users");

      if (permOrders) permOrders.checked = true;
      if (permInventory) permInventory.checked = r !== "artisan";
      if (permAnalytics) permAnalytics.checked = isFull;
      if (permUsers) permUsers.checked = isFull;
    });
  }

  // Setup Role Modal Close & Submit Handlers
  const modal = document.getElementById("user-role-modal");
  const closeBtn = document.getElementById("role-modal-close-btn");
  const cancelBtn = document.getElementById("role-modal-cancel-btn");
  const roleForm = document.getElementById("user-role-form");

  const closeModal = () => {
    if (modal) modal.classList.remove("active");
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  if (roleForm) {
    roleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const docId = document.getElementById("role-modal-user-id")?.value;
      const newRole = document.getElementById("role-modal-select")?.value;
      if (!docId || !newRole) return;

      const permissionsPayload = {
        manageOrders: document.getElementById("perm-orders")?.checked ?? true,
        inventoryControl: document.getElementById("perm-inventory")?.checked ?? true,
        viewAnalytics: document.getElementById("perm-analytics")?.checked ?? false,
        manageUsers: document.getElementById("perm-users")?.checked ?? false,
      };

      try {
        await updateDoc(doc(db, "users", docId), {
          role: newRole,
          permissions: permissionsPayload,
          updatedAt: new Date().toISOString(),
        });

        const targetUser = allUsers.find((x) => String(x.id) === String(docId));
        if (targetUser) {
          targetUser.role = newRole;
          targetUser.permissions = permissionsPayload;
        }

        showToast("Staff security role and permissions updated successfully!", "success");
        closeModal();
        applyUsersFilter();
      } catch (err) {
        console.error("Failed to update role:", err);
        showToast("Failed to update staff security role.", "error");
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupUserManagementControls);
} else {
  setupUserManagementControls();
}

function applyUsersFilter() {
  let rows = allUsers;

  // 1. Separate Customer directory vs Staff & Internal Team directory
  if (activeUserTab === "customers") {
    rows = rows.filter((u) => {
      const r = normalizeUserRole(u.role);
      return r === "customer" || (!u.role && r !== "staff" && r !== "admin");
    });
  } else {
    rows = rows.filter((u) => {
      const r = normalizeUserRole(u.role);
      return r === "staff" || r === "admin" || r === "artisan" || r === "inventory_manager" || r === "super_admin";
    });
  }

  // 2. Status Filter
  if (usersFilterValue === "active") {
    rows = rows.filter((u) => normalizeUserStatus(u.status) === "active");
  } else if (usersFilterValue === "inactive") {
    rows = rows.filter((u) => normalizeUserStatus(u.status) === "inactive");
  }

  // 3. Search Query Filter
  if (usersSearchQuery) {
    rows = rows.filter((u) => {
      const name = pickFirstNonEmpty(u.displayName, u.name, u.fullName, "").toLowerCase();
      const email = String(u.email || "").toLowerCase();
      const uid = String(u.uid || u.id || "").toLowerCase();
      return name.includes(usersSearchQuery) || email.includes(usersSearchQuery) || uid.includes(usersSearchQuery);
    });
  }

  renderUsersList(rows);
  updateUsersStats(allUsers);
}

if (usersRoleFilter) {
  usersRoleFilter.addEventListener("change", () => {
    usersFilterValue = usersRoleFilter.value;
    applyUsersFilter();
  });
}

onSnapshot(
  collection(db, "users"),
  (snapshot) => {
    allUsers = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const aName = pickFirstNonEmpty(a.displayName, a.name, a.email, a.id).toLowerCase();
        const bName = pickFirstNonEmpty(b.displayName, b.name, b.email, b.id).toLowerCase();
        return aName.localeCompare(bName);
      });
    staffMembers = allUsers
      .filter((u) => {
        const r = String(u.role || "").toLowerCase().trim();
        return r === "staff" || r === "artisan" || r === "admin";
      })
      .map((u) => ({
        uid: u.uid || u.id,
        email: u.email || "",
        displayName: pickFirstNonEmpty(u.displayName, u.name, u.fullName, u.email, u.id),
        role: u.role || "staff",
      }))
      .filter((u) => !!u.uid);
    applyUsersFilter();
    applyOrdersFilter();
  },
  (err) => {
    console.warn("Could not load users for admin management:", err);
    if (usersListEl) {
      usersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#b91c1c;">Failed to load users.</td></tr>`;
    }
  }
);

if (usersListEl) {
  usersListEl.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (!t.classList.contains("user-save-btn")) return;

    const docId = t.getAttribute("data-user-doc-id");
    if (!docId) return;

    const row = t.closest("tr");
    if (!row) return;
    const roleSelect = row.querySelector(".user-role-select");
    const statusSelect = row.querySelector(".user-status-select");
    if (!(roleSelect instanceof HTMLSelectElement) || !(statusSelect instanceof HTMLSelectElement))
      return;

    const role = normalizeUserRole(roleSelect.value);
    const status = normalizeUserStatus(statusSelect.value);

    try {
      t.setAttribute("disabled", "true");
      t.textContent = "Saving...";

      console.log("=== ROLE UPDATE DEBUG ===");
      console.log("Updating user doc ID:", docId);
      console.log("New role:", role);
      console.log("New status:", status);
      console.log("Current admin UID:", currentUser?.uid);

      await updateDoc(doc(db, "users", docId), {
        role,
        status,
        updatedAt: Timestamp.now(),
        updatedByUid: currentUser ? currentUser.uid : null,
      });

      console.log("✅ Role update successful!");
      t.textContent = "Saved";
      setTimeout(() => {
        t.textContent = "Save";
      }, 1200);
      loadStaffMembers();
    } catch (err) {
      console.error("Failed updating user account:", err);
      alert(err.message || "Failed to update user account.");
      t.textContent = "Save";
    } finally {
      t.removeAttribute("disabled");
    }
  });
}

function updateOrderStats(orders) {
  const counts = { placed: 0, "downpayment confirmed": 0, "in production": 0, "quality checked": 0, shipped: 0, delivered: 0, refund_requested: 0 };
  orders.forEach((o) => {
    if (o.refundStatus === "refund_requested" || o.status === "cancellation_pending_review") {
      counts.refund_requested++;
    }
    const st = normalizeOrderStatus(o.status);
    if (counts[st] !== undefined) counts[st]++;
  });
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };
  set("orders-pending", counts.placed);
  set("orders-processing", counts["in production"]);
  set("orders-shipped", counts["quality checked"]);
  set("orders-delivered", counts.delivered);
  set("orders-refund-requests", counts.refund_requested);
}

function applyOrdersFilter() {
  const activeOrders = allOrders.filter(
    (o) => !isOrderCompleted(o) && normalizeOrderAction(o.action) !== "delete"
  );

  let rows = activeOrders;
  if (ordersFilterValue && ordersFilterValue !== "all") {
    if (ordersFilterValue === "refund_requested") {
      rows = allOrders.filter(
        (o) => o.refundStatus === "refund_requested" || o.status === "cancellation_pending_review"
      );
    } else if (ordersFilterValue === "refunded") {
      rows = allOrders.filter(
        (o) => o.refundStatus === "refund_completed" || o.status === "refunded"
      );
    } else {
      rows = activeOrders.filter((o) => normalizeOrderStatus(o.status) === ordersFilterValue);
    }
  }

  // Real-time debounced search filtering for orders
  if (adminOrdersSearchQuery) {
    const q = adminOrdersSearchQuery.toLowerCase().trim();
    rows = rows.filter((o) => {
      // 1. Order ID
      if (o.id && o.id.toLowerCase().includes(q)) return true;
      // 2. Customer Name, Email, or Recipient Name
      const cust = (
        customerNameByUid.get(o.customerId) ||
        customerNameByEmail.get(o.customerEmail) ||
        o.customerName ||
        o.shippingAddress?.recipientName ||
        o.recipientName ||
        o.customerEmail ||
        ""
      ).toLowerCase();
      if (cust.includes(q)) return true;
      // 3. Product Title or Items
      if (Array.isArray(o.items)) {
        const itemMatch = o.items.some((it) => {
          const t = (it.name || it.title || it.productTitle || "").toLowerCase();
          const mat = (it.material || "").toLowerCase();
          return t.includes(q) || mat.includes(q);
        });
        if (itemMatch) return true;
      }
      // 4. Status
      const statusText = (o.status || "").toLowerCase();
      if (statusText.includes(q)) return true;
      return false;
    });
  }

  renderOrdersList(rows);
  renderCompletedOrdersHistory(allOrders.filter((o) => isOrderCompleted(o)));
  renderWorkshopQueue(allOrders);
  updateOrderStats(allOrders);
  renderRevenueGraph();
  syncBatchDeleteUi();
  updateDashboardKpis(allProducts, allOrders);
}

if (ordersDateStartEl && ordersDateEndEl) {
  const now = new Date();
  const defaultEnd = dateToInputValue(now);
  const defaultStartDate = new Date(now);
  defaultStartDate.setDate(defaultStartDate.getDate() - 29);
  const defaultStart = dateToInputValue(defaultStartDate);

  ordersDateStartEl.required = true;
  ordersDateEndEl.required = true;
  ordersDateStartEl.max = defaultEnd;
  ordersDateEndEl.max = defaultEnd;

  if (!ordersDateStartEl.value) ordersDateStartEl.value = defaultStart;
  if (!ordersDateEndEl.value) ordersDateEndEl.value = defaultEnd;

  ordersDateStartEl.addEventListener("change", renderRevenueGraph);
  ordersDateEndEl.addEventListener("change", renderRevenueGraph);
}

async function exportAnalyticsAsPdf() {
  if (!analyticsExportArea) {
    alert("Analytics content is not available.");
    return;
  }

  if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF export library is not ready. Please refresh and try again.");
    return;
  }

  const originalText = exportAnalyticsPdfBtn ? exportAnalyticsPdfBtn.textContent : "";
  if (exportAnalyticsPdfBtn) {
    exportAnalyticsPdfBtn.disabled = true;
    exportAnalyticsPdfBtn.textContent = "Preparing PDF...";
  }

  try {
    const canvas = await window.html2canvas(analyticsExportArea, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * usableWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, usableWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    pdf.save(`lanica-analytics-${stamp}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("Failed to export analytics as PDF.");
  } finally {
    if (exportAnalyticsPdfBtn) {
      exportAnalyticsPdfBtn.disabled = false;
      exportAnalyticsPdfBtn.textContent = originalText || "Export PDF";
    }
  }
}

if (exportAnalyticsPdfBtn) {
  exportAnalyticsPdfBtn.addEventListener("click", () => {
    exportAnalyticsAsPdf();
  });
}

function getVisibleDeclinedCheckboxes() {
  if (!ordersListEl) return [];
  return Array.from(ordersListEl.querySelectorAll(".declined-order-checkbox"));
}

function syncBatchDeleteUi() {
  if (ordersSelectHeaderEl) ordersSelectHeaderEl.classList.toggle("is-hidden", !isBatchDeleteMode);
  if (batchDeleteControlsEl)
    batchDeleteControlsEl.classList.toggle("is-hidden", !isBatchDeleteMode);
  if (toggleBatchDeleteModeBtn) {
    toggleBatchDeleteModeBtn.textContent = isBatchDeleteMode
      ? "Exit Batch Delete"
      : "Batch Delete Mode";
  }

  if (!isBatchDeleteMode) {
    if (batchDeleteDeclinedBtn) {
      batchDeleteDeclinedBtn.disabled = true;
      batchDeleteDeclinedBtn.textContent = "Delete Selected";
    }
    if (selectAllDeclinedEl) {
      selectAllDeclinedEl.checked = false;
      selectAllDeclinedEl.indeterminate = false;
      selectAllDeclinedEl.disabled = true;
    }
    return;
  }

  const visibleDeclined = getVisibleDeclinedCheckboxes();
  const selectedVisibleCount = visibleDeclined.filter((cb) => cb.checked).length;

  if (batchDeleteDeclinedBtn) {
    const selectedCount = selectedDeclinedOrderIds.size;
    batchDeleteDeclinedBtn.disabled = selectedCount === 0;
    batchDeleteDeclinedBtn.textContent =
      selectedCount > 0 ? `Batch Delete Declined (${selectedCount})` : "Delete Selected";
  }

  if (selectAllDeclinedEl) {
    if (visibleDeclined.length === 0) {
      selectAllDeclinedEl.checked = false;
      selectAllDeclinedEl.indeterminate = false;
      selectAllDeclinedEl.disabled = true;
    } else {
      selectAllDeclinedEl.disabled = false;
      selectAllDeclinedEl.checked = selectedVisibleCount === visibleDeclined.length;
      selectAllDeclinedEl.indeterminate =
        selectedVisibleCount > 0 && selectedVisibleCount < visibleDeclined.length;
    }
  }
}

async function handleBatchDeleteDeclined() {
  const selectedIds = Array.from(selectedDeclinedOrderIds);
  if (selectedIds.length === 0) {
    alert("Select at least one declined order to delete.");
    return;
  }

  const selectedOrders = selectedIds
    .map((id) => allOrders.find((o) => o.id === id))
    .filter((o) => !!o);

  const validTargets = selectedOrders.filter(
    (o) =>
      normalizeOrderStatus(o.status) === "declined" && normalizeOrderAction(o.action) !== "delete"
  );

  if (validTargets.length === 0) {
    alert("No valid declined orders selected.");
    selectedDeclinedOrderIds.clear();
    syncBatchDeleteUi();
    applyOrdersFilter();
    return;
  }

  if (validTargets.length !== selectedIds.length) {
    alert("Some selected orders are no longer declined and will be skipped.");
  }

  if (!confirm(`Delete ${validTargets.length} declined order(s)?`)) return;

  if (batchDeleteDeclinedBtn) {
    batchDeleteDeclinedBtn.disabled = true;
    batchDeleteDeclinedBtn.textContent = "Deleting...";
  }

  const now = Timestamp.now();
  const results = await Promise.allSettled(
    validTargets.map((o) =>
      updateDoc(doc(db, "orders", o.id), {
        action: "delete",
        deletedAt: now,
        deletedByUid: currentUser ? currentUser.uid : null,
        updatedAt: now,
      })
    )
  );

  let success = 0;
  let failed = 0;
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      success += 1;
      selectedDeclinedOrderIds.delete(validTargets[idx].id);
    } else {
      failed += 1;
      console.error("Batch delete failed for order:", validTargets[idx].id, r.reason);
    }
  });

  syncBatchDeleteUi();
  if (failed > 0) {
    alert(`Deleted ${success} order(s). Failed to delete ${failed} order(s).`);
  } else {
    alert(`Deleted ${success} declined order(s).`);
  }
}

if (ordersStatusFilter) {
  ordersStatusFilter.addEventListener("change", () => {
    ordersFilterValue = ordersStatusFilter.value;
    applyOrdersFilter();
  });
}

const adminOrdersSearchInput = document.getElementById("admin-orders-search-input");
const adminOrdersSearchClear = document.getElementById("admin-orders-search-clear");
if (adminOrdersSearchInput) {
  let ordersSearchDebounce = null;
  adminOrdersSearchInput.addEventListener("input", (e) => {
    clearTimeout(ordersSearchDebounce);
    const val = e.target.value;
    if (adminOrdersSearchClear) {
      adminOrdersSearchClear.style.display = val.trim().length > 0 ? "flex" : "none";
    }
    ordersSearchDebounce = setTimeout(() => {
      adminOrdersSearchQuery = val;
      applyOrdersFilter();
    }, 250);
  });
}

if (adminOrdersSearchClear) {
  adminOrdersSearchClear.addEventListener("click", () => {
    if (adminOrdersSearchInput) adminOrdersSearchInput.value = "";
    adminOrdersSearchClear.style.display = "none";
    adminOrdersSearchQuery = "";
    if (adminOrdersSearchInput) adminOrdersSearchInput.focus();
    applyOrdersFilter();
  });
}

if (toggleBatchDeleteModeBtn) {
  toggleBatchDeleteModeBtn.addEventListener("click", () => {
    isBatchDeleteMode = !isBatchDeleteMode;
    if (!isBatchDeleteMode) selectedDeclinedOrderIds.clear();
    applyOrdersFilter();
  });
}

if (selectAllDeclinedEl) {
  selectAllDeclinedEl.addEventListener("change", () => {
    const visibleDeclined = getVisibleDeclinedCheckboxes();
    const checked = !!selectAllDeclinedEl.checked;
    visibleDeclined.forEach((cb) => {
      cb.checked = checked;
      const id = cb.getAttribute("data-order-id");
      if (!id) return;
      if (checked) selectedDeclinedOrderIds.add(id);
      else selectedDeclinedOrderIds.delete(id);
    });
    syncBatchDeleteUi();
  });
}

if (batchDeleteDeclinedBtn) {
  batchDeleteDeclinedBtn.addEventListener("click", () => {
    handleBatchDeleteDeclined().catch((e) => {
      console.error(e);
      alert(e.message || "Batch delete failed.");
      syncBatchDeleteUi();
    });
  });
}

const ordersQuerySorted = query(ORDERS_COLLECTION, orderBy("createdAt", "desc"));

onSnapshot(
  ordersQuerySorted,
  (snapshot) => {
    allOrders = [];
    snapshot.forEach((d) => {
      allOrders.push({ id: d.id, ...d.data() });
    });
    allOrders.sort((a, b) => orderTimestampMs(b) - orderTimestampMs(a));
    applyOrdersFilter();
    hydrateCustomerNamesForOrders(allOrders);
  },
  (err) => {
    console.warn("orders orderBy(createdAt) failed; falling back to unsorted listener:", err);
    onSnapshot(ORDERS_COLLECTION, (snapshot) => {
      allOrders = [];
      snapshot.forEach((d) => {
        allOrders.push({ id: d.id, ...d.data() });
      });
      allOrders.sort((a, b) => orderTimestampMs(b) - orderTimestampMs(a));
      applyOrdersFilter();
      hydrateCustomerNamesForOrders(allOrders);
    });
  }
);

function formatOrderItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "—";
  return items
    .map((it) => {
      const q = it.quantity != null ? it.quantity : 1;
      const nm = it.name || it.productName || "Item";
      return `${nm} × ${q}`;
    })
    .join(", ");
}

function getOrderConnectionIssues(order) {
  const issues = [];
  const items = Array.isArray(order.items) ? order.items : [];

  if (items.length === 0) {
    issues.push("No items");
    return issues;
  }

  const missingProductIdCount = items.filter((it) => !it.productId).length;
  if (missingProductIdCount > 0) {
    issues.push(
      `${missingProductIdCount} line${missingProductIdCount > 1 ? "s" : ""} missing productId`
    );
  }

  const invalidQtyCount = items.filter((it) => {
    const qty = parseInt(it.quantity, 10);
    return Number.isNaN(qty) || qty <= 0;
  }).length;
  if (invalidQtyCount > 0) {
    issues.push(`${invalidQtyCount} line${invalidQtyCount > 1 ? "s" : ""} with invalid quantity`);
  }

  return issues;
}

function renderOrdersList(orders) {
  if (!ordersListEl) return;
  ordersListEl.innerHTML = "";

  if (orders.length === 0) {
    ordersListEl.innerHTML = `<tr><td colspan="${isBatchDeleteMode ? 9 : 8}" style="text-align:center;padding:24px;color:#6b7280;">No orders found. Orders created by the customer app appear here.</td></tr>`;
    syncBatchDeleteUi();
    return;
  }

  orders.forEach((order) => {
    const st = normalizeOrderStatus(order.status);
    const created = order.createdAt;
    let dateStr = "—";
    if (created && typeof created.toDate === "function") {
      dateStr = created.toDate().toLocaleString();
    } else if (created && created.seconds) {
      dateStr = new Date(created.seconds * 1000).toLocaleString();
    }

    const customer = resolveCustomerDisplay(order);

    // Fulfillment calculation & badge
    const isPickup = order.fulfillmentType === "pickup" || order.address?.pickupAtWorkshop;
    const addressObj = order.address || order.shippingAddress || order.deliveryAddress || {};
    const fullAddr = addressObj.fullAddress || addressObj.address || addressObj.street || "";
    const fulfillmentBadgeHtml = isPickup
      ? `<span class="fulfillment-badge pickup" title="Pickup at Lanica Workshop">🏪 Store Pickup</span>`
      : `<span class="fulfillment-badge delivery" title="${escapeHtml(fullAddr || "Home Delivery")}">🚚 Delivery</span>`;

    const nearestLandmark = order.shippingAddress?.nearestLandmark || addressObj.nearestLandmark || order.nearestLandmark || addressObj.landmark || "";
    const landmarkBadgeHtml = nearestLandmark
      ? `<div style="font-size:0.73rem; color:#d97706; font-weight:500; margin-top:2px; max-width:170px; line-height:1.2; white-space:normal;" title="Landmark / Instructions: ${escapeHtml(nearestLandmark)}">📌 ${escapeHtml(nearestLandmark)}</div>`
      : "";

    const addressDisplayHtml = !isPickup && fullAddr
      ? `<div style="font-size:0.75rem; color:#6b7280; margin-top:3px; max-width:170px; line-height:1.2; white-space:normal;" title="${escapeHtml(fullAddr)}">${escapeHtml(fullAddr.length > 45 ? fullAddr.slice(0, 45) + '…' : fullAddr)}</div>${landmarkBadgeHtml}`
      : isPickup
        ? `<div style="font-size:0.75rem; color:#b45309; margin-top:3px;">Lanica Workshop</div>`
        : ``;

    // Financial Breakdown calculation
    const totalVal = Number(order.totalAmount ?? order.total ?? 0);
    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
    const paidVal = Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
    const remainingVal = Number(order.remainingBalance ?? order.balanceDue ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
    const isBalanceSettled = order.balanceStatus === "settled" || remainingVal <= 0;
    const paidPct = totalVal > 0 ? Math.round((paidVal / totalVal) * 100) : (isDownpayment ? 30 : 100);

    const financialBreakdownHtml = `
      <div class="financial-breakdown-card">
        <div>Total: <strong class="fin-total">₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div>Upfront: <span class="fin-paid">₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> <small style="color:#6b7280;">(${paidPct}%)</small></div>
        <div>Due: <span class="fin-due">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <span class="balance-badge ${isBalanceSettled ? "settled" : "pending"}">${isBalanceSettled ? "✓ Settled" : "⏳ Pending"}</span>
      </div>
    `;

    // Refund Status & Badges
    const isRefundRequested = order.refundStatus === "refund_requested" || order.status === "cancellation_pending_review";
    const isRefundCompleted = order.refundStatus === "refund_completed" || order.status === "refunded";
    const isRefundRejected = order.refundStatus === "refund_rejected";

    let refundBadgeHtml = "";
    if (isRefundRequested) {
      refundBadgeHtml = `<div><span class="refund-status-badge requested">💸 Refund Requested</span></div>`;
    } else if (isRefundCompleted) {
      refundBadgeHtml = `<div><span class="refund-status-badge completed">✅ Refunded (₱${Number(order.refundedAmount || paidVal).toLocaleString()})</span></div>`;
    } else if (isRefundRejected) {
      refundBadgeHtml = `<div><span class="refund-status-badge rejected">❌ Refund Rejected</span></div>`;
    }

    const statusColumnHtml = `
      <div>
        <span class="order-status-badge order-status-${escapeHtml(st)}">${escapeHtml(
          st.charAt(0).toUpperCase() + st.slice(1)
        )}</span>
        ${refundBadgeHtml}
      </div>
    `;

    const isMarkSettledVisible = !isBalanceSettled && remainingVal > 0 && st !== "placed" && st !== "pending" && st !== "cancelled" && st !== "declined";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="${isBatchDeleteMode ? "" : "is-hidden"}">
        ${
          isBatchDeleteMode && st === "declined"
            ? `<input type="checkbox" class="declined-order-checkbox" data-order-id="${escapeHtml(order.id)}" ${
                selectedDeclinedOrderIds.has(order.id) ? "checked" : ""
              } aria-label="Select declined order ${escapeHtml(order.id)}" />`
            : isBatchDeleteMode
              ? `<span style="color:#9ca3af;">—</span>`
              : ``
        }
      </td>
      <td>
        <strong style="font-size:0.9rem;">${escapeHtml(order.id.slice(0, 8))}…</strong>
        <div style="font-size:0.75rem;color:#9ca3af;margin-top:4px;">${escapeHtml(dateStr)}</div>
      </td>
      <td>
        <strong>${escapeHtml(String(customer))}</strong>
      </td>
      <td>
        ${fulfillmentBadgeHtml}
        ${addressDisplayHtml}
      </td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td>${financialBreakdownHtml}</td>
      <td>${statusColumnHtml}</td>
      <td>
        <select class="order-assign-select" data-order-id="${escapeHtml(order.id)}" aria-label="Assign staff" ${st === "delivered" || st === "cancelled" || st === "declined" || isRefundCompleted ? "disabled" : ""}>
          <option value="">Unassigned</option>
          ${staffMembers
            .map((s) => {
              const sel = order.assignedToUid === s.uid ? "selected" : "";
              const roleSuffix = s.role && s.role !== "staff" ? ` (${s.role})` : "";
              return `<option value="${escapeHtml(s.uid)}" ${sel}>${escapeHtml(s.displayName)}${roleSuffix}</option>`;
            })
            .join("")}
        </select>
      </td>
      <td>
        <div class="kebab-menu-container" style="position: relative; display: inline-block;">
          <button type="button" class="kebab-trigger-btn" aria-label="Row Actions" style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.1rem; color: #334155; font-weight: bold; transition: all 0.2s;">
            ⋮
          </button>
          <div class="kebab-dropdown-menu" style="display: none; position: absolute; right: 0; top: 36px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); z-index: 1000; min-width: 170px; padding: 6px; text-align: left;">
            ${
              isRefundRequested
                ? `<button type="button" class="kebab-menu-item btn-review-refund" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: #fef2f2; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    💸 Review Refund
                  </button>`
                : ""
            }
            ${
              isMarkSettledVisible
                ? `<button type="button" class="kebab-menu-item btn-settle-balance" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #059669; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    💵 Mark Balance Settled
                  </button>`
                : ""
            }
            ${
              st === "placed" || st === "pending"
                ? `<button type="button" class="kebab-menu-item btn-accept-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #16a34a; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    ✓ Confirm Downpayment
                  </button>
                  <button type="button" class="kebab-menu-item btn-decline-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    ✕ Decline Order
                  </button>`
                : ""
            }
            ${
              st === "declined" || st === "cancelled"
                ? `<button type="button" class="kebab-menu-item btn-delete-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    🗑 Delete Order
                  </button>`
                : ""
            }
          </div>
        </div>
      </td>
    `;
    ordersListEl.appendChild(tr);
  });
  syncBatchDeleteUi();
}

function renderCompletedOrdersHistory(orders) {
  if (!ordersHistoryListEl) return;
  ordersHistoryListEl.innerHTML = "";

  if (!orders || orders.length === 0) {
    ordersHistoryListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#6b7280;">No completed transactions yet.</td></tr>`;
    return;
  }

  orders.forEach((order) => {
    const customer = resolveCustomerDisplay(order);
    const total = order.total != null ? order.total : order.totalAmount;
    const totalStr =
      total != null && total !== ""
        ? `₱${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="font-size:0.9rem;">${escapeHtml(order.id.slice(0, 8))}…</strong></td>
      <td>${escapeHtml(String(customer))}</td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td>${totalStr}</td>
      <td>${escapeHtml(resolveAssignedStaffName(order))}</td>
      <td>${escapeHtml(getCompletedAtLabel(order))}</td>
    `;
    ordersHistoryListEl.appendChild(tr);
  });
}

async function deductStockForLine(transaction, productId, item) {
  const productRef = doc(db, "products", productId);
  const pSnap = await transaction.get(productRef);
  if (!pSnap.exists()) {
    throw new Error(`Product not found: ${productId}`);
  }
  const d = pSnap.data();
  const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
  const mat = materialHint(item.material);

  const hasSplit =
    d.fabricStock !== undefined ||
    d.leatherStock !== undefined ||
    (d.fabricStock === 0 && d.leatherStock === 0);

  if (hasSplit) {
    let fab = Number(d.fabricStock) || 0;
    let lea = Number(d.leatherStock) || 0;
    if (mat === "leather") {
      if (lea < qty) throw new Error(`Not enough leather stock for “${d.name || item.name}”.`);
      lea -= qty;
    } else if (mat === "fabric") {
      if (fab < qty) throw new Error(`Not enough fabric stock for “${d.name || item.name}”.`);
      fab -= qty;
    } else {
      if (fab >= qty) fab -= qty;
      else if (lea >= qty) lea -= qty;
      else {
        throw new Error(
          `Not enough stock for “${d.name || item.name}”. Set material (fabric/leather) on the order line in the app.`
        );
      }
    }
    const combined = fab + lea;
    transaction.update(productRef, {
      fabricStock: fab,
      leatherStock: lea,
      stock: combined,
    });
  } else {
    let s = Number(d.stock) || 0;
    if (s < qty) throw new Error(`Not enough stock for “${d.name || item.name}”.`);
    transaction.update(productRef, { stock: s - qty });
  }
}

async function handleOrderStatusChange(orderId, newStatus) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  const next = normalizeOrderStatus(newStatus);
  if (prev === next) return;

  const items = Array.isArray(current.items) ? current.items : [];

  const shouldDeductStock =
    (prev === "downpayment confirmed" || prev === "accepted") &&
    (next === "in production" || next === "processing") &&
    !current.stockDeducted &&
    items.length > 0;

  if (shouldDeductStock) {
    for (const it of items) {
      if (!it.productId) {
        alert(
          "This order has a line without productId. Add productId on each line in the app before leaving Pending."
        );
        applyOrdersFilter();
        return;
      }
    }
    try {
      await runTransaction(db, async (transaction) => {
        const oSnap = await transaction.get(orderRef);
        if (!oSnap.exists()) throw new Error("Order missing");
        const oData = oSnap.data();
        if (oData.stockDeducted) return;
        for (const it of items) {
          await deductStockForLine(transaction, it.productId, it);
        }
        transaction.update(orderRef, {
          status: next,
          orderStatus: next,
          stockDeducted: true,
          updatedAt: Timestamp.now(),
        });
      });
    } catch (e) {
      console.error(e);
      alert(e.message || "Could not update inventory for this order.");
      applyOrdersFilter();
      return;
    }
    return;
  }

  try {
    await updateDoc(orderRef, {
      status: next,
      orderStatus: next,
      updatedAt: Timestamp.now(),
    });
  } catch (e) {
    console.error(e);
    alert("Failed to update order status.");
    applyOrdersFilter();
  }
}

async function handleOrderAccept(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  if (prev !== "placed" && prev !== "pending") return;

  const items = Array.isArray(current.items) ? current.items : [];
  if (items.length === 0) {
    alert("This order has no items.");
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const oSnap = await transaction.get(orderRef);
      if (!oSnap.exists()) throw new Error("Order missing");
      const oData = oSnap.data();
      const latestStatus = normalizeOrderStatus(oData.status);
      if (latestStatus !== "placed" && latestStatus !== "pending") return;

      transaction.update(orderRef, {
        status: "downpayment confirmed",
        orderStatus: "downpayment confirmed",
        stockDeducted: !!oData.stockDeducted,
        acceptedAt: Timestamp.now(),
        acceptedByUid: currentUser ? currentUser.uid : null,
        updatedAt: Timestamp.now(),
      });
    });
    console.log(`Accepted order ${orderId} -> downpayment confirmed`);
  } catch (e) {
    console.error("Order accept error:", e);
    alert(e.message || "Could not accept order.");
  }
}

async function handleOrderDecline(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  if (prev !== "placed" && prev !== "pending") return;

  if (!confirm("Decline this order?")) return;

  try {
    await updateDoc(orderRef, {
      status: "declined",
      orderStatus: "declined",
      declinedAt: Timestamp.now(),
      declinedByUid: currentUser ? currentUser.uid : null,
      updatedAt: Timestamp.now(),
    });
    console.log(`Declined order ${orderId}`);
  } catch (e) {
    console.error("Order decline error:", e);
    alert(e.message || "Could not decline order.");
  }
}

async function handleDeclinedOrderDelete(orderId) {
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const st = normalizeOrderStatus(current.status);
  if (st !== "declined") return;

  if (!confirm("Delete this declined order permanently?")) return;

  try {
    // Use soft delete so declined orders can be removed from the UI
    // even when Firestore hard-delete permissions are restricted.
    await updateDoc(doc(db, "orders", orderId), {
      action: "delete",
      deletedAt: Timestamp.now(),
      deletedByUid: currentUser ? currentUser.uid : null,
      updatedAt: Timestamp.now(),
    });
  } catch (e) {
    console.error(e);
    alert(e.message || "Could not delete this order.");
  }
}

async function handleOrderAssign(orderId, staffUid) {
  const orderRef = doc(db, "orders", orderId);
  const staff = staffMembers.find((s) => s.uid === staffUid);
  const staffName = staff ? staff.displayName : (staffUid ? "Staff Member" : null);
  try {
    await updateDoc(orderRef, {
      assignedToUid: staffUid || null,
      assignedToName: staffName,
      updatedAt: Timestamp.now(),
    });
    console.log(`Assigned order ${orderId} to ${staffName || "Unassigned"}`);
  } catch (e) {
    console.error("Order assignment failed:", e);
    alert("Failed to assign staff member: " + (e.message || ""));
    applyOrdersFilter();
  }
}

if (ordersListEl) {
  ordersListEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.classList.contains("declined-order-checkbox")) {
      const id = t.getAttribute("data-order-id");
      if (id) {
        if (t.checked) selectedDeclinedOrderIds.add(id);
        else selectedDeclinedOrderIds.delete(id);
      }
      syncBatchDeleteUi();
      return;
    }
    if (t.classList.contains("order-status-select")) {
      const id = t.getAttribute("data-order-id");
      if (id) handleOrderStatusChange(id, t.value);
    }
    if (t.classList.contains("order-assign-select")) {
      const id = t.getAttribute("data-order-id");
      if (id) handleOrderAssign(id, t.value);
    }
  });

  ordersListEl.addEventListener("click", (e) => {
    const t = e.target;
    const actionBtn = t.closest("button");
    if (!actionBtn) return;

    if (actionBtn.classList.contains("btn-review-refund")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) openRefundModal(id);
    }
    if (actionBtn.classList.contains("btn-settle-balance")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) handleMarkBalanceSettled(id);
    }
    if (actionBtn.classList.contains("btn-accept-order")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) handleOrderAccept(id);
    }
    if (actionBtn.classList.contains("btn-decline-order")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) handleOrderDecline(id);
    }
    if (actionBtn.classList.contains("btn-delete-order")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) handleDeclinedOrderDelete(id);
    }
  });
}

// Refund Modal & Balance Settlement Logic
let currentRefundOrderId = null;
const refundModalEl = document.getElementById("refund-modal");
const closeRefundModalBtnEl = document.getElementById("close-refund-modal-btn");
const refundFormEl = document.getElementById("refund-action-form");
const rejectRefundBtnEl = document.getElementById("reject-refund-btn");

function openRefundModal(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;
  currentRefundOrderId = orderId;

  const customerName = resolveCustomerDisplay(order);
  const customerEmail = pickFirstNonEmpty(order.customerEmail, order.email, order.userEmail, "—");
  const totalVal = Number(order.totalAmount ?? order.total ?? 0);
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
  const paidVal = Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));

  const elName = document.getElementById("refund-customer-name");
  const elEmail = document.getElementById("refund-customer-email");
  const elOrderId = document.getElementById("refund-order-id");
  const elAmount = document.getElementById("refund-amount-paid");
  const elReason = document.getElementById("refund-reason-text");
  const elDetails = document.getElementById("refund-details-text");
  const inputAmt = document.getElementById("refund-amount-input");
  const inputTx = document.getElementById("refund-tx-id-input");
  const inputNote = document.getElementById("refund-admin-note-input");

  if (elName) elName.textContent = customerName;
  if (elEmail) elEmail.textContent = customerEmail;
  if (elOrderId) elOrderId.textContent = `#${orderId}`;
  if (elAmount) elAmount.textContent = formatPeso(paidVal);
  if (elReason) elReason.textContent = order.refundReason || order.cancellationReason || "Customer requested refund / cancellation";
  if (elDetails) elDetails.textContent = order.refundDetails || "No additional details provided.";

  if (inputAmt) inputAmt.value = paidVal.toFixed(2);
  if (inputTx) inputTx.value = `REF-${Math.floor(100000 + Math.random() * 900000)}`;
  if (inputNote) inputNote.value = "";

  if (refundModalEl) refundModalEl.classList.add("active");
}

function closeRefundModal() {
  currentRefundOrderId = null;
  if (refundModalEl) refundModalEl.classList.remove("active");
}

if (closeRefundModalBtnEl) {
  closeRefundModalBtnEl.addEventListener("click", closeRefundModal);
}
if (refundModalEl) {
  refundModalEl.addEventListener("click", (e) => {
    if (e.target === refundModalEl) closeRefundModal();
  });
}

if (refundFormEl) {
  refundFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentRefundOrderId) return;
    const inputAmt = document.getElementById("refund-amount-input");
    const inputTx = document.getElementById("refund-tx-id-input");
    const inputNote = document.getElementById("refund-admin-note-input");
    const approveBtn = document.getElementById("approve-refund-btn");

    const refundAmt = Number(inputAmt ? inputAmt.value : 0);
    const txId = inputTx ? inputTx.value.trim() : "";
    const adminNote = inputNote ? inputNote.value.trim() : "";

    if (!txId) {
      alert("Transaction Reference ID is required for audit & refund approval.");
      return;
    }

    try {
      if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.textContent = "Processing Refund...";
      }

      const now = Timestamp.now();
      await updateDoc(doc(db, "orders", currentRefundOrderId), {
        refundStatus: "refund_completed",
        status: "refunded",
        orderStatus: "refunded",
        refundedAmount: refundAmt,
        refundTransactionId: txId,
        refundAdminNote: adminNote,
        refundCompletedAt: now,
        updatedAt: now,
      });

      alert(`Refund for Order #${currentRefundOrderId} approved and marked completed successfully!`);
      closeRefundModal();
    } catch (err) {
      console.error("Failed to approve refund:", err);
      alert(err.message || "Failed to process refund.");
    } finally {
      if (approveBtn) {
        approveBtn.disabled = false;
        approveBtn.textContent = "Approve & Complete Refund";
      }
    }
  });
}

if (rejectRefundBtnEl) {
  rejectRefundBtnEl.addEventListener("click", async () => {
    if (!currentRefundOrderId) return;
    const inputNote = document.getElementById("refund-admin-note-input");
    const adminNote = inputNote ? inputNote.value.trim() : "";

    if (!confirm(`Reject refund request for Order #${currentRefundOrderId}?`)) return;

    try {
      rejectRefundBtnEl.disabled = true;
      rejectRefundBtnEl.textContent = "Rejecting...";

      const now = Timestamp.now();
      await updateDoc(doc(db, "orders", currentRefundOrderId), {
        refundStatus: "refund_rejected",
        status: "placed",
        orderStatus: "placed",
        refundAdminNote: adminNote,
        refundRejectedAt: now,
        updatedAt: now,
      });

      alert(`Refund request for Order #${currentRefundOrderId} has been rejected.`);
      closeRefundModal();
    } catch (err) {
      console.error("Failed to reject refund:", err);
      alert(err.message || "Failed to reject refund request.");
    } finally {
      rejectRefundBtnEl.disabled = false;
      rejectRefundBtnEl.textContent = "Reject Refund Request";
    }
  });
}

async function handleMarkBalanceSettled(orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  const totalVal = Number(order.totalAmount ?? order.total ?? 0);
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
  const paidVal = Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
  const currentBalance = Number(order.remainingBalance ?? order.balanceDue ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));

  if (!confirm(`Mark balance of ₱${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} settled for Order #${orderId.slice(0, 8)}...?`)) {
    return;
  }

  try {
    const now = Timestamp.now();
    await updateDoc(doc(db, "orders", orderId), {
      remainingBalance: 0,
      balanceDue: 0,
      balanceStatus: "settled",
      balanceSettlementMethod: "cash",
      balanceSettledAmount: currentBalance,
      balanceSettledAt: now,
      updatedAt: now,
    });
    console.log(`Marked balance settled for order ${orderId}`);
  } catch (err) {
    console.error("Failed to settle balance:", err);
    alert(err.message || "Could not mark balance settled.");
  }
}

function renderWorkshopQueue(orders) {
  const containerQueued = document.getElementById("kanban-list-queued");
  const containerProduction = document.getElementById("kanban-list-production");
  const containerQC = document.getElementById("kanban-list-qc");
  const containerShipped = document.getElementById("kanban-list-shipped");

  if (!containerQueued || !containerProduction || !containerQC || !containerShipped) return;

  const activeOrders = (orders || []).filter(
    (o) => !isOrderCompleted(o) && normalizeOrderAction(o.action) !== "delete"
  );

  const groupQueued = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "downpayment confirmed" || st === "placed";
  });
  const groupProduction = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "in production");
  const groupQC = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "quality checked");
  const groupShipped = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "shipped");

  const elQueued = document.getElementById("workshop-deposit-verified");
  const elInProd = document.getElementById("workshop-in-production");
  const elQc = document.getElementById("workshop-qc-passed");
  const elShowroom = document.getElementById("workshop-showroom-units");

  if (elQueued) elQueued.textContent = String(groupQueued.length);
  if (elInProd) elInProd.textContent = String(groupProduction.length);
  if (elQc) elQc.textContent = String(groupQC.length);
  if (elShowroom) elShowroom.textContent = String((allProducts || []).reduce((sum, p) => sum + (Number(p.stock) || 0), 0));

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(count);
  };
  setBadge("kanban-count-queued", groupQueued.length);
  setBadge("kanban-count-production", groupProduction.length);
  setBadge("kanban-count-qc", groupQC.length);
  setBadge("kanban-count-shipped", groupShipped.length);

  const createKanbanCard = (order, nextStage, nextLabel) => {
    const customer = resolveCustomerDisplay(order);
    const items = Array.isArray(order.items) ? order.items : [];

    let totalQty = 0;
    items.forEach((it) => {
      totalQty += Number(it.quantity || 1);
    });

    const totalVal = Number(order.totalAmount ?? order.total ?? 0);
    const totalAmountStr = `₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const specsHTML = items
      .map((it) => {
        const itemQty = Number(it.quantity || 1);
        const itemPrice = Number(it.price || 0);
        const itemSubtotal = Number(it.subtotal || itemPrice * itemQty);
        const notes = it.customNotes
          ? `<div class="kanban-custom-specs" style="margin-top:4px;"><strong>Custom Specs:</strong> ${escapeHtml(it.customNotes)}</div>`
          : "";
        return `
          <div style="margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed #e2e8f0;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
              <strong>${escapeHtml(it.name || "Item")}</strong>
              <span style="font-weight: 700; color: #0f172a; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 0.74rem;">Qty: ${itemQty}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.76rem; color: #64748b; margin-top: 2px;">
              <span>Material: ${escapeHtml(it.material || "Standard")}</span>
              <span style="font-weight: 600; color: #334155;">₱${itemSubtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            ${notes}
          </div>
        `;
      })
      .join("");

    const card = document.createElement("div");
    card.className = "kanban-card";
    card.innerHTML = `
      <div class="kanban-card-header" style="padding-bottom: 6px; border-bottom: 1px solid #f1f5f9; margin-bottom: 8px;">
        <div>
          <div class="kanban-order-id" style="font-weight:700; color:#0f172a;">#${escapeHtml(order.id.slice(0, 8))}</div>
          <div class="kanban-customer-name" style="font-size:0.8rem; color:#475569;">${escapeHtml(String(customer))}</div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.72rem; color: #c2410c; background: #fff7ed; padding: 2px 6px; border-radius: 6px; font-weight: 600; display: inline-block;">${escapeHtml(order.orderType || "Made-to-Order")}</span>
          <div style="font-size:0.85rem; font-weight:700; color:#0f172a; margin-top:3px;">${totalAmountStr}</div>
        </div>
      </div>
      <div class="kanban-items-list" style="margin-bottom: 8px;">${specsHTML}</div>
      <div class="kanban-card-footer" style="display: flex; justify-content: space-between; align-items: center; pt: 6px; border-top: 1px solid #f1f5f9;">
        <div>
          <span class="kanban-lead-time" style="font-size:0.73rem; color:#64748b; display:block;">🕒 ${escapeHtml(order.estimatedLeadTime || "14–21 Days")}</span>
          <span style="font-size: 0.72rem; font-weight: 700; color: #334155;">Total Qty: ${totalQty} items</span>
        </div>
        ${
          nextStage
            ? `<button type="button" class="kanban-btn-next btn-advance-crafting" data-order-id="${escapeHtml(
                order.id
              )}" data-next-status="${nextStage}">
                ${nextLabel}
              </button>`
            : `<span style="font-size:0.75rem; color:#059669; font-weight:600;">Dispatched ✓</span>`
        }
      </div>
    `;
    return card;
  };

  const renderCol = (container, group, nextStage, nextLabel, emptyText) => {
    container.innerHTML = "";
    if (group.length === 0) {
      container.innerHTML = `<div class="kanban-empty">${emptyText}</div>`;
      return;
    }
    group.forEach((o) => {
      container.appendChild(createKanbanCard(o, nextStage, nextLabel));
    });
  };

  renderCol(containerQueued, groupQueued, "in production", "Start Crafting", "No queued orders");
  renderCol(containerProduction, groupProduction, "quality checked", "Pass QC Check", "No orders in crafting");
  renderCol(containerQC, groupQC, "shipped", "Dispatch Order", "No orders awaiting dispatch");
  renderCol(containerShipped, groupShipped, null, null, "No recently shipped orders");
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-advance-crafting");
  if (!btn) return;
  const orderId = btn.getAttribute("data-order-id");
  const nextStatus = btn.getAttribute("data-next-status");
  if (!orderId || !nextStatus) return;

  try {
    btn.disabled = true;
    btn.textContent = "Updating...";
    await updateDoc(doc(db, "orders", orderId), {
      status: nextStatus,
      orderStatus: nextStatus,
      updatedAt: Timestamp.now(),
    });
    console.log(`Advanced order ${orderId} to ${nextStatus}`);
  } catch (err) {
    console.error("Failed to advance crafting stage:", err);
    alert(err.message || "Failed to update order status.");
  } finally {
    btn.disabled = false;
  }
});

// Live Chat Inbox Implementation
let activeChatSessionId = null;
let activeChatUnsubscribe = null;
let allChatSessions = [];
const sessionMessageUnsubs = new Map();
const sessionUnreadCounts = new Map();
const sessionLatestMessages = new Map();

function playChatNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Autoplay policy might mute until user interaction, ignore safely
  }
}

function showChatNotificationToast(messageText, session) {
  let container = document.getElementById("lanica-chat-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "lanica-chat-toast-container";
    container.style.cssText =
      "position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; max-width: 360px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.style.cssText =
    "background: #111827; color: #fff; padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #ef4444; transition: transform 0.2s, opacity 0.2s;";
  toast.innerHTML = `
    <div style="flex: 1; margin-right: 10px;">
      <div style="font-weight: 700; color: #f87171; font-size: 0.74rem; text-transform: uppercase; margin-bottom: 2px;">💬 New Customer Message</div>
      <div style="color: #f3f4f6; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.3;">
        <strong>${escapeHtml(session?.customerName || "Customer")}:</strong> ${escapeHtml(messageText)}
      </div>
    </div>
    <button type="button" style="background: none; border: none; color: #9ca3af; font-size: 1.1rem; cursor: pointer; line-height: 1; padding: 4px;">✕</button>
  `;

  toast.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON" && session) {
      const chatNav = document.getElementById("nav-chats");
      if (chatNav) chatNav.click();
      const sessionsListEl = document.getElementById("admin-chat-sessions-list");
      if (sessionsListEl) {
        const item = sessionsListEl.querySelector(`[data-session-id="${session.id}"]`);
        if (item) item.click();
      }
    }
    toast.remove();
  });

  const closeBtn = toast.querySelector("button");
  if (closeBtn) closeBtn.addEventListener("click", () => toast.remove());

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 7000);
}

function updateAdminNavChatBadge() {
  let totalUnread = 0;
  sessionUnreadCounts.forEach((count) => {
    totalUnread += count;
  });

  const navBadge = document.getElementById("nav-chat-unread-badge");
  if (navBadge) {
    if (totalUnread > 0) {
      navBadge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
      navBadge.style.display = "inline-block";
    } else {
      navBadge.style.display = "none";
    }
  }
}

function setupAdminLiveChat() {
  const sessionsListEl = document.getElementById("admin-chat-sessions-list");
  const messagesEl = document.getElementById("admin-chat-messages");
  const customerNameEl = document.getElementById("admin-chat-customer-name");
  const customerEmailEl = document.getElementById("admin-chat-customer-email");
  const chatForm = document.getElementById("admin-chat-form");
  const chatInput = document.getElementById("admin-chat-input");
  const fileInput = document.getElementById("admin-chat-file-input");
  const attachBtn = document.getElementById("admin-chat-attach-btn");
  const attachPreview = document.getElementById("admin-chat-attachment-preview");
  const attachFilename = document.getElementById("admin-chat-filename");
  const cancelAttachBtn = document.getElementById("admin-chat-cancel-attachment");

  let attachedFile = null;

  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          alert("Attachment must be under 5MB.");
          fileInput.value = "";
          return;
        }
        attachedFile = file;
        if (attachPreview && attachFilename) {
          attachFilename.textContent = attachedFile.name;
          attachPreview.style.display = "flex";
        }
      }
    });
  }

  if (cancelAttachBtn) {
    cancelAttachBtn.addEventListener("click", () => {
      attachedFile = null;
      if (fileInput) fileInput.value = "";
      if (attachPreview) attachPreview.style.display = "none";
    });
  }

  let currentChatFilter = "all";
  const filterAllBtn = document.getElementById("admin-chat-filter-all");
  const filterSupportBtn = document.getElementById("admin-chat-filter-support");
  const filterOrdersBtn = document.getElementById("admin-chat-filter-orders");

  function setChatFilter(filter) {
    currentChatFilter = filter;
    [filterAllBtn, filterSupportBtn, filterOrdersBtn].forEach((btn) => {
      if (!btn) return;
      btn.style.background = "#fff";
      btn.style.color = "#374151";
      btn.style.border = "1px solid #d1d5db";
    });
    const activeBtn =
      filter === "support"
        ? filterSupportBtn
        : filter === "orders"
        ? filterOrdersBtn
        : filterAllBtn;
    if (activeBtn) {
      activeBtn.style.background = "#111827";
      activeBtn.style.color = "#fff";
      activeBtn.style.border = "none";
    }
    renderChatSessionsList(allChatSessions);
  }

  if (filterAllBtn) filterAllBtn.addEventListener("click", () => setChatFilter("all"));
  if (filterSupportBtn) filterSupportBtn.addEventListener("click", () => setChatFilter("support"));
  if (filterOrdersBtn) filterOrdersBtn.addEventListener("click", () => setChatFilter("orders"));

  // Subscribe to all conversations (both live support & orders)
  subscribeToAllChats((sessions) => {
    allChatSessions = sessions;
    attachMessageListeners(sessions);
    renderChatSessionsList(sessions);
  });

  function attachMessageListeners(sessions) {
    sessions.forEach((s) => {
      if (sessionMessageUnsubs.has(s.id)) return;

      const isSupport = s.sessionType === "support" || s.isUserSupport || String(s.id).startsWith("user_");
      const cleanUid = s.userId || s.actualId || String(s.id).replace(/^user_/, "");
      const messagesColRef = isSupport
        ? collection(db, "users", cleanUid, "messages")
        : collection(db, "orders", s.id, "messages");

      const unsub = onSnapshot(messagesColRef, (snapshot) => {
        let unread = 0;
        let latestMsg = null;
        let latestTime = 0;

        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          const isFromStaff =
            d.senderRole === "admin" ||
            d.senderRole === "staff" ||
            d.senderId === "support_admin";

          // Unread by admin if sent by customer and isRead is false
          if (!isFromStaff && d.isRead === false) {
            unread++;
          }

          const msgTime =
            d.timestamp?.toMillis?.() ||
            d.createdAt?.toMillis?.() ||
            (d.timestamp?.seconds ? d.timestamp.seconds * 1000 : 0) ||
            (d.createdAt?.seconds ? d.createdAt.seconds * 1000 : 0) ||
            0;

          if (msgTime >= latestTime) {
            latestTime = msgTime;
            latestMsg = d;
          }
        });

        const prevUnread = sessionUnreadCounts.get(s.id) || 0;
        sessionUnreadCounts.set(s.id, unread);

        if (latestMsg) {
          const textPreview =
            latestMsg.content ||
            latestMsg.text ||
            latestMsg.message ||
            (latestMsg.type === 1 || latestMsg.attachmentUrl || latestMsg.imageUrl
              ? "[Photo Attachment]"
              : "");

          sessionLatestMessages.set(s.id, {
            text: textPreview,
            time: latestMsg.timestamp || latestMsg.createdAt,
            timeMs: latestTime,
            isFromStaff:
              latestMsg.senderRole === "admin" ||
              latestMsg.senderRole === "staff" ||
              latestMsg.senderId === "support_admin",
          });
        }

        // New unread customer message notification
        if (unread > prevUnread && activeChatSessionId !== s.id) {
          playChatNotificationSound();
          const preview =
            latestMsg?.content ||
            latestMsg?.text ||
            latestMsg?.message ||
            "Sent an attachment";
          showChatNotificationToast(preview, s);
        }

        // If this conversation is currently open, mark read immediately
        if (activeChatSessionId === s.id && unread > 0) {
          markOrderMessagesAsRead(s.id, "admin", isSupport);
          sessionUnreadCounts.set(s.id, 0);
        }

        updateAdminNavChatBadge();
        renderChatSessionsList(allChatSessions);
      });

      sessionMessageUnsubs.set(s.id, unsub);
    });
  }

  const chatSearchInput = document.getElementById("admin-chat-search-input");
  const chatSearchClear = document.getElementById("admin-chat-search-clear");
  let chatSearchDebounce = null;

  if (chatSearchInput) {
    chatSearchInput.addEventListener("input", (e) => {
      clearTimeout(chatSearchDebounce);
      const val = e.target.value;
      if (chatSearchClear) {
        chatSearchClear.style.display = val.trim().length > 0 ? "flex" : "none";
      }
      chatSearchDebounce = setTimeout(() => {
        adminChatSearchQuery = val;
        renderChatSessionsList(allChatSessions);
      }, 200);
    });
  }

  if (chatSearchClear) {
    chatSearchClear.addEventListener("click", () => {
      if (chatSearchInput) chatSearchInput.value = "";
      chatSearchClear.style.display = "none";
      adminChatSearchQuery = "";
      if (chatSearchInput) chatSearchInput.focus();
      renderChatSessionsList(allChatSessions);
    });
  }

  function renderChatSessionsList(sessions) {
    if (!sessionsListEl) return;

    // Filter by active category tab
    let filteredSessions = sessions.filter((s) => {
      if (currentChatFilter === "support") return s.sessionType === "support";
      if (currentChatFilter === "orders") return s.sessionType === "order";
      return true;
    });

    // Real-time search query filtering by customer name, email, order ID, and message preview
    if (adminChatSearchQuery) {
      const q = adminChatSearchQuery.toLowerCase().trim();
      filteredSessions = filteredSessions.filter((s) => {
        const name = (s.customerName || "").toLowerCase();
        const email = (s.customerEmail || "").toLowerCase();
        const id = String(s.id || s.actualId || "").toLowerCase();
        const preview = (sessionLatestMessages.get(s.id)?.text || "").toLowerCase();
        return name.includes(q) || email.includes(q) || id.includes(q) || preview.includes(q);
      });
    }

    if (filteredSessions.length === 0) {
      if (adminChatSearchQuery) {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #9ca3af; font-size: 0.85rem;">No conversations found matching "${escapeHtml(adminChatSearchQuery)}".</div>`;
      } else {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #9ca3af; font-size: 0.85rem;">No ${
          currentChatFilter === "support"
            ? "general live support"
            : currentChatFilter === "orders"
            ? "order crafting"
            : "active"
        } conversations found.</div>`;
      }
      return;
    }

    // Sort: Unread conversations first, then by most recent message/order time
    const sorted = [...filteredSessions].sort((a, b) => {
      const unreadA = sessionUnreadCounts.get(a.id) || 0;
      const unreadB = sessionUnreadCounts.get(b.id) || 0;
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadB > 0 && unreadA === 0) return 1;

      const timeA =
        sessionLatestMessages.get(a.id)?.timeMs ||
        a.updatedAt?.toMillis?.() ||
        a.createdAt?.toMillis?.() ||
        0;
      const timeB =
        sessionLatestMessages.get(b.id)?.timeMs ||
        b.updatedAt?.toMillis?.() ||
        b.createdAt?.toMillis?.() ||
        0;
      return timeB - timeA;
    });

    sessionsListEl.innerHTML = "";
    sorted.forEach((s) => {
      const isSelected = s.id === activeChatSessionId;
      const unreadCount = sessionUnreadCounts.get(s.id) || 0;
      const latestInfo = sessionLatestMessages.get(s.id);
      const displayMessage = latestInfo?.text || s.lastMessage || "No messages yet";
      const isSupport = s.sessionType === "support";

      const timeVal = latestInfo?.time || s.updatedAt || s.createdAt;
      const timeStr = timeVal?.toDate
        ? timeVal.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

      const item = document.createElement("div");
      item.className = "chat-session-item";
      item.setAttribute("data-session-id", s.id);
      item.style.cssText = `padding: 12px 16px; border-bottom: 1px solid #f3f4f6; cursor: pointer; background: ${
        isSelected ? "#eff6ff" : unreadCount > 0 ? "#fef2f2" : "#fff"
      }; border-left: ${
        isSelected ? "4px solid #3b82f6" : unreadCount > 0 ? "4px solid #ef4444" : "4px solid transparent"
      }; transition: background 0.15s;`;

      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <strong style="font-size: 0.85rem; color: ${unreadCount > 0 ? "#991b1b" : "#111827"}; display: flex; align-items: center; gap: 6px;">
            ${escapeHtml(s.customerName || "Customer")}
            ${
              isSupport
                ? `<span style="font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">💬 Live Support</span>`
                : `<span style="font-weight: 400; color: #6b7280; font-size: 0.76rem;">#${escapeHtml(s.orderId || s.id)}</span>`
            }
          </strong>
          <span style="font-size: 0.72rem; color: #9ca3af;">${timeStr}</span>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-size: 0.70rem; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: ${
            isSupport ? "#ecfdf5" : "#f3f4f6"
          }; color: ${isSupport ? "#047857" : "#4b5563"};">
            ${escapeHtml(s.status || (isSupport ? "Live Support" : "Placed"))}
          </span>
          ${
            unreadCount > 0
              ? `<span style="background: #ef4444; color: #ffffff; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; min-width: 18px; text-align: center; line-height: 1.2; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.4);">${unreadCount}</span>`
              : ""
          }
        </div>
        <div style="font-size: 0.78rem; color: ${
          unreadCount > 0 ? "#111827" : "#6b7280"
        }; font-weight: ${
        unreadCount > 0 ? "600" : "400"
      }; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${unreadCount > 0 ? `<span style="color: #ef4444; margin-right: 4px;">●</span>` : ""}${escapeHtml(
        displayMessage
      )}
        </div>
      `;

      item.addEventListener("click", () => {
        selectChatSession(s);
      });

      sessionsListEl.appendChild(item);
    });
  }

  const mobileBackBtn = document.getElementById("admin-chat-mobile-back");
  const chatWorkspaceEl = document.getElementById("admin-chat-workspace");

  if (mobileBackBtn && chatWorkspaceEl) {
    mobileBackBtn.addEventListener("click", () => {
      chatWorkspaceEl.classList.remove("mobile-chat-open");
    });
  }

  let adminChatVisibleLimit = 5;

  function selectChatSession(session) {
    activeChatSessionId = session.id;
    adminChatVisibleLimit = 5; // Reset batch to 5 latest messages
    const isSupport = session.sessionType === "support";

    if (chatWorkspaceEl) {
      chatWorkspaceEl.classList.add("mobile-chat-open");
    }

    // Immediately clear unread status for this session
    sessionUnreadCounts.set(session.id, 0);
    updateAdminNavChatBadge();
    markOrderMessagesAsRead(session.id, "admin", isSupport);

    if (customerNameEl) {
      if (isSupport) {
        customerNameEl.innerHTML = `<span style="background: #fef3c7; color: #92400e; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">💬 LIVE SUPPORT</span>${escapeHtml(
          session.customerName || "Customer"
        )}`;
      } else {
        customerNameEl.innerHTML = `<span style="background: #e0f2fe; color: #0369a1; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">🧵 ORDER #${escapeHtml(
          session.orderId || session.id
        )}</span>${escapeHtml(session.customerName || "Customer")}`;
      }
    }
    if (customerEmailEl) {
      if (isSupport) {
        customerEmailEl.textContent = `Email: ${session.customerEmail || "Not provided"} • Customer ID: ${
          session.userId || session.actualId
        }`;
      } else {
        customerEmailEl.textContent = `Status: ${session.status || "Placed"} | Total: ₱${Number(
          session.totalAmount || 0
        ).toLocaleString()} (Doc ID: ${session.id})`;
      }
    }

    renderChatSessionsList(allChatSessions);

    if (activeChatUnsubscribe) activeChatUnsubscribe();

    let allLoadedMessages = [];

    function renderMessageBatch() {
      if (!messagesEl) return;
      if (allLoadedMessages.length === 0) {
        messagesEl.innerHTML = `<div style="margin: auto; text-align: center; color: #9ca3af; font-size: 0.88rem;">No messages in this ${
          isSupport ? "support" : "order"
        } thread yet. Send a greeting!</div>`;
        return;
      }

      const totalCount = allLoadedMessages.length;
      const startIndex = Math.max(0, totalCount - adminChatVisibleLimit);
      const visibleMsgs = allLoadedMessages.slice(startIndex);
      const hiddenCount = startIndex;

      messagesEl.innerHTML = "";

      if (hiddenCount > 0) {
        const loadMoreBtn = document.createElement("div");
        loadMoreBtn.className = "chat-load-earlier-btn";
        loadMoreBtn.style.cssText = "text-align: center; margin: 4px auto 12px auto; font-size: 0.78rem; color: #2563eb; cursor: pointer; padding: 6px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 20px; font-weight: 600; width: fit-content; user-select: none; transition: all 0.15s ease;";
        loadMoreBtn.innerHTML = `📜 Load earlier messages (${hiddenCount} hidden)`;
        loadMoreBtn.addEventListener("click", () => {
          const oldScrollHeight = messagesEl.scrollHeight;
          adminChatVisibleLimit += 5;
          renderMessageBatch();
          messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
        });
        messagesEl.appendChild(loadMoreBtn);
      }

      visibleMsgs.forEach((m) => {
        const isStaff =
          m.senderRole === "admin" ||
          m.senderRole === "staff" ||
          m.senderId === "support_admin";

        const row = document.createElement("div");
        row.style.cssText = `display: flex; flex-direction: column; align-items: ${
          isStaff ? "flex-end" : "flex-start"
        }; margin-bottom: 12px;`;

        const senderLabel = isStaff
          ? "Lanica Workshop & Admin"
          : session.customerName || m.senderName || "Customer";

        const timeVal = m.timestamp || m.createdAt;
        const timeStr = timeVal?.toDate
          ? timeVal.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        const textContent = m.content || m.text || m.message || "";
        const mediaUrl =
          m.attachmentUrl || m.imageUrl || (m.type === 1 ? m.content : "") || "";

        row.innerHTML = `
          <span style="font-size: 0.72rem; color: #6b7280; margin-bottom: 2px;">
            ${escapeHtml(senderLabel)} • ${timeStr}
          </span>
          <div style="max-width: 75%; padding: 10px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.4; background: ${
            isStaff ? "#6b4423" : "#ffffff"
          }; color: ${isStaff ? "#fff" : "#1f2937"}; border: 1px solid ${
          isStaff ? "#6b4423" : "#e5e7eb"
        }; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            ${
              m.isUnsent
                ? `<p style="margin: 0; font-style: italic; color: #9ca3af;">This message was unsent</p>`
                : textContent
                ? `<p style="margin: 0; white-space: pre-wrap;">${escapeHtml(textContent)}</p>`
                : ""
            }
            ${
              mediaUrl && !m.isUnsent
                ? `<a href="${mediaUrl}" target="_blank" rel="noopener"><img src="${mediaUrl}" style="max-width: 240px; max-height: 180px; border-radius: 6px; margin-top: 6px; display: block;" /></a>`
                : ""
            }
          </div>
        `;
        messagesEl.appendChild(row);
      });
    }

    if (messagesEl) {
      messagesEl.onscroll = () => {
        if (messagesEl.scrollTop <= 10 && allLoadedMessages.length > adminChatVisibleLimit) {
          const oldScrollHeight = messagesEl.scrollHeight;
          adminChatVisibleLimit += 5;
          renderMessageBatch();
          messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
        }
      };
    }

    activeChatUnsubscribe = subscribeToMessages(session.id, (messages) => {
      if (!messagesEl) return;

      // Mark messages read in real time as they arrive while chat is open
      markOrderMessagesAsRead(session.id, "admin", isSupport);
      sessionUnreadCounts.set(session.id, 0);
      updateAdminNavChatBadge();

      allLoadedMessages = messages;
      renderMessageBatch();

      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, null, isSupport);
  }

  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = chatInput?.value || "";
      if (!text.trim() && !attachedFile) return;
      if (!activeChatSessionId) {
        alert("Please select a customer conversation first.");
        return;
      }

      const activeSession = allChatSessions.find((s) => s.id === activeChatSessionId);
      const isSupport = activeSession?.sessionType === "support";

      try {
        let attachmentUrl = "";
        if (attachedFile) {
          attachmentUrl = await uploadChatAttachment(
            attachedFile,
            isSupport ? `support_${activeSession?.userId || "user"}` : activeChatSessionId
          );
          attachedFile = null;
          if (fileInput) fileInput.value = "";
          if (attachPreview) attachPreview.style.display = "none";
        }

        await sendChatMessage({
          orderId: isSupport ? null : activeChatSessionId,
          userId: isSupport ? (activeSession?.userId || activeSession?.actualId) : null,
          sessionType: activeSession?.sessionType || "order",
          isUserSupport: isSupport,
          senderId: currentUser ? currentUser.uid : "support_admin",
          senderName: "Lanica Workshop & Admin",
          senderRole: "admin",
          receiverId: activeSession?.userId || "customer",
          text: text,
          attachmentUrl: attachmentUrl,
        });

        if (chatInput) chatInput.value = "";
      } catch (err) {
        console.error("Chat send error:", err);
        alert(err.message || "Failed to send reply.");
      }
    });
  }
}

setupAdminLiveChat();
setupAddonsRepeaterUI();

syncBatchDeleteUi();

// Initialize section routing from URL hash or default to Dashboard
const initialHash = (window.location.hash || "").replace("#", "").toLowerCase();
showAdminSection(initialHash || "dashboard");

window.addEventListener("hashchange", () => {
  const currentHash = (window.location.hash || "").replace("#", "").toLowerCase();
  showAdminSection(currentHash || "dashboard");
});
