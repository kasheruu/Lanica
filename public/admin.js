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
  serverTimestamp,
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
  unsendChatMessage,
  showMessengerUnsendModal,
  archiveChatSession,
  unarchiveChatSession,
  deleteConversation,
} from "./chatService.js";

import {
  renderPagination,
  showTableSkeleton,
  renderTableEmptyState,
} from "./paginationService.js";

import { compressAndResizeImage } from "./imageOptimizationService.js";
import { loadCachedModel, attachModelToViewer } from "./modelCacheService.js";

import {
  recordAuditLog,
  logActivity,
  fetchAuditLogs,
} from "./auditService.js";
import { showToast, showConfirmModal, showAlertModal } from "./uiFeedback.js";

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
    sessionStorage.removeItem("lanica_admin_role");
    window.location.replace("/login.html");
    return;
  }

  currentUser = user;

  try {
    await Promise.race([
      reload(user),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Auth reload timeout")), 2500)),
    ]);
  } catch (e) {
    console.warn("Could not reload auth user (proceeding without block):", e);
  }
  if (!user.emailVerified) {
    window.location.replace("/login.html");
    return;
  }

  const role = await getUserRole(user);
  if (currentUser) currentUser.role = role || "admin";

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
    sessionStorage.setItem("lanica_admin_role", "admin");
    startAdminRealtimeListeners(user);
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
// Custom Colors / Fabric Shades Tags Field & Dynamic Quick Add
// ==========================================================================
const DEFAULT_QUICK_ADD_COLORS = [
  "Gamusa Bailey Mustang",
  "Emerald Green",
  "Charcoal Grey",
  "Cream Beige",
  "Navy Blue",
  "Warm Cognac",
  "Dusty Rose",
  "Olive Green"
];

function loadQuickAddColors() {
  try {
    const raw = localStorage.getItem("lanica_quick_add_colors");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, QUICK_ADD_LIMIT);
      }
    }
  } catch (err) {
    console.warn("Could not load quick add colors from localStorage:", err);
  }
  return [...DEFAULT_QUICK_ADD_COLORS];
}

function saveQuickAddColors(list) {
  try {
    const capped = list.slice(0, QUICK_ADD_LIMIT);
    localStorage.setItem("lanica_quick_add_colors", JSON.stringify(capped));
  } catch (err) {
    console.warn("Could not save quick add colors to localStorage:", err);
  }
}

let quickAddColors = loadQuickAddColors();
let currentColorsList = [];
const colorTagsList = document.getElementById("color-tags-list");
const colorInput = document.getElementById("product-color-input");
const colorHiddenInput = document.getElementById("product-color");
const addColorTagBtn = document.getElementById("btn-add-color-tag");
const quickAddColorsListEl = document.getElementById("quick-add-colors-list");
const btnResetQuickAddColors = document.getElementById("btn-reset-quick-add-colors");

function renderColorTags() {
  if (!colorTagsList) return;
  colorTagsList.innerHTML = currentColorsList
    .map(
      (tag, idx) => `
      <span class="color-tag-pill">
        ${escapeHtml(tag)}
        <button type="button" class="color-tag-remove" data-index="${idx}" title="Remove color">&times;</button>
      </span>
    `
    )
    .join("");
  if (colorHiddenInput) {
    colorHiddenInput.value = currentColorsList.join(", ");
  }
}

function renderQuickAddColors() {
  if (!quickAddColorsListEl) return;
  if (!quickAddColors || quickAddColors.length === 0) {
    quickAddColorsListEl.innerHTML = `<span style="font-size: 0.75rem; color: #9ca3af; font-style: italic;">No suggestions. Click "Reset defaults" to restore.</span>`;
    return;
  }
  quickAddColorsListEl.innerHTML = quickAddColors
    .map(
      (col) => `
      <div class="quick-add-chip" data-val="${escapeHtml(col)}">
        <button type="button" class="quick-add-chip-btn" data-val="${escapeHtml(col)}" title="Add ${escapeHtml(col)}">${escapeHtml(col)}</button>
        <button type="button" class="quick-add-chip-remove" data-val="${escapeHtml(col)}" title="Remove ${escapeHtml(col)} from quick add">&times;</button>
      </div>
    `
    )
    .join("");
}

function addRecentQuickAddColor(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const existingIdx = quickAddColors.findIndex((c) => c.toLowerCase() === clean.toLowerCase());
  if (existingIdx !== -1) {
    quickAddColors.splice(existingIdx, 1);
  }
  quickAddColors.unshift(clean);
  if (quickAddColors.length > QUICK_ADD_LIMIT) {
    quickAddColors = quickAddColors.slice(0, QUICK_ADD_LIMIT);
  }
  saveQuickAddColors(quickAddColors);
  renderQuickAddColors();
}

function removeQuickAddColor(val) {
  if (!val) return;
  quickAddColors = quickAddColors.filter((c) => c.toLowerCase() !== val.toLowerCase());
  saveQuickAddColors(quickAddColors);
  renderQuickAddColors();
}

function addColorTag(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const parts = clean
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  parts.forEach((p) => {
    if (!currentColorsList.some((t) => t.toLowerCase() === p.toLowerCase())) {
      currentColorsList.push(p);
      addRecentQuickAddColor(p);
    }
  });
  renderColorTags();
  if (colorInput) colorInput.value = "";
}

function removeColorTag(idx) {
  currentColorsList.splice(idx, 1);
  renderColorTags();
}

function clearColorTags() {
  currentColorsList = [];
  renderColorTags();
  if (colorInput) colorInput.value = "";
}

if (addColorTagBtn) {
  addColorTagBtn.addEventListener("click", () => {
    if (colorInput) addColorTag(colorInput.value);
  });
}

if (colorInput) {
  colorInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addColorTag(colorInput.value);
    }
  });
}

if (colorTagsList) {
  colorTagsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".color-tag-remove");
    if (btn) {
      e.preventDefault();
      const idx = parseInt(btn.dataset.index, 10);
      if (!isNaN(idx)) removeColorTag(idx);
    }
  });
}

if (quickAddColorsListEl) {
  quickAddColorsListEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".quick-add-chip-remove");
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = removeBtn.dataset.val;
      removeQuickAddColor(val);
      return;
    }
    const addBtn = e.target.closest(".quick-add-chip-btn");
    if (addBtn) {
      e.preventDefault();
      const val = addBtn.dataset.val;
      addColorTag(val);
    }
  });
}

if (btnResetQuickAddColors) {
  btnResetQuickAddColors.addEventListener("click", (e) => {
    e.preventDefault();
    quickAddColors = [...DEFAULT_QUICK_ADD_COLORS];
    saveQuickAddColors(quickAddColors);
    renderQuickAddColors();
  });
}
renderQuickAddColors();

// ==========================================================================
// Custom Freebies Tags Field & Dynamic Quick Add
// ==========================================================================
const DEFAULT_QUICK_ADD_FREEBIES = [
  "5 Pillows",
  "Footstool (Class A Foam)",
  "Wood Footings",
  "Extra Throw Pillow",
  "Fabric Cleaner Spray",
  "Matching Ottoman",
  "Headrest Cushion",
  "Wood Care Polish"
];

function loadQuickAddFreebies() {
  try {
    const raw = localStorage.getItem("lanica_quick_add_freebies");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, QUICK_ADD_LIMIT);
      }
    }
  } catch (err) {
    console.warn("Could not load quick add freebies from localStorage:", err);
  }
  return [...DEFAULT_QUICK_ADD_FREEBIES];
}

function saveQuickAddFreebies(list) {
  try {
    const capped = list.slice(0, QUICK_ADD_LIMIT);
    localStorage.setItem("lanica_quick_add_freebies", JSON.stringify(capped));
  } catch (err) {
    console.warn("Could not save quick add freebies to localStorage:", err);
  }
}

let quickAddFreebies = loadQuickAddFreebies();
let currentFreebiesList = [];
const freebieTagsList = document.getElementById("freebie-tags-list");
const freebieInput = document.getElementById("product-freebie-input");
const freebieHiddenInput = document.getElementById("product-freebies");
const addFreebieTagBtn = document.getElementById("btn-add-freebie-tag");
const quickAddFreebiesListEl = document.getElementById("quick-add-freebies-list");
const btnResetQuickAddFreebies = document.getElementById("btn-reset-quick-add-freebies");

function renderFreebieTags() {
  if (!freebieTagsList) return;
  freebieTagsList.innerHTML = currentFreebiesList
    .map(
      (tag, idx) => `
      <span class="freebie-tag-pill">
        ${escapeHtml(tag)}
        <button type="button" class="freebie-tag-remove" data-index="${idx}" title="Remove freebie">&times;</button>
      </span>
    `
    )
    .join("");
  if (freebieHiddenInput) {
    freebieHiddenInput.value = currentFreebiesList.join(", ");
  }
}

function renderQuickAddFreebies() {
  if (!quickAddFreebiesListEl) return;
  if (!quickAddFreebies || quickAddFreebies.length === 0) {
    quickAddFreebiesListEl.innerHTML = `<span style="font-size: 0.75rem; color: #9ca3af; font-style: italic;">No suggestions. Click "Reset defaults" to restore.</span>`;
    return;
  }
  quickAddFreebiesListEl.innerHTML = quickAddFreebies
    .map(
      (f) => `
      <div class="quick-add-chip" data-val="${escapeHtml(f)}">
        <button type="button" class="quick-add-chip-btn" data-val="${escapeHtml(f)}" title="Add ${escapeHtml(f)}">${escapeHtml(f)}</button>
        <button type="button" class="quick-add-chip-remove" data-val="${escapeHtml(f)}" title="Remove ${escapeHtml(f)} from quick add">&times;</button>
      </div>
    `
    )
    .join("");
}

function addRecentQuickAddFreebie(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const existingIdx = quickAddFreebies.findIndex((f) => f.toLowerCase() === clean.toLowerCase());
  if (existingIdx !== -1) {
    quickAddFreebies.splice(existingIdx, 1);
  }
  quickAddFreebies.unshift(clean);
  if (quickAddFreebies.length > QUICK_ADD_LIMIT) {
    quickAddFreebies = quickAddFreebies.slice(0, QUICK_ADD_LIMIT);
  }
  saveQuickAddFreebies(quickAddFreebies);
  renderQuickAddFreebies();
}

function removeQuickAddFreebie(val) {
  if (!val) return;
  quickAddFreebies = quickAddFreebies.filter((f) => f.toLowerCase() !== val.toLowerCase());
  saveQuickAddFreebies(quickAddFreebies);
  renderQuickAddFreebies();
}

function addFreebieTag(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;
  const parts = clean
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  parts.forEach((p) => {
    if (!currentFreebiesList.some((t) => t.toLowerCase() === p.toLowerCase())) {
      currentFreebiesList.push(p);
      addRecentQuickAddFreebie(p);
    }
  });
  renderFreebieTags();
  if (freebieInput) freebieInput.value = "";
}

function removeFreebieTag(idx) {
  currentFreebiesList.splice(idx, 1);
  renderFreebieTags();
}

function clearFreebieTags() {
  currentFreebiesList = [];
  renderFreebieTags();
  if (freebieInput) freebieInput.value = "";
}

if (addFreebieTagBtn) {
  addFreebieTagBtn.addEventListener("click", () => {
    if (freebieInput) addFreebieTag(freebieInput.value);
  });
}

if (freebieInput) {
  freebieInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addFreebieTag(freebieInput.value);
    }
  });
}

if (freebieTagsList) {
  freebieTagsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".freebie-tag-remove");
    if (btn) {
      e.preventDefault();
      const idx = parseInt(btn.dataset.index, 10);
      if (!isNaN(idx)) removeFreebieTag(idx);
    }
  });
}

if (quickAddFreebiesListEl) {
  quickAddFreebiesListEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".quick-add-chip-remove");
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const val = removeBtn.dataset.val;
      removeQuickAddFreebie(val);
      return;
    }
    const addBtn = e.target.closest(".quick-add-chip-btn");
    if (addBtn) {
      e.preventDefault();
      const val = addBtn.dataset.val;
      addFreebieTag(val);
    }
  });
}

if (btnResetQuickAddFreebies) {
  btnResetQuickAddFreebies.addEventListener("click", (e) => {
    e.preventDefault();
    quickAddFreebies = [...DEFAULT_QUICK_ADD_FREEBIES];
    saveQuickAddFreebies(quickAddFreebies);
    renderQuickAddFreebies();
  });
}
renderQuickAddFreebies();

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

function parseDimensionsToWidthLength(dimsStr) {
  if (!dimsStr || typeof dimsStr !== "string") return { width: "", length: "" };
  const matches = dimsStr.match(/(\d+(?:\.\d+)?)\s*(?:[×xX*]|\bby\b)\s*(\d+(?:\.\d+)?)/);
  if (matches) {
    return {
      width: parseFloat(matches[1]) || "",
      length: parseFloat(matches[2]) || "",
    };
  }
  const parts = dimsStr.split(/[×xX*]/).map((p) => parseFloat(p.trim())).filter((n) => !isNaN(n));
  if (parts.length >= 2) {
    return { width: parts[0], length: parts[1] };
  }
  return { width: "", length: "" };
}

const BASE_DEFAULT_BED_SIZES_INCHES = [
  { name: "Single", width: 36, length: 75, priceDelta: 0 },
  { name: "Double / Full", width: 54, length: 75, priceDelta: 2500 },
  { name: "Queen", width: 60, length: 75, priceDelta: 4500 },
  { name: "King", width: 72, length: 78, priceDelta: 7000 },
];

function getDefaultBedSizes(unit = "in") {
  return BASE_DEFAULT_BED_SIZES_INCHES.map((b) => {
    const wCm = b.width * UNIT_TO_CM["in"];
    const lCm = b.length * UNIT_TO_CM["in"];
    const w = unit === "in" ? b.width : Math.round((wCm / UNIT_TO_CM[unit]) * 100) / 100;
    const l = unit === "in" ? b.length : Math.round((lCm / UNIT_TO_CM[unit]) * 100) / 100;
    return {
      name: b.name,
      width: w,
      length: l,
      widthCm: wCm,
      lengthCm: lCm,
      dimensions: `${w} × ${l} ${unit}`,
      priceDelta: b.priceDelta,
    };
  });
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

function getCanonicalCm(input, unit) {
  if (input && input.dataset && input.dataset.canonicalCm && !isNaN(parseFloat(input.dataset.canonicalCm))) {
    return parseFloat(input.dataset.canonicalCm);
  }
  if (!input) return null;
  const val = parseFloat(input.value);
  if (!isNaN(val) && val > 0 && UNIT_TO_CM[unit]) {
    const cm = val * UNIT_TO_CM[unit];
    input.dataset.canonicalCm = cm;
    return cm;
  }
  return null;
}

function setCanonicalCm(input, val, unit) {
  if (!input) return;
  const num = parseFloat(val);
  if (!isNaN(num) && num > 0 && UNIT_TO_CM[unit]) {
    input.dataset.canonicalCm = num * UNIT_TO_CM[unit];
  } else {
    delete input.dataset.canonicalCm;
  }
}

// Track typed inputs on main dimension fields to update canonical cm
[heightInput, widthInput, lengthInput, length2Input].forEach((inp) => {
  if (inp) {
    inp.addEventListener("input", () => {
      const u = unitSelect ? unitSelect.value : currentDimensionUnit || "in";
      setCanonicalCm(inp, inp.value, u);
    });
  }
});

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
      [heightInput, widthInput, lengthInput, length2Input].forEach((inp) => {
        if (!inp) return;
        const cm = getCanonicalCm(inp, oldUnit);
        if (cm != null && UNIT_TO_CM[newUnit]) {
          const converted = cm / UNIT_TO_CM[newUnit];
          inp.value = Math.round(converted * 100) / 100;
          // IMPORTANT: dataset.canonicalCm is preserved to prevent roundoff drift!
        }
      });

      // Auto-convert bed size dimensions using canonical cm as well
      if (Array.isArray(currentBedSizesList) && currentBedSizesList.length > 0) {
        currentBedSizesList.forEach((size) => {
          let wCm = size.widthCm;
          let lCm = size.lengthCm;

          // If widthCm or lengthCm not yet set, initialize from existing width/length/dimensions & oldUnit
          if (wCm == null || isNaN(wCm)) {
            let bw = parseFloat(size.width);
            if ((isNaN(bw) || bw <= 0) && size.dimensions) {
              const parsed = parseDimensionsToWidthLength(size.dimensions);
              if (!isNaN(parsed.width) && parsed.width > 0) bw = parsed.width;
            }
            if (!isNaN(bw) && bw > 0 && UNIT_TO_CM[oldUnit]) {
              wCm = bw * UNIT_TO_CM[oldUnit];
              size.widthCm = wCm;
            }
          }

          if (lCm == null || isNaN(lCm)) {
            let bl = parseFloat(size.length);
            if ((isNaN(bl) || bl <= 0) && size.dimensions) {
              const parsed = parseDimensionsToWidthLength(size.dimensions);
              if (!isNaN(parsed.length) && parsed.length > 0) bl = parsed.length;
            }
            if (!isNaN(bl) && bl > 0 && UNIT_TO_CM[oldUnit]) {
              lCm = bl * UNIT_TO_CM[oldUnit];
              size.lengthCm = lCm;
            }
          }

          if (wCm != null && !isNaN(wCm) && UNIT_TO_CM[newUnit]) {
            size.width = Math.round((wCm / UNIT_TO_CM[newUnit]) * 100) / 100;
          }
          if (lCm != null && !isNaN(lCm) && UNIT_TO_CM[newUnit]) {
            size.length = Math.round((lCm / UNIT_TO_CM[newUnit]) * 100) / 100;
          }
          if (size.width && size.length) {
            size.dimensions = `${size.width} × ${size.length} ${newUnit}`;
          }
        });
        renderBedSizesRepeater();
      }

      document.querySelectorAll(".bed-size-unit-indicator").forEach((el) => {
        el.textContent = newUnit;
      });

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
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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

  updateBedSizesVisibility(currentVal);
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
  categoryManagerList.addEventListener("click", async (e) => {
    const delBtn = e.target.closest(".btn-category-delete");
    if (!delBtn) return;
    const catToDelete = delBtn.dataset.cat;
    if (!catToDelete) return;

    const count = Array.isArray(allProducts)
      ? allProducts.filter((p) => (p.category || "").toLowerCase() === catToDelete.toLowerCase()).length
      : 0;

    const msg = count > 0
      ? `Category "${catToDelete}" currently has ${count} product(s) assigned to it.\n\nAre you sure you want to remove this category option? (Existing products will keep their category value until edited.)`
      : `Are you sure you want to remove category "${catToDelete}"?`;

    const confirmDelete = await showConfirmModal({
      title: "Remove Category",
      message: msg,
      confirmText: "Remove Category",
      cancelText: "Cancel",
      isDestructive: true,
      icon: "delete",
    });
    if (!confirmDelete) return;

    let cats = getStoredCategories().filter((c) => c.toLowerCase() !== catToDelete.toLowerCase());
    saveStoredCategories(cats);
    renderCategoryDropdowns();
    renderCategoryManagerList();
    showToast(`Category "${catToDelete}" removed.`, "info");
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
  const color = document.getElementById("product-color")?.value || "";
  const freebies = document.getElementById("product-freebies")?.value || "";

  const hasContent =
    name.trim() ||
    description.trim() ||
    currentColorsList.length > 0 ||
    currentFreebiesList.length > 0 ||
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
    colors: [...currentColorsList],
    freebies: [...currentFreebiesList],
    materials: currentMaterialTags,
    thumbnailData,
    bedSizes: currentBedSizesList,
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
    if (draft.height !== undefined && heightInput) {
      heightInput.value = draft.height;
      setCanonicalCm(heightInput, draft.height, draft.unit || "in");
    }
    if (draft.width !== undefined && widthInput) {
      widthInput.value = draft.width;
      setCanonicalCm(widthInput, draft.width, draft.unit || "in");
    }
    if (draft.length !== undefined && lengthInput) {
      lengthInput.value = draft.length;
      setCanonicalCm(lengthInput, draft.length, draft.unit || "in");
    }
    if (draft.length2 !== undefined && length2Input) {
      length2Input.value = draft.length2;
      setCanonicalCm(length2Input, draft.length2, draft.unit || "in");
    }
    if (draft.unit !== undefined && unitSelect) {
      unitSelect.value = draft.unit;
      currentDimensionUnit = draft.unit;
    }
    clearMaterialTags();
    if (Array.isArray(draft.materials) && draft.materials.length > 0) {
      draft.materials.forEach((m) => addMaterialTag(m));
    }

    clearColorTags();
    if (Array.isArray(draft.colors) && draft.colors.length > 0) {
      draft.colors.forEach((c) => addColorTag(c));
    } else if (draft.color) {
      draft.color.split(",").forEach((c) => addColorTag(c));
    }

    clearFreebieTags();
    if (Array.isArray(draft.freebies) && draft.freebies.length > 0) {
      draft.freebies.forEach((f) => addFreebieTag(f));
    } else if (typeof draft.freebies === "string" && draft.freebies.trim()) {
      draft.freebies.split(/[\n,]+/).forEach((f) => addFreebieTag(f));
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

    if (Array.isArray(draft.bedSizes) && draft.bedSizes.length > 0) {
      const currentU = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
      currentBedSizesList = draft.bedSizes.map((s) => {
        let w = s.width;
        let l = s.length;
        if ((w == null || w === "") && s.dimensions) {
          const parsed = parseDimensionsToWidthLength(s.dimensions);
          w = parsed.width;
          l = parsed.length;
        }
        return {
          name: s.name || "",
          width: w != null ? w : "",
          length: l != null ? l : "",
          dimensions: s.dimensions || (w && l ? `${w} × ${l} ${currentU}` : ""),
          priceDelta: s.priceDelta != null ? s.priceDelta : 0,
        };
      });
      renderBedSizesRepeater();
      updateBedSizesVisibility(draft.category);
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
  btnDiscardDraft.addEventListener("click", async () => {
    const confirmed = await showConfirmModal({
      title: "Discard Draft",
      message: "Are you sure you want to discard this saved draft and clear the form?",
      confirmText: "Discard Draft",
      cancelText: "Cancel",
      isDestructive: true,
      icon: "warning",
    });
    if (confirmed) {
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
      currentU !== orig.unit ||
      JSON.stringify(currentMaterialTags) !== JSON.stringify(orig.materials || []) ||
      JSON.stringify(currentColorsList) !== JSON.stringify(orig.colors || []) ||
      JSON.stringify(currentFreebiesList) !== JSON.stringify(orig.freebies || [])
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
    const hasColors = currentColorsList.length > 0;
    const hasFreebies = currentFreebiesList.length > 0;
    return (
      name !== "" ||
      desc !== "" ||
      (price !== "" && price !== "0") ||
      stock !== "0" ||
      hasFiles ||
      hasThumbnails ||
      hasMaterials ||
      hasColors ||
      hasFreebies
    );
  }
}

async function handleModalCloseAttempt() {
  if (isSavingProduct) return;
  if (hasUnsavedFormChanges()) {
    const confirmDiscard = await showConfirmModal({
      title: "Unsaved Changes",
      message: "You have unsaved changes in this form. Are you sure you want to discard them and exit?",
      confirmText: "Discard & Exit",
      cancelText: "Keep Editing",
      isDestructive: true,
      icon: "warning",
    });
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
  clearColorTags();
  clearFreebieTags();
  closeCustomCategoryDropdown();
  closeInlineCategoryManager();
  renderCategoryDropdowns();
  clearThumbnailItems();
  clearAddonsRepeater();
  clearBedSizesRepeater();
  updateBedSizesVisibility("");
  if (heightInput) { heightInput.value = "72"; setCanonicalCm(heightInput, 72, "in"); }
  if (widthInput) { widthInput.value = "72"; setCanonicalCm(widthInput, 72, "in"); }
  if (lengthInput) { lengthInput.value = "72"; setCanonicalCm(lengthInput, 72, "in"); }
  if (length2Input) { length2Input.value = "72"; setCanonicalCm(length2Input, 72, "in"); }
  if (isLTypeSelect) isLTypeSelect.value = "false";
  toggleLTypeFields(false);
  if (unitSelect) unitSelect.value = "in";
  currentDimensionUnit = "in";
  if (document.getElementById("product-color")) document.getElementById("product-color").value = "";
  if (document.getElementById("product-freebies")) document.getElementById("product-freebies").value = "";

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
    const confirmed = await showConfirmModal({
      title: "Sign Out",
      message: "Are you sure you want to log out of the Admin Dashboard?",
      confirmText: "Log Out",
      cancelText: "Stay",
      icon: "logout",
    });
    if (!confirmed) return;

    try {
      await signOut(auth);
      showToast("Logged out successfully.", "info");
      setTimeout(() => {
        window.location.replace("/index.html");
      }, 500);
    } catch (error) {
      console.error("Error signing out:", error);
      showToast("Failed to log out. Try again.", "error");
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
      const data = doc.data();
      if (data.isDeleted === true || data.action === "delete") return;
      allProducts.push({ id: doc.id, ...data });
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
      showToast("Please add at least one product thumbnail image.", "warning");
      return;
    }

    // Auto-commit any material typed in the input
    if (materialInput && materialInput.value.trim()) {
      addMaterialTag(materialInput.value);
    }
    const materials = currentMaterialTags.length > 0 ? [...currentMaterialTags] : ["Standard"];
    const material = materials.join(", ");

    // Auto-commit any color typed in the input
    if (colorInput && colorInput.value.trim()) {
      addColorTag(colorInput.value);
    }
    const colors = currentColorsList.length > 0 ? [...currentColorsList] : ["Gamusa Bailey Mustang"];
    const color = colors[0] || "Gamusa Bailey Mustang";

    // Auto-commit any freebie typed in the input
    if (freebieInput && freebieInput.value.trim()) {
      addFreebieTag(freebieInput.value);
    }
    const freebies = currentFreebiesList.length > 0 ? [...currentFreebiesList] : ["5 Pillows", "Footstool (Class A Foam)", "Footings"];
    const freebiesText = freebies.join(", ");

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
        showToast("Failed to generate 3D model: " + err.message, "error");
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
      heightCm: getCanonicalCm(heightInput, unit) || convertDimension(height, unit, "cm"),
      widthCm: getCanonicalCm(widthInput, unit) || convertDimension(width, unit, "cm"),
      lengthCm: getCanonicalCm(lengthInput, unit) || convertDimension(length, unit, "cm"),
      length2Cm: isLType && length2 ? (getCanonicalCm(length2Input, unit) || convertDimension(length2, unit, "cm")) : null,
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
      color,
      colors,
      freebies,
      freebiesText,
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
      bedSizes: currentBedSizesList
        .filter((s) => s && (s.name || "").trim() !== "")
        .map((s) => {
          const w = s.width != null && s.width !== "" ? parseFloat(s.width) || s.width : null;
          const l = s.length != null && s.length !== "" ? parseFloat(s.length) || s.length : null;
          const currentU = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
          const dims = (w && l) ? `${w} × ${l} ${currentU}` : (s.dimensions || "").trim();
          return {
            name: (s.name || "").trim(),
            width: w,
            length: l,
            widthCm: s.widthCm != null ? s.widthCm : (w && UNIT_TO_CM[currentU] ? w * UNIT_TO_CM[currentU] : null),
            lengthCm: s.lengthCm != null ? s.lengthCm : (l && UNIT_TO_CM[currentU] ? l * UNIT_TO_CM[currentU] : null),
            dimensions: dims,
            priceDelta: parseFloat(s.priceDelta) || 0,
          };
        }),
      meshyTaskId: meshyTaskId,
      modelUrl: modelUrl,
      meshyStatus: meshyStatus,
      meshyRegeneratedAt: shouldRegenerateMeshy ? Timestamp.now() : null,
    };

    updateSaveProgress(85, "Saving product details to database...");

    let savedProductRef = null;
    if (isEditing) {
      const prevProduct = allProducts.find((p) => p.id === currentEditId);
      savedProductRef = doc(db, "products", currentEditId);
      await updateDoc(savedProductRef, productData);
      await recordAuditLog({
        action: "PRODUCT_UPDATED",
        targetType: "product",
        targetId: currentEditId,
        description: `Updated product "${productData.name}" (Stock: ${stock}, Price: ₱${productData.price.toLocaleString()}, Pre-Order: ${allowPreorder ? "Allowed" : "Disabled"})`,
        diff: {
          before: prevProduct
            ? {
                name: prevProduct.name,
                price: prevProduct.price,
                stock: prevProduct.stock,
                category: prevProduct.category,
                allowPreorder: prevProduct.allowPreorder,
              }
            : {},
          after: {
            name: productData.name,
            price: productData.price,
            stock: productData.stock,
            category: productData.category,
            allowPreorder: productData.allowPreorder,
          },
        },
        performedBy: currentUser,
      });
    } else {
      savedProductRef = await addDoc(productsCollection, productData);
      await recordAuditLog({
        action: "PRODUCT_CREATED",
        targetType: "product",
        targetId: savedProductRef.id,
        description: `Created product "${productData.name}" (Stock: ${stock}, Price: ₱${productData.price.toLocaleString()}, Pre-Order: ${allowPreorder ? "Allowed" : "Disabled"})`,
        diff: {
          before: {},
          after: {
            name: productData.name,
            price: productData.price,
            stock: productData.stock,
            category: productData.category,
            allowPreorder: productData.allowPreorder,
          },
        },
        performedBy: currentUser,
      });
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
    showToast("Failed to save product: " + (e?.message || "An error occurred."), "error");
  } finally {
    isSavingProduct = false;
    submitBtn.textContent = isEditing ? "Update Product" : "Save Product";
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    closeModalBtn.disabled = false;
    hideSaveProgress();
  }
});

// Delete Product (Soft Delete & Immutable Audit Log)
window.deleteProduct = async (id) => {
  const currentProd = allProducts.find((p) => p.id === id);
  const prodName = currentProd ? currentProd.name : id;

  const confirmed = await showAdminConfirmModal({
    title: "Delete Product",
    message: `Are you sure you want to delete <strong>${escapeHtml(prodName)}</strong>? This will remove it from the catalog.`,
    confirmText: "Yes, Delete Product",
    cancelText: "Cancel",
    confirmType: "danger",
    icon: "delete",
  });
  if (!confirmed) return;

  try {
    await updateDoc(doc(db, "products", id), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: currentUser?.uid || "admin",
      deletedByName: currentUser?.displayName || "Admin Staff",
      action: "delete",
      updatedAt: serverTimestamp(),
    });

    await recordAuditLog({
      action: "PRODUCT_DELETED",
      targetType: "product",
      targetId: id,
      description: `Soft-deleted product "${prodName}" (${id})`,
      diff: {
        before: currentProd
          ? {
              name: currentProd.name,
              price: currentProd.price,
              stock: currentProd.stock,
              isDeleted: false,
            }
          : { isDeleted: false },
        after: {
          name: prodName,
          isDeleted: true,
          deletedBy: currentUser?.uid || "admin",
        },
      },
      performedBy: currentUser,
    });

    allProducts = allProducts.filter((p) => p.id !== id);
    applyCategoryFilter();
    updateStats(allProducts);
    showAdminToast(`Product "${prodName}" deleted.`, "success");
  } catch (error) {
    console.error("Error deleting product: ", error);
    showAdminToast(error.message || "Could not delete product.", "error");
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
    viewerStatus.style.visibility = "visible";
    setViewerLoading(true, "Calibrating 3D object...");
    await attachModelToViewer(modelViewer, targetUrl, {
      onProgress: (pct) => {
        if (viewerStatus) {
          viewerStatus.style.visibility = "visible";
          viewerStatus.textContent = pct >= 100 ? "Rendering 3D Model..." : `Downloading 3D Model... ${pct}%`;
        }
      }
    });
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
      const usdzUrl = productData.usdzUrl || "";

      viewerStatus.style.visibility = "visible";
      viewerStatus.textContent = "Loading 3D model...";
      setViewerLoading(true, "Calibrating 3D object...");

      await attachModelToViewer(modelViewer, targetUrl, {
        usdzUrl,
        onProgress: (pct) => {
          if (viewerStatus) {
            viewerStatus.style.visibility = "visible";
            viewerStatus.textContent = pct >= 100 ? "Rendering 3D Model..." : `Downloading 3D Model... ${pct}%`;
          }
        }
      });

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

// Dynamic Bed Sizes Repeater State & Logic (Bed Category)
const DEFAULT_BED_SIZES = getDefaultBedSizes("in");
let currentBedSizesList = [];

function clearBedSizesRepeater() {
  currentBedSizesList = [];
  renderBedSizesRepeater();
}

function updateBedSizesVisibility(category) {
  const container = document.getElementById("bed-sizes-repeater-container");
  if (!container) return;
  const isBed = (category || "").toLowerCase().includes("bed");
  if (isBed) {
    container.style.display = "block";
    const currentUnit = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
    document.querySelectorAll(".bed-size-unit-indicator").forEach((el) => {
      el.textContent = currentUnit;
    });
    if (currentBedSizesList.length === 0) {
      currentBedSizesList = getDefaultBedSizes(currentUnit);
      renderBedSizesRepeater();
    }
  } else {
    container.style.display = "none";
  }
}

function renderBedSizesRepeater() {
  const container = document.getElementById("bed-sizes-repeater-list");
  if (!container) return;

  if (currentBedSizesList.length === 0) {
    container.innerHTML = `<p style="font-size: 0.78rem; color: #9ca3af; margin: 4px 0; font-style: italic;">No bed sizes configured. Click "Add Bed Size" or "Reset Defaults".</p>`;
    return;
  }

  const currentUnit = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";

  container.innerHTML = currentBedSizesList
    .map((size, index) => {
      let w = size.width;
      let l = size.length;
      if ((w == null || w === "") && size.dimensions) {
        const parsed = parseDimensionsToWidthLength(size.dimensions);
        w = parsed.width;
        l = parsed.length;
      }
      return `
    <div class="bed-size-repeater-row" data-index="${index}">
      <div class="bed-size-field-group bed-size-name-col">
        <label class="bed-size-field-sublabel">Size Name</label>
        <input type="text" class="bed-size-input-name" placeholder="Size Name (e.g. Queen)" value="${escapeHtml(size.name || "")}" />
      </div>

      <div class="bed-size-field-group bed-size-width-col">
        <label class="bed-size-field-sublabel">Width (<span class="bed-size-unit-indicator">${escapeHtml(currentUnit)}</span>)</label>
        <input type="number" class="bed-size-input-width" placeholder="Width" min="0.01" step="any" value="${w != null ? w : ""}" />
      </div>

      <div class="bed-size-field-group bed-size-length-col">
        <label class="bed-size-field-sublabel">Length (<span class="bed-size-unit-indicator">${escapeHtml(currentUnit)}</span>)</label>
        <input type="number" class="bed-size-input-length" placeholder="Length" min="0.01" step="any" value="${l != null ? l : ""}" />
      </div>

      <div class="bed-size-field-group bed-size-price-col">
        <label class="bed-size-field-sublabel">Price Delta</label>
        <div class="bed-size-price-input-wrapper">
          <span class="bed-size-price-prefix">+₱</span>
          <input type="number" class="bed-size-input-price" placeholder="Delta Price" min="0" step="any" value="${size.priceDelta != null ? size.priceDelta : 0}" style="border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; padding: 0 4px !important; margin: 0 !important; border-radius: 0 !important; width: 100% !important; height: 100% !important; min-width: 0 !important;" />
        </div>
      </div>

      <div class="bed-size-delete-col">
        <button type="button" class="btn-remove-bed-size-row" data-index="${index}" title="Remove Bed Size">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    </div>
  `;
    })
    .join("");

  container.querySelectorAll(".bed-size-repeater-row").forEach((row) => {
    const idx = parseInt(row.dataset.index, 10);
    const nameInp = row.querySelector(".bed-size-input-name");
    const widthInp = row.querySelector(".bed-size-input-width");
    const lengthInp = row.querySelector(".bed-size-input-length");
    const priceInp = row.querySelector(".bed-size-input-price");
    const removeBtn = row.querySelector(".btn-remove-bed-size-row");

    if (nameInp) {
      nameInp.addEventListener("input", (e) => {
        if (currentBedSizesList[idx]) currentBedSizesList[idx].name = e.target.value;
        if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
      });
    }

    if (widthInp) {
      widthInp.addEventListener("input", (e) => {
        if (currentBedSizesList[idx]) {
          const val = parseFloat(e.target.value);
          currentBedSizesList[idx].width = !isNaN(val) ? val : e.target.value;
          const u = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
          if (!isNaN(val) && val > 0 && UNIT_TO_CM[u]) {
            currentBedSizesList[idx].widthCm = val * UNIT_TO_CM[u];
          } else {
            delete currentBedSizesList[idx].widthCm;
          }
          const w = currentBedSizesList[idx].width;
          const l = currentBedSizesList[idx].length;
          if (w && l) {
            currentBedSizesList[idx].dimensions = `${w} × ${l} ${u}`;
          }
          if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
        }
      });
    }

    if (lengthInp) {
      lengthInp.addEventListener("input", (e) => {
        if (currentBedSizesList[idx]) {
          const val = parseFloat(e.target.value);
          currentBedSizesList[idx].length = !isNaN(val) ? val : e.target.value;
          const u = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
          if (!isNaN(val) && val > 0 && UNIT_TO_CM[u]) {
            currentBedSizesList[idx].lengthCm = val * UNIT_TO_CM[u];
          } else {
            delete currentBedSizesList[idx].lengthCm;
          }
          const w = currentBedSizesList[idx].width;
          const l = currentBedSizesList[idx].length;
          if (w && l) {
            currentBedSizesList[idx].dimensions = `${w} × ${l} ${u}`;
          }
          if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
        }
      });
    }

    if (priceInp) {
      priceInp.addEventListener("input", (e) => {
        if (currentBedSizesList[idx]) {
          currentBedSizesList[idx].priceDelta = parseFloat(e.target.value) || 0;
          if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        currentBedSizesList.splice(idx, 1);
        renderBedSizesRepeater();
        if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
      });
    }
  });
}

function setupBedSizesRepeaterUI() {
  document.addEventListener("click", (e) => {
    const addBtn = e.target && e.target.closest ? e.target.closest("#btn-add-bed-size-row") : null;
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      currentBedSizesList.push({
        name: "",
        width: "",
        length: "",
        dimensions: "",
        priceDelta: 0,
      });
      renderBedSizesRepeater();
      if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
    }

    const resetBtn = e.target && e.target.closest ? e.target.closest("#btn-reset-default-bed-sizes") : null;
    if (resetBtn) {
      e.preventDefault();
      e.stopPropagation();
      const currentUnit = document.getElementById("product-unit")?.value || currentDimensionUnit || "in";
      currentBedSizesList = getDefaultBedSizes(currentUnit);
      renderBedSizesRepeater();
      if (typeof triggerDraftAutosave === "function") triggerDraftAutosave();
    }
  });

  const catSelect = document.getElementById("product-category");
  if (catSelect) {
    catSelect.addEventListener("change", (e) => {
      updateBedSizesVisibility(e.target.value);
    });
  }
}

// Add-ons / Optional Upgrades Repeater State & Logic
let currentAddonsList = [];

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
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
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
    let product = null;
    if (productJsonBase64) {
      try {
        product = JSON.parse(decodeURIComponent(atob(productJsonBase64)));
      } catch (err) {
        console.warn("Could not decode base64 product, searching in memory:", err);
      }
    }
    if (!product && Array.isArray(allProducts)) {
      product = allProducts.find((p) => String(p.id) === String(id));
    }
    if (!product) {
      console.error("Product not found for editing id:", id);
      if (typeof showToast === "function") showToast("Unable to find product details to edit.", "error");
      return;
    }
    document.getElementById("product-name").value = product.name || "";
    document.getElementById("product-description").value = product.description || "";
    ensureCategoryOption(product.category);
    document.getElementById("product-category").value = product.category || "";
    renderCategoryDropdowns(product.category);
    document.getElementById("product-price").value = formatPriceWithCommas(product.price);
    document.getElementById("product-stock").value = product.stock || 0;

    if (document.getElementById("product-allow-preorder")) {
      document.getElementById("product-allow-preorder").checked = product.allowPreorder !== false && product.isMadeToOrder !== false;
    }
    if (document.getElementById("product-lead-time")) {
      document.getElementById("product-lead-time").value = product.leadTime || product.estimated_lead_time || "14-21 Business Days";
    }

    // Colors tags
    clearColorTags();
    if (Array.isArray(product.colors) && product.colors.length > 0) {
      product.colors.forEach((c) => addColorTag(c));
    } else if (product.color) {
      product.color.split(",").forEach((c) => addColorTag(c));
    } else if (product.fabricColor) {
      product.fabricColor.split(",").forEach((c) => addColorTag(c));
    }

    // Freebies tags
    clearFreebieTags();
    if (Array.isArray(product.freebies) && product.freebies.length > 0) {
      product.freebies.forEach((f) => addFreebieTag(f));
    } else if (product.freebiesList && Array.isArray(product.freebiesList)) {
      product.freebiesList.forEach((f) => addFreebieTag(f));
    } else if (typeof product.freebies === "string" && product.freebies.trim()) {
      product.freebies.split(/[\n,]+/).forEach((f) => addFreebieTag(f));
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
    if (heightInput) { heightInput.value = height; setCanonicalCm(heightInput, height, unit); }
    if (widthInput) { widthInput.value = width; setCanonicalCm(widthInput, width, unit); }
    if (lengthInput) { lengthInput.value = length; setCanonicalCm(lengthInput, length, unit); }
    if (length2Input) { length2Input.value = length2; setCanonicalCm(length2Input, length2, unit); }
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

    // Bed Sizes Repeater
    currentBedSizesList = [];
    if (Array.isArray(product.bedSizes) && product.bedSizes.length > 0) {
      currentBedSizesList = product.bedSizes.map((s) => {
        let w = s.width;
        let l = s.length;
        if ((w == null || w === "") && s.dimensions) {
          const parsed = parseDimensionsToWidthLength(s.dimensions);
          w = parsed.width;
          l = parsed.length;
        }
        const wNum = parseFloat(w);
        const lNum = parseFloat(l);
        const wCm = s.widthCm != null ? s.widthCm : (!isNaN(wNum) && wNum > 0 && UNIT_TO_CM[unit] ? wNum * UNIT_TO_CM[unit] : null);
        const lCm = s.lengthCm != null ? s.lengthCm : (!isNaN(lNum) && lNum > 0 && UNIT_TO_CM[unit] ? lNum * UNIT_TO_CM[unit] : null);
        return {
          name: s.name || "",
          width: w != null ? w : "",
          length: l != null ? l : "",
          widthCm: wCm,
          lengthCm: lCm,
          dimensions: s.dimensions || (w && l ? `${w} × ${l} ${unit}` : ""),
          priceDelta: s.priceDelta != null ? s.priceDelta : 0,
        };
      });
    } else if ((product.category || "").toLowerCase().includes("bed")) {
      currentBedSizesList = getDefaultBedSizes(unit);
    }
    renderBedSizesRepeater();
    updateBedSizesVisibility(product.category);

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
      color: product.color || "",
      colors: [...currentColorsList],
      freebies: [...currentFreebiesList],
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

function formatProductDate(createdAt) {
  if (!createdAt) return "—";
  let d = createdAt;
  if (typeof createdAt === "object" && createdAt.seconds) {
    d = new Date(createdAt.seconds * 1000);
  } else if (typeof createdAt === "string" || typeof createdAt === "number") {
    d = new Date(createdAt);
  }
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

function formatMaterialsListHtml(materialRaw) {
  if (!materialRaw) return '<span style="color:#9ca3af; font-size: 0.82rem;">—</span>';
  let items = [];
  if (Array.isArray(materialRaw)) {
    items = materialRaw.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof materialRaw === "string") {
    items = materialRaw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (items.length === 0) return '<span style="color:#9ca3af; font-size: 0.82rem;">—</span>';

  const firstItem = items[0];
  const remainingCount = items.length - 1;
  const jsonEncoded = escapeHtml(JSON.stringify(items));

  if (items.length === 1) {
    return `
      <div class="materials-cell-compact">
        <span class="material-pill-single" title="${escapeHtml(firstItem)}">
          <svg viewBox="0 0 24 24" class="material-pill-icon" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span class="material-pill-label">${escapeHtml(firstItem)}</span>
        </span>
      </div>
    `;
  }

  return `
    <div class="materials-cell-compact">
      <span class="material-pill-single" title="${escapeHtml(firstItem)}">
        <svg viewBox="0 0 24 24" class="material-pill-icon" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="material-pill-label">${escapeHtml(firstItem)}</span>
      </span>
      <button type="button" class="material-more-badge" data-materials='${jsonEncoded}' title="View all ${items.length} materials">
        +${remainingCount} more
      </button>
    </div>
  `;
}

// Enterprise Materials Floating Popover Manager
let activeMaterialsPopover = null;
let popoverHideTimeout = null;

function createMaterialsPopover(triggerEl, items) {
  closeMaterialsPopover();

  const popover = document.createElement("div");
  popover.className = "materials-floating-popover";
  popover.innerHTML = `
    <div class="popover-header">
      <div class="popover-title-row">
        <span class="popover-title">Materials &amp; Specs</span>
        <span class="popover-count-badge">${items.length} specifications</span>
      </div>
    </div>
    <div class="popover-body">
      ${items
        .map(
          (item) => `
        <div class="popover-item">
          <svg viewBox="0 0 24 24" class="popover-check-icon" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span class="popover-item-text">${escapeHtml(item)}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  document.body.appendChild(popover);
  activeMaterialsPopover = popover;

  const rect = triggerEl.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();

  let top = rect.bottom + 6;
  if (top + popoverRect.height > window.innerHeight - 10) {
    top = Math.max(10, rect.top - popoverRect.height - 6);
  }

  let left = rect.left;
  if (left + popoverRect.width > window.innerWidth - 16) {
    left = window.innerWidth - popoverRect.width - 16;
  }
  if (left < 16) left = 16;

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  requestAnimationFrame(() => {
    popover.classList.add("visible");
  });

  popover.addEventListener("mouseenter", () => {
    if (popoverHideTimeout) {
      clearTimeout(popoverHideTimeout);
      popoverHideTimeout = null;
    }
  });

  popover.addEventListener("mouseleave", () => {
    closeMaterialsPopover();
  });
}

function closeMaterialsPopover() {
  if (popoverHideTimeout) {
    clearTimeout(popoverHideTimeout);
    popoverHideTimeout = null;
  }
  if (activeMaterialsPopover) {
    activeMaterialsPopover.remove();
    activeMaterialsPopover = null;
  }
}

if (typeof window !== "undefined" && !window.__materialsPopoverInitialized) {
  window.__materialsPopoverInitialized = true;

  document.addEventListener(
    "mouseenter",
    (e) => {
      const trigger = e.target && e.target.closest ? e.target.closest(".material-more-badge") : null;
      if (trigger) {
        if (popoverHideTimeout) clearTimeout(popoverHideTimeout);
        try {
          const items = JSON.parse(trigger.getAttribute("data-materials") || "[]");
          if (Array.isArray(items) && items.length > 0) {
            createMaterialsPopover(trigger, items);
          }
        } catch (err) {}
      }
    },
    true
  );

  document.addEventListener(
    "mouseleave",
    (e) => {
      const trigger = e.target && e.target.closest ? e.target.closest(".material-more-badge") : null;
      if (trigger) {
        popoverHideTimeout = setTimeout(() => {
          closeMaterialsPopover();
        }, 220);
      }
    },
    true
  );

  document.addEventListener("click", (e) => {
    const trigger = e.target && e.target.closest ? e.target.closest(".material-more-badge") : null;
    if (trigger) {
      e.stopPropagation();
      if (activeMaterialsPopover) {
        closeMaterialsPopover();
      } else {
        try {
          const items = JSON.parse(trigger.getAttribute("data-materials") || "[]");
          if (Array.isArray(items) && items.length > 0) {
            createMaterialsPopover(trigger, items);
          }
        } catch (err) {}
      }
      return;
    }

    if (activeMaterialsPopover && !e.target.closest(".materials-floating-popover")) {
      closeMaterialsPopover();
    }
  });

  window.addEventListener("scroll", () => closeMaterialsPopover(), { passive: true });
}

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
              <td>${formatMaterialsListHtml(product.materials || product.material)}</td>
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
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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
        statusLabel = "Deposit Verified";
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
let dashOrdersSearchQuery = "";
let adminTransCurrentPage = 1;
let adminTransPerPage = 10;
let adminTransSearchQuery = "";
let adminTransTypeFilter = "all";
let adminTransMethodFilter = "all";
let activeReceiptOrder = null;
let activeReceiptTab = "voucher";
let activeReceiptBranch = "calamba";

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

const ORDERS_COLLECTION = collection(db, "orders");

async function getUserRole(user) {
  if (!user) return null;

  // 1. Instant check from session storage to avoid desktop-mode reload stalling
  const cachedRole = sessionStorage.getItem("lanica_admin_role");
  if (cachedRole === "admin") {
    // Validate in background without stalling render
    setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const freshRole = (snap.data().role || "").toLowerCase();
          if (freshRole !== "admin") {
            sessionStorage.removeItem("lanica_admin_role");
            window.location.replace("/login.html");
          }
        }
      } catch (_) {}
    }, 200);
    return "admin";
  }

  try {
    const roleByUid = await Promise.race([
      getDoc(doc(db, "users", user.uid)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Role fetch timeout")), 3500)),
    ]);
    if (roleByUid.exists()) {
      const role = (roleByUid.data().role || "").toLowerCase();
      console.log("Admin page - Role found by UID:", role);
      if (role === "admin") sessionStorage.setItem("lanica_admin_role", "admin");
      return role;
    }
  } catch (e) {
    console.warn("Admin page - Could not read user role by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await Promise.race([
      getDocs(q),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Email role fetch timeout")), 3500)),
    ]);
    if (!snap.empty) {
      const role = ((snap.docs[0].data() || {}).role || "").toLowerCase();
      console.log("Admin page - Role found by email:", role);
      if (role === "admin") sessionStorage.setItem("lanica_admin_role", "admin");
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
    if (typeof v === "object") continue;
    const s = String(v).trim();
    if (s && s !== "[object Object]") return s;
  }
  return "";
}

function formatOrderDeliveryAddress(order) {
  if (!order) return "No delivery address recorded";

  const isPickup =
    order.fulfillmentType === "pickup" ||
    order.address?.pickupAtWorkshop ||
    order.shippingAddress?.pickupAtWorkshop;
  if (isPickup) return "Lanica Workshop (Store Pickup)";

  const sources = [
    order.shippingAddress,
    order.deliveryAddress,
    order.address,
    order.customerAddress,
  ];

  for (const src of sources) {
    if (!src) continue;
    if (typeof src === "string") {
      const trimmed = src.trim();
      if (trimmed && trimmed !== "[object Object]") return trimmed;
    } else if (typeof src === "object") {
      if (
        typeof src.fullAddress === "string" &&
        src.fullAddress.trim() &&
        src.fullAddress.trim() !== "[object Object]"
      ) {
        return src.fullAddress.trim();
      }
      if (
        typeof src.address === "string" &&
        src.address.trim() &&
        src.address.trim() !== "[object Object]"
      ) {
        return src.address.trim();
      }
      const street =
        typeof src.streetAddress === "string"
          ? src.streetAddress.trim()
          : typeof src.street === "string"
          ? src.street.trim()
          : "";
      const city = typeof src.city === "string" ? src.city.trim() : "";
      const province = typeof src.province === "string" ? src.province.trim() : "";
      const postal =
        typeof src.postalCode === "string"
          ? src.postalCode.trim()
          : typeof src.postal === "string"
          ? src.postal.trim()
          : "";

      const parts = [street, city, province, postal].filter(
        (p) => p && p !== "[object Object]"
      );
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }

  if (
    typeof order.fullAddress === "string" &&
    order.fullAddress.trim() &&
    order.fullAddress.trim() !== "[object Object]"
  ) {
    return order.fullAddress.trim();
  }

  return "No delivery address recorded";
}

function formatOrderLandmark(order) {
  if (!order) return "";
  const sources = [
    order.shippingAddress,
    order.deliveryAddress,
    order.address,
  ];
  for (const src of sources) {
    if (src && typeof src === "object") {
      const lm = src.nearestLandmark || src.landmark;
      if (typeof lm === "string" && lm.trim() && lm.trim() !== "[object Object]") {
        return lm.trim();
      }
    }
  }
  if (
    typeof order.nearestLandmark === "string" &&
    order.nearestLandmark.trim() &&
    order.nearestLandmark.trim() !== "[object Object]"
  ) {
    return order.nearestLandmark.trim();
  }
  if (
    typeof order.landmark === "string" &&
    order.landmark.trim() &&
    order.landmark.trim() !== "[object Object]"
  ) {
    return order.landmark.trim();
  }
  return "";
}

function formatOrderRecipientPhone(order) {
  if (!order) return "—";
  const sources = [
    order.shippingAddress,
    order.deliveryAddress,
    order.address,
  ];
  for (const src of sources) {
    if (src && typeof src === "object") {
      const p = src.phoneNumber || src.phone;
      if (typeof p === "string" && p.trim() && p.trim() !== "[object Object]") {
        return p.trim();
      }
    }
  }
  if (
    typeof order.phone === "string" &&
    order.phone.trim() &&
    order.phone.trim() !== "[object Object]"
  ) {
    return order.phone.trim();
  }
  if (
    typeof order.phoneNumber === "string" &&
    order.phoneNumber.trim() &&
    order.phoneNumber.trim() !== "[object Object]"
  ) {
    return order.phoneNumber.trim();
  }
  return "—";
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
  if (s === "slot reserved" || s === "slot_reserved") return "slot reserved";
  if (s === "pending" || s === "order placed" || s === "placed") return "placed";
  if (s === "accepted" || s === "confirmed" || s === "deposit confirmed" || s === "deposit verified" || s === "downpayment confirmed") return "downpayment confirmed";
  if (s === "processing" || s === "packed" || s === "crafting" || s === "fabrication" || s === "in production") return "in production";
  if (s === "inspected" || s === "qc passed" || s === "quality check" || s === "quality checked") return "quality checked";
  if (s === "dispatched" || s === "out for delivery" || s === "shipped" || s === "shipping" || s === "in transit") return "shipped";
  if (s === "completed" || s === "order completed") return "completed";
  if (s === "received" || s === "arrived" || s === "delivered") return "delivered";
  if (s === "declined") return "declined";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "placed";
}

function getOrderCanonicalStatus(order) {
  if (!order) return "Placed";
  const rawStatus = order.status;
  const rawOrderStatus = order.orderStatus;

  const normStatus = rawStatus ? normalizeOrderStatus(rawStatus) : null;
  const normOrderStatus = rawOrderStatus ? normalizeOrderStatus(rawOrderStatus) : null;

  let chosen = "placed";
  if (normStatus && normStatus !== "placed") chosen = normStatus;
  else if (normOrderStatus && normOrderStatus !== "placed") chosen = normOrderStatus;
  else chosen = normStatus || normOrderStatus || "placed";

  if (chosen === "downpayment confirmed" || chosen === "accepted") {
    return "Deposit Verified";
  }

  return chosen
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatOrderDate(val) {
  if (!val) return "—";
  let d = null;
  if (val.toDate && typeof val.toDate === "function") d = val.toDate();
  else if (val.seconds) d = new Date(val.seconds * 1000);
  else d = new Date(val);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseItemPrice(val) {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function showAdminToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("admin-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "admin-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `admin-toast-card ${type}`;

  const iconMap = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    danger: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  };
  const icon = iconMap[type] || iconMap.info;

  toast.innerHTML = `
    <span style="display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon}</span>
    <div class="admin-toast-content">${escapeHtml(message)}</div>
    <button type="button" class="admin-toast-close" aria-label="Close">&times;</button>
  `;

  const closeBtn = toast.querySelector(".admin-toast-close");
  const dismiss = () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 200);
  };

  if (closeBtn) closeBtn.addEventListener("click", dismiss);
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }
}

function getAdminConfirmIconSvg(icon, confirmType) {
  if (typeof icon === "string" && icon.trim().startsWith("<svg")) {
    return icon;
  }
  const cleanKey = typeof icon === "string" ? icon.trim().toLowerCase() : "";
  if (cleanKey === "delete" || cleanKey === "trash" || cleanKey === "trash-2" || cleanKey === "🗑️") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
  }
  if (cleanKey === "✓" || cleanKey === "check" || cleanKey === "success") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  }
  if (cleanKey === "✕" || cleanKey === "x" || cleanKey === "cancel" || cleanKey === "close") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  }
  if (cleanKey === "💰" || cleanKey === "💵" || cleanKey === "cash" || cleanKey === "payment") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>`;
  }
  if (cleanKey === "warning" || cleanKey === "⚠️") {
    return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  }
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
}

function showAdminConfirmModal({
  title = "Confirmation",
  message = "Are you sure you want to proceed?",
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmType = "primary",
  icon = "info",
}) {
  const renderedIcon = getAdminConfirmIconSvg(icon, confirmType);
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";

    overlay.innerHTML = `
      <div class="admin-confirm-card" role="dialog" aria-modal="true">
        <div class="admin-confirm-header">
          <div class="admin-confirm-icon-box ${confirmType}">
            ${renderedIcon}
          </div>
          <div style="flex: 1;">
            <h3 class="admin-confirm-title">${escapeHtml(title)}</h3>
            <div class="admin-confirm-message">${message}</div>
          </div>
        </div>
        <div class="admin-confirm-actions">
          <button type="button" class="admin-btn-modal-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="admin-btn-modal-confirm ${confirmType}">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    let cleanedUp = false;
    const cleanup = (result) => {
      if (cleanedUp) return;
      cleanedUp = true;
      overlay.style.opacity = "0";
      setTimeout(() => {
        if (overlay.parentElement) overlay.remove();
      }, 160);
      resolve(result);
    };

    const cancelBtn = overlay.querySelector(".admin-btn-modal-cancel");
    const confirmBtn = overlay.querySelector(".admin-btn-modal-confirm");

    if (cancelBtn) cancelBtn.addEventListener("click", () => cleanup(false));
    if (confirmBtn) confirmBtn.addEventListener("click", () => cleanup(true));

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });

    const onKey = (e) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", onKey);
        cleanup(false);
      }
    };
    document.addEventListener("keydown", onKey);

    document.body.appendChild(overlay);
  });
}

function normalizeOrderAction(raw) {
  if (raw == null) return "";
  return String(raw).toLowerCase().trim();
}

function isOrderCompleted(order) {
  if (!order) return false;
  const status = normalizeOrderStatus(order.status);
  const orderStatus = normalizeOrderStatus(order.orderStatus);
  const rawStatus = String(order.status || "").toLowerCase().trim();
  const rawOrderStatus = String(order.orderStatus || "").toLowerCase().trim();
  return (
    status === "completed" ||
    orderStatus === "completed" ||
    rawStatus === "completed" ||
    rawOrderStatus === "completed" ||
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
    showToast("No inventory data available to export.", "info");
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
  const greetingEl = document.getElementById("dash-greeting-time");
  if (greetingEl) {
    const now = new Date();
    const hour = now.getHours();
    const timeGreeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const dateFormatted = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    greetingEl.textContent = `${timeGreeting}, Administrator • ${dateFormatted} • Real-time Made-to-Order fulfillment & operational metrics.`;
  }

  const totalProducts = products ? products.length : 0;
  const activeOrders = orders ? orders.filter((o) => normalizeOrderAction(o.action) !== "delete") : [];
  const lowStockProducts = products ? products.filter((p) => Number(p.stock) <= 3) : [];

  let placedCount = 0;
  let downpaymentCount = 0;
  let productionCount = 0;
  let qcCount = 0;
  let shippedCount = 0;
  let deliveredCount = 0;
  let totalRevenue = 0;
  let totalCollected = 0;

  activeOrders.forEach((o) => {
    const st = normalizeOrderStatus(o.status);
    const isCompleted = isOrderCompleted(o) || st === "completed";

    if (isCompleted) {
      deliveredCount++;
    } else if (st === "placed" || st === "pending") placedCount++;
    else if (st === "downpayment confirmed" || st === "slot reserved") downpaymentCount++;
    else if (st === "in production" || st === "crafting") productionCount++;
    else if (st === "quality checked") qcCount++;
    else if (st === "shipped") shippedCount++;
    else if (st === "delivered") deliveredCount++;

    if (st !== "cancelled" && st !== "declined") {
      const totalVal = Number(o.total != null ? o.total : o.totalAmount) || 0;
      totalRevenue += totalVal;

      const isDown = o.paymentOption === "downpayment" || Number(o.downpaymentAmount) > 0;
      const isAwaitingCounter = o.paymentStatus === "awaiting_counter_downpayment";
      const paidVal = isAwaitingCounter
        ? Number(o.downpaymentPaid || 0)
        : Number(o.downpaymentAmount ?? (isDown ? Math.round(totalVal * 0.3) : totalVal));
      const balanceDue = Number(o.remainingBalance ?? o.balanceDue ?? (isDown ? Math.max(0, totalVal - paidVal) : 0));
      const isSettled = isCompleted || o.balanceStatus === "settled" || balanceDue <= 0;
      totalCollected += isSettled ? totalVal : paidVal;
    }
  });

  const pendingCount = placedCount + downpaymentCount;
  const workshopQueueCount = placedCount + downpaymentCount + productionCount + qcCount;
  const fulfilledCount = shippedCount + deliveredCount;
  const totalBalance = Math.max(0, totalRevenue - totalCollected);

  if (dashTotalRevenueEl) {
    dashTotalRevenueEl.textContent =
      "₱" + totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const revCollectedEl = document.getElementById("dash-revenue-collected");
  if (revCollectedEl) {
    revCollectedEl.innerHTML = `
      <span class="kpi-pill kpi-pill-collected"><span class="kpi-pill-icon">✓</span> Collected: ₱${totalCollected.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      <span class="kpi-pill kpi-pill-balance"><span class="kpi-pill-icon">⚠</span> Unpaid Balance: ₱${totalBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
    `;
  }

  if (dashPendingOrdersEl) dashPendingOrdersEl.textContent = String(pendingCount);
  if (dashLowStockEl) dashLowStockEl.textContent = String(workshopQueueCount);

  const fulfilledEl = document.getElementById("dash-fulfilled-orders");
  if (fulfilledEl) fulfilledEl.textContent = String(fulfilledCount);

  if (dashTotalProductsEl) dashTotalProductsEl.textContent = String(totalProducts);

  const lowStockSubEl = document.getElementById("dash-low-stock-sub");
  if (lowStockSubEl) {
    lowStockSubEl.textContent = "Made-to-order catalog";
    lowStockSubEl.style.color = "#64748b";
    lowStockSubEl.style.fontWeight = "500";
  }

  // Update Production Lifecycle Pipeline Badges
  const pipePlaced = document.getElementById("pipe-count-placed");
  const pipeDp = document.getElementById("pipe-count-downpayment");
  const pipeProd = document.getElementById("pipe-count-production");
  const pipeQc = document.getElementById("pipe-count-qc");
  const pipeShip = document.getElementById("pipe-count-shipped");
  const pipeDeliv = document.getElementById("pipe-count-delivered");
  if (pipePlaced) pipePlaced.textContent = String(placedCount);
  if (pipeDp) pipeDp.textContent = String(downpaymentCount);
  if (pipeProd) pipeProd.textContent = String(productionCount);
  if (pipeQc) pipeQc.textContent = String(qcCount);
  if (pipeShip) pipeShip.textContent = String(shippedCount);
  if (pipeDeliv) pipeDeliv.textContent = String(deliveredCount);


  // Ensure interactive listeners are wired
  initDashboardInteractiveListeners();

  // Render recent orders (all active orders passed so pagination and search work properly!)
  renderDashboardRecentOrders(activeOrders);
}

function renderDashboardRecentOrders(orders) {
  if (!dashRecentOrdersListEl) return;
  dashRecentOrdersListEl.innerHTML = "";

  const allActive = orders || [];
  let filtered = allActive;
  if (dashOrdersSearchQuery && dashOrdersSearchQuery.trim()) {
    const q = dashOrdersSearchQuery.toLowerCase().trim();
    filtered = allActive.filter((o) => {
      const idMatch = (o.id || "").toLowerCase().includes(q);
      const cust = resolveCustomerDisplay(o).toLowerCase();
      const itemsSummary = formatOrderItemsSummary(o.items).toLowerCase();
      const st = normalizeOrderStatus(o.status).toLowerCase();
      return idMatch || cust.includes(q) || itemsSummary.includes(q) || st.includes(q);
    });
  }

  if (filtered.length === 0) {
    dashRecentOrdersListEl.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: #6b7280;">No orders matching current search or filter.</td></tr>`;
    renderDashRecentOrdersPagination(0, 1);
    return;
  }

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / dashRecentOrdersPerPage));
  if (dashRecentOrdersCurrentPage > totalPages) dashRecentOrdersCurrentPage = totalPages;
  if (dashRecentOrdersCurrentPage < 1) dashRecentOrdersCurrentPage = 1;

  const startIndex = (dashRecentOrdersCurrentPage - 1) * dashRecentOrdersPerPage;
  const pagedOrders = filtered.slice(startIndex, startIndex + dashRecentOrdersPerPage);

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

    const isDown = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0;
    const paidVal = Number(order.downpaymentAmount || Math.round(Number(total || 0) * 0.3));

    const tr = document.createElement("tr");
    tr.className = "dash-order-row";
    tr.innerHTML = `
      <td class="td-order-id">
        <strong class="dash-card-order-id">#${escapeHtml((order.id || "").slice(0, 8))}</strong>
        <span class="dash-card-date-badge">Date: ${escapeHtml(dateStr)}</span>
      </td>
      <td class="td-customer">
        <span class="dash-card-label">Customer</span>
        <div class="dash-card-customer-name">${escapeHtml(String(customer))}</div>
        ${order.email || order.userEmail ? `<div class="dash-card-customer-email">${escapeHtml(order.email || order.userEmail)}</div>` : ''}
      </td>
      <td class="order-items-cell td-items">
        <span class="dash-card-label">Item(s)</span>
        <div class="order-items-summary">${escapeHtml(formatOrderItemsSummary(order.items))}</div>
      </td>
      <td class="td-financial">
        <span class="dash-card-label">Financial</span>
        <div class="dash-card-financial-val">
          <strong class="dash-card-amount">${totalStr}</strong>
          ${isDown ? `<span class="dash-card-partial">Partial (₱${paidVal.toLocaleString()})</span>` : ''}
        </div>
      </td>
      <td class="td-status">
        <span class="dash-card-label">Status</span>
        <div class="dash-card-status-val">
          <span class="order-status-badge order-status-${escapeHtml(st.replace(/\s+/g, '-'))}">${escapeHtml((st === "downpayment confirmed" || st === "accepted") ? "Deposit Verified" : (st === "slot reserved" ? "Slot Reserved" : (st.charAt(0).toUpperCase() + st.slice(1))))}</span>
        </div>
      </td>
      <td class="td-date" style="font-size:0.82rem; color:#64748b;">${escapeHtml(dateStr)}</td>
      <td class="td-actions" style="text-align: center; white-space: nowrap;">
        <!-- Desktop Kebab Menu (Compact ⋮ icon for clean table view) -->
        <div class="dash-table-kebab-wrap kebab-menu-container" style="position: relative; display: inline-block;">
          <button type="button" class="kebab-trigger-btn" aria-label="Row Actions" title="Actions" style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 1.1rem; color: #334155; font-weight: bold; transition: all 0.2s;">
            ⋮
          </button>
          <div class="kebab-dropdown-menu" style="display: none; position: absolute; right: 0; top: 36px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); z-index: 1000; min-width: 195px; padding: 6px; text-align: left;">
            <button type="button" class="kebab-menu-item btn-dash-view-order" data-order-id="${escapeHtml(order.id)}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #334155; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              View Order Summary
            </button>
            <button type="button" class="kebab-menu-item btn-dash-voucher" data-order-id="${escapeHtml(order.id)}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #2563eb; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
              Payment Voucher
            </button>
            <button type="button" class="kebab-menu-item btn-dash-quotation" data-order-id="${escapeHtml(order.id)}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #0284c7; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/></svg>
              Official Quotation
            </button>
          </div>
        </div>

        <!-- Mobile Action Buttons (Displayed on mobile/cards matching iPhone SE mockup) -->
        <div class="dash-card-actions-row">
          <button type="button" class="dash-card-action-btn dash-card-btn-view btn-dash-view-order" data-order-id="${escapeHtml(order.id)}" title="View Order Details">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
            <span>View</span>
          </button>
          <button type="button" class="dash-card-action-btn dash-card-btn-voucher btn-dash-voucher" data-order-id="${escapeHtml(order.id)}" title="Download Voucher">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download Voucher</span>
          </button>
          <button type="button" class="dash-card-action-btn dash-card-btn-quotation btn-dash-quotation" data-order-id="${escapeHtml(order.id)}" title="Official Quotation">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span>Quotation</span>
          </button>
        </div>
      </td>
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

function initDashboardInteractiveListeners() {
  const listEl = document.getElementById("dash-recent-orders-list");
  if (listEl && !listEl.dataset.bound) {
    listEl.dataset.bound = "true";
    listEl.addEventListener("click", (e) => {
      const viewBtn = e.target.closest(".btn-dash-view-order");
      if (viewBtn) {
        const orderId = viewBtn.getAttribute("data-order-id");
        if (orderId && typeof showOrderSummaryModal === "function") {
          showOrderSummaryModal(orderId);
        }
        return;
      }
      const voucherBtn = e.target.closest(".btn-dash-voucher");
      if (voucherBtn) {
        const orderId = voucherBtn.getAttribute("data-order-id");
        if (orderId && typeof openLanicaReceiptModal === "function") {
          openLanicaReceiptModal(orderId, "voucher");
        }
        return;
      }
      const quotationBtn = e.target.closest(".btn-dash-quotation");
      if (quotationBtn) {
        const orderId = quotationBtn.getAttribute("data-order-id");
        if (orderId && typeof openLanicaReceiptModal === "function") {
          openLanicaReceiptModal(orderId, "quotation");
        }
        return;
      }
    });
  }

  const searchInput = document.getElementById("dash-orders-search-input");
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    let debounce = null;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        dashOrdersSearchQuery = e.target.value;
        dashRecentOrdersCurrentPage = 1;
        updateDashboardKpis(allProducts, allOrders);
      }, 200);
    });
  }

  const pipelineContainer = document.querySelector(".dashboard-pipeline-steps");
  if (pipelineContainer && !pipelineContainer.dataset.bound) {
    pipelineContainer.dataset.bound = "true";
    pipelineContainer.addEventListener("click", (e) => {
      const stepItem = e.target.closest(".pipeline-step-item");
      if (!stepItem) return;
      const stage = stepItem.getAttribute("data-stage");
      if (stage) {
        if (stage === "in production" || stage === "quality checked") {
          showAdminSection("workshop");
        } else {
          showAdminSection("orders");
          if (ordersStatusFilter) {
            ordersStatusFilter.value = stage;
            ordersFilterValue = stage;
            applyOrdersFilter();
          }
        }
      }
    });
  }

  const watchlistItemsEl = document.getElementById("dash-watchlist-items");
  if (watchlistItemsEl && !watchlistItemsEl.dataset.bound) {
    watchlistItemsEl.dataset.bound = "true";
    const onWatchlistClick = (e) => {
      const editBtn = e.target.closest(".btn-edit-watchlist");
      if (editBtn) {
        e.preventDefault();
        const pId = editBtn.getAttribute("data-product-id");
        if (pId && typeof window.editProduct === "function") {
          window.editProduct(pId);
        }
      }
    };
    watchlistItemsEl.addEventListener("click", onWatchlistClick);
    watchlistItemsEl.addEventListener("touchend", onWatchlistClick);
  }

  const btnOpenChat = document.getElementById("dash-btn-open-chat");
  const actionChats = document.getElementById("dash-action-chats");
  [btnOpenChat, actionChats].forEach((btn) => {
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "true";
      btn.addEventListener("click", () => showAdminSection("chats"));
    }
  });

  const btnViewInv = document.getElementById("dash-btn-view-inventory");
  if (btnViewInv && !btnViewInv.dataset.bound) {
    btnViewInv.dataset.bound = "true";
    btnViewInv.addEventListener("click", () => showAdminSection("inventory"));
  }

  const btnOpenTrans = document.getElementById("dash-btn-open-transactions");
  if (btnOpenTrans && !btnOpenTrans.dataset.bound) {
    btnOpenTrans.dataset.bound = "true";
    btnOpenTrans.addEventListener("click", () => showAdminSection("transactions"));
  }

  const actionWorkshop = document.getElementById("dash-action-workshop");
  const linkWorkshop = document.getElementById("dash-link-workshop-all");
  [actionWorkshop, linkWorkshop].forEach((btn) => {
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "true";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        showAdminSection("workshop");
      });
    }
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

function formatTransactionMethod(method) {
  const m = String(method || "").toLowerCase();
  if (m.includes("walk_in") || m.includes("cash") || m.includes("counter")) {
    return "Cash (Counter)";
  }
  return "QR Ph (PayMongo)";
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

function buildTransactionsLedger(orders) {
  const ledger = [];
  const list = Array.isArray(orders) ? orders : (allOrders || []);

  list.forEach((order) => {
    if (!order || order.isDeleted === true) return;

    const totalVal = Number(order.totalAmount || order.total || 0);
    const isAwaitingCounter = order.paymentStatus === "awaiting_counter_downpayment";
    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounter;
    
    // Initial Payment (30% Downpayment or Full Payment)
    const initialPaid = isAwaitingCounter
      ? Number(order.downpaymentPaid || 0)
      : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.3) : totalVal));

    let initialStatus = order.paymentStatus;
    if (!initialStatus || initialStatus === "pending") {
      initialStatus = isDownpayment
        ? (Number(order.downpaymentPaid) > 0 || order.paymentStatus === "Downpayment Confirmed" || order.paymentStatus === "downpayment_paid" ? "Deposit Verified" : "Awaiting Verification")
        : "Paid Verified";
    }

    const initialMethod = order.paymentMethod || order.paymentType || "walk_in_cash";
    const orderRef = order.orderId || order.id || "N/A";
    const customer = resolveCustomerDisplay(order);
    const initialDate = order.createdAt;

    ledger.push({
      id: order.paymentRef || order.paymentIntentId || ("TX-DP-" + String(order.id).slice(0, 8).toUpperCase()),
      orderId: order.id,
      orderRef,
      rawDate: initialDate,
      dateStr: formatOrderDate(initialDate),
      customer,
      typeLabel: isDownpayment ? "30% Downpayment" : "Full Payment",
      typeKey: isDownpayment ? "downpayment" : "full",
      amount: initialPaid,
      method: initialMethod,
      status: initialStatus,
      rawOrder: order,
      badgeColor: isDownpayment ? "#eff6ff" : "#ecfdf5",
      badgeTextColor: isDownpayment ? "#1d4ed8" : "#047857"
    });

    // Balance Settlement Payment (70% Completion)
    const remainingBalance = Number(order.remainingBalance ?? order.balanceDue ?? (isDownpayment ? Math.max(0, totalVal - initialPaid) : 0));
    const isBalanceSettled = order.balanceStatus === "settled" || order.isBalanceSettled === true || (order.status === "Delivered" && remainingBalance <= 0 && isDownpayment);

    if (isBalanceSettled && isDownpayment && totalVal > initialPaid) {
      const balanceAmount = Number(order.remainingBalanceSettled || (totalVal - initialPaid));
      const balanceDate = order.balanceSettledAt || order.deliveredAt || order.updatedAt || initialDate;
      const balanceMethod = order.balancePaymentMethod || order.paymentMethod || "walk_in_cash";

      ledger.push({
        id: order.balancePaymentRef || ("TX-BAL-" + String(order.id).slice(0, 8).toUpperCase()),
        orderId: order.id,
        orderRef,
        rawDate: balanceDate,
        dateStr: formatOrderDate(balanceDate),
        customer,
        typeLabel: "70% Balance Settlement",
        typeKey: "balance",
        amount: balanceAmount,
        method: balanceMethod,
        status: "Balance Settled",
        rawOrder: order,
        badgeColor: "#f5f3ff",
        badgeTextColor: "#6d28d9"
      });
    }

    // Refund Reversal Record (if refunded)
    const isRefunded = order.refundStatus === "completed" || order.status === "Refund Complete" || order.status === "Refunded";
    if (isRefunded) {
      const refundAmount = Number(order.refundAmount || initialPaid);
      const refundDate = order.refundCompletedAt || order.updatedAt || initialDate;

      ledger.push({
        id: ("TX-REF-" + String(order.id).slice(0, 8).toUpperCase()),
        orderId: order.id,
        orderRef,
        rawDate: refundDate,
        dateStr: formatOrderDate(refundDate),
        customer,
        typeLabel: "Refund / Reversal",
        typeKey: "refund",
        amount: -refundAmount,
        method: order.paymentMethod || "walk_in_cash",
        status: "Refund Processed",
        rawOrder: order,
        badgeColor: "#fef2f2",
        badgeTextColor: "#dc2626"
      });
    }
  });

  // Sort descending by date (newest first)
  ledger.sort((a, b) => {
    const tA = a.rawDate?.toDate?.()?.getTime?.() || (a.rawDate?.seconds ? a.rawDate.seconds * 1000 : new Date(a.rawDate || 0).getTime());
    const tB = b.rawDate?.toDate?.()?.getTime?.() || (b.rawDate?.seconds ? b.rawDate.seconds * 1000 : new Date(b.rawDate || 0).getTime());
    return tB - tA;
  });

  return ledger;
}

function updateTransactionKpis(ledger) {
  let totalCollected = 0;
  let downpaymentsTotal = 0;
  let balancesTotal = 0;

  ledger.forEach((tx) => {
    if (tx.typeKey === "downpayment") {
      downpaymentsTotal += Number(tx.amount || 0);
      totalCollected += Number(tx.amount || 0);
    } else if (tx.typeKey === "full") {
      totalCollected += Number(tx.amount || 0);
    } else if (tx.typeKey === "balance") {
      balancesTotal += Number(tx.amount || 0);
      totalCollected += Number(tx.amount || 0);
    } else if (tx.typeKey === "refund") {
      totalCollected += Number(tx.amount || 0); // negative
    }
  });

  const totalCollEl = document.getElementById("trans-stat-total-collected");
  const dpEl = document.getElementById("trans-stat-downpayments");
  const balEl = document.getElementById("trans-stat-balances");
  const countEl = document.getElementById("trans-stat-count");

  if (totalCollEl) totalCollEl.textContent = `₱${Math.max(0, totalCollected).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (dpEl) dpEl.textContent = `₱${downpaymentsTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (balEl) balEl.textContent = `₱${balancesTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (countEl) countEl.textContent = ledger.length.toLocaleString();
}

function setupAdminTransactionsControls() {
  const searchInput = document.getElementById("admin-trans-search");
  const typeFilter = document.getElementById("admin-trans-type-filter");
  const methodFilter = document.getElementById("admin-trans-method-filter");
  const refreshBtn = document.getElementById("btn-refresh-transactions");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";
    searchInput.addEventListener("input", (e) => {
      adminTransSearchQuery = e.target.value.trim().toLowerCase();
      adminTransCurrentPage = 1;
      renderAdminTransactionsList(allOrders);
    });
  }

  if (typeFilter && !typeFilter.dataset.bound) {
    typeFilter.dataset.bound = "true";
    typeFilter.addEventListener("change", (e) => {
      adminTransTypeFilter = e.target.value;
      adminTransCurrentPage = 1;
      renderAdminTransactionsList(allOrders);
    });
  }

  if (methodFilter && !methodFilter.dataset.bound) {
    methodFilter.dataset.bound = "true";
    methodFilter.addEventListener("change", (e) => {
      adminTransMethodFilter = e.target.value;
      adminTransCurrentPage = 1;
      renderAdminTransactionsList(allOrders);
    });
  }

  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "true";
    refreshBtn.addEventListener("click", () => {
      renderAdminTransactionsList(allOrders);
      showToast("Financial ledger refreshed successfully!");
    });
  }

  initLanicaReceiptModalListeners();
}

function renderAdminTransactionsList(orders) {
  setupAdminTransactionsControls();

  const tbody = document.getElementById("admin-transactions-table-body");
  const pagContainer = document.getElementById("admin-transactions-pagination-container");
  if (!tbody) return;

  const allLedger = buildTransactionsLedger(orders);
  updateTransactionKpis(allLedger);

  // Filter ledger based on user criteria
  const filteredLedger = allLedger.filter((tx) => {
    if (adminTransSearchQuery) {
      const q = adminTransSearchQuery;
      const matchId = String(tx.id || "").toLowerCase().includes(q);
      const matchRef = String(tx.orderRef || "").toLowerCase().includes(q);
      const matchCust = String(tx.customer || "").toLowerCase().includes(q);
      const matchEmail = String(tx.rawOrder?.userEmail || "").toLowerCase().includes(q);
      const matchPhone = String(formatOrderRecipientPhone(tx.rawOrder)).toLowerCase().includes(q);
      if (!matchId && !matchRef && !matchCust && !matchEmail && !matchPhone) return false;
    }

    if (adminTransTypeFilter !== "all" && tx.typeKey !== adminTransTypeFilter) {
      return false;
    }

    if (adminTransMethodFilter !== "all") {
      const m = String(tx.method || "").toLowerCase();
      if (adminTransMethodFilter === "qr" && !m.includes("qr") && !m.includes("paymongo")) return false;
      if (adminTransMethodFilter === "cash" && !m.includes("cash") && !m.includes("walk_in") && !m.includes("counter")) return false;
    }

    return true;
  });

  if (filteredLedger.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 36px; color: #9ca3af; font-size: 0.9rem;">No financial transaction records match your filter criteria.</td></tr>`;
    if (pagContainer) pagContainer.innerHTML = "";
    return;
  }

  const totalItems = filteredLedger.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminTransPerPage));
  if (adminTransCurrentPage > totalPages) adminTransCurrentPage = totalPages;
  if (adminTransCurrentPage < 1) adminTransCurrentPage = 1;

  const startIndex = (adminTransCurrentPage - 1) * adminTransPerPage;
  const pagedLedger = filteredLedger.slice(startIndex, startIndex + adminTransPerPage);

  tbody.innerHTML = "";
  pagedLedger.forEach((tx) => {
    const isNegative = tx.amount < 0;
    const absAmount = Math.abs(Number(tx.amount || 0));
    const amountFormatted = (isNegative ? "-₱" : "₱") + absAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #f1f5f9";
    tr.innerHTML = `
      <td style="padding: 14px 18px;"><strong>${escapeHtml(tx.id)}</strong></td>
      <td style="padding: 14px 18px; font-size: 0.82rem; color: #64748b;">${escapeHtml(tx.dateStr)}</td>
      <td style="padding: 14px 18px; font-weight: 600; color: #0f172a;">${escapeHtml(tx.orderRef)}</td>
      <td style="padding: 14px 18px; font-weight: 500;">${escapeHtml(tx.customer)}</td>
      <td style="padding: 14px 18px;"><span style="font-size: 0.8rem; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; font-weight: 500;">${escapeHtml(tx.typeLabel)}</span></td>
      <td style="padding: 14px 18px; font-weight: 700; color: ${isNegative ? '#dc2626' : '#059669'};">${amountFormatted}</td>
      <td style="padding: 14px 18px; font-weight: 500; color: #334155;">${escapeHtml(formatTransactionMethod(tx.method))}</td>
      <td style="padding: 14px 18px;"><span class="status-badge" style="background: ${tx.badgeColor}; color: ${tx.badgeTextColor}; font-weight: 600; padding: 4px 10px; border-radius: 20px; font-size: 0.78rem;">${escapeHtml(tx.status)}</span></td>
      <td style="padding: 14px 18px; text-align: center;">
        <button type="button" class="btn-view-lanica-receipt" data-order-id="${escapeHtml(tx.orderId)}" data-tx-type="${escapeHtml(tx.typeKey)}" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 0.78rem; font-weight: 600; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h6"/></svg>
          <span>View Receipt</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach click listener for Receipt button
  tbody.querySelectorAll(".btn-view-lanica-receipt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const orderId = btn.dataset.orderId;
      openLanicaReceiptModal(orderId, "voucher");
    });
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
        renderAdminTransactionsList(orders);
      },
      onPageSizeChange: (newSize) => {
        adminTransPerPage = newSize;
        adminTransCurrentPage = 1;
        renderAdminTransactionsList(orders);
      },
    });
  }
}

// ==========================================================================
// Official Lanica Document E-Signature & Drawing System
// ==========================================================================
let currentEsignRole = null;
let esignDrawing = false;
let esignHasDrawn = false;
let esignUploadedData = null;
let esignActiveMode = "draw";

function initLanicaEsignModalListeners() {
  const modal = document.getElementById("lanica-esign-modal");
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = "true";

  const closeBtn = document.getElementById("btn-close-esign-modal");
  const cancelBtn = document.getElementById("btn-cancel-esign");
  const applyBtn = document.getElementById("btn-apply-esign");
  const clearBtn = document.getElementById("btn-clear-esign-canvas");
  const tabDraw = document.getElementById("tab-esign-draw");
  const tabUpload = document.getElementById("tab-esign-upload");
  const panelDraw = document.getElementById("panel-esign-draw");
  const panelUpload = document.getElementById("panel-esign-upload");
  const fileInput = document.getElementById("input-esign-file");
  const canvas = document.getElementById("lanica-esign-canvas");
  const placeholder = document.getElementById("esign-placeholder-text");
  const previewContainer = document.getElementById("esign-upload-preview-container");
  const previewImg = document.getElementById("esign-upload-preview");

  const closeEsignModal = () => {
    modal.style.display = "none";
    modal.classList.remove("active");
  };

  [closeBtn, cancelBtn].forEach((btn) => {
    if (btn) {
      btn.addEventListener("click", closeEsignModal);
      btn.addEventListener("touchend", (e) => {
        e.preventDefault();
        closeEsignModal();
      });
    }
  });

  const setEsignMode = (mode) => {
    esignActiveMode = mode;
    if (mode === "draw") {
      tabDraw.style.background = "#2563eb";
      tabDraw.style.color = "#ffffff";
      tabUpload.style.background = "transparent";
      tabUpload.style.color = "#64748b";
      panelDraw.style.display = "block";
      panelUpload.style.display = "none";
    } else {
      tabUpload.style.background = "#2563eb";
      tabUpload.style.color = "#ffffff";
      tabDraw.style.background = "transparent";
      tabDraw.style.color = "#64748b";
      panelUpload.style.display = "block";
      panelDraw.style.display = "none";
    }
  };

  if (tabDraw) {
    tabDraw.addEventListener("click", () => setEsignMode("draw"));
    tabDraw.addEventListener("touchend", (e) => {
      e.preventDefault();
      setEsignMode("draw");
    });
  }
  if (tabUpload) {
    tabUpload.addEventListener("click", () => setEsignMode("upload"));
    tabUpload.addEventListener("touchend", (e) => {
      e.preventDefault();
      setEsignMode("upload");
    });
  }

  // Canvas drawing setup
  if (canvas) {
    const ctx = canvas.getContext("2d");

    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      let clientX = e.clientX;
      let clientY = e.clientY;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    };

    const startDraw = (e) => {
      if (e.cancelable) e.preventDefault();
      esignDrawing = true;
      const pos = getCoords(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000000";
      if (placeholder) placeholder.style.display = "none";
    };

    const moveDraw = (e) => {
      if (!esignDrawing) return;
      if (e.cancelable) e.preventDefault();
      const pos = getCoords(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      esignHasDrawn = true;
    };

    const stopDraw = (e) => {
      if (!esignDrawing) return;
      if (e.cancelable) e.preventDefault();
      esignDrawing = false;
    };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    canvas.addEventListener("mouseup", stopDraw);
    canvas.addEventListener("mouseleave", stopDraw);

    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", moveDraw, { passive: false });
    canvas.addEventListener("touchend", stopDraw, { passive: false });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        esignHasDrawn = false;
        if (placeholder) placeholder.style.display = "flex";
      });
    }
  }

  // File Upload Handling
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        esignUploadedData = loadEvt.target.result;
        if (previewImg) previewImg.src = esignUploadedData;
        if (previewContainer) previewContainer.style.display = "block";
      };
      reader.readAsDataURL(file);
    });
  }

  // Apply Signature Handler
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!activeReceiptOrder || !currentEsignRole) {
        closeEsignModal();
        return;
      }

      let signatureDataUrl = null;
      if (esignActiveMode === "draw") {
        if (!esignHasDrawn) {
          showToast("Please sign on the canvas before applying.", "warning");
          return;
        }
        signatureDataUrl = canvas.toDataURL("image/png");
      } else {
        if (!esignUploadedData) {
          showToast("Please select a signature image file.", "warning");
          return;
        }
        signatureDataUrl = esignUploadedData;
      }

      if (!activeReceiptOrder._voucherSignatories) {
        activeReceiptOrder._voucherSignatories = {};
      }
      if (!activeReceiptOrder._voucherSignatories.signatures) {
        activeReceiptOrder._voucherSignatories.signatures = {};
      }

      activeReceiptOrder._voucherSignatories.signatures[currentEsignRole] = signatureDataUrl;
      closeEsignModal();
      renderLanicaDocumentContent();
      showToast("E-Signature attached successfully!", "success");
    });
  }
}

function openLanicaEsignModal(role, roleTitle) {
  initLanicaEsignModalListeners();
  currentEsignRole = role;
  esignUploadedData = null;
  esignHasDrawn = false;

  const titleEl = document.getElementById("esign-modal-title");
  if (titleEl) {
    titleEl.textContent = `Attach Signature for ${roleTitle || "Signatory"}`;
  }

  const canvas = document.getElementById("lanica-esign-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  const placeholder = document.getElementById("esign-placeholder-text");
  if (placeholder) placeholder.style.display = "flex";

  const fileInput = document.getElementById("input-esign-file");
  if (fileInput) fileInput.value = "";

  const previewContainer = document.getElementById("esign-upload-preview-container");
  if (previewContainer) previewContainer.style.display = "none";

  const modal = document.getElementById("lanica-esign-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }
}

// Blank document title during window print so browsers don't print "Lanica | Admin Dashboard"
let savedAdminDocTitle = "";
window.addEventListener("beforeprint", () => {
  const modal = document.getElementById("lanica-receipt-modal");
  if (modal && modal.classList.contains("active")) {
    savedAdminDocTitle = document.title;
    document.title = "";
  }
});
window.addEventListener("afterprint", () => {
  if (savedAdminDocTitle) {
    document.title = savedAdminDocTitle;
    savedAdminDocTitle = "";
  }
});

/**
 * Initializes and wires up the official Lanica receipt/voucher modal events.
 */
function initLanicaReceiptModalListeners() {
  const modal = document.getElementById("lanica-receipt-modal");
  const closeBtn = document.getElementById("btn-close-lanica-modal");
  const printBtn = document.getElementById("btn-print-lanica-doc");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");

  const closeModal = () => {
    if (modal) {
      modal.classList.remove("active");
      modal.style.display = "none";
    }
  };

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });
    closeBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      closeModal();
    });
  }

  if (modal && !modal.dataset.bound) {
    modal.dataset.bound = "true";
    // Deliberately do not close on backdrop click or ESC key to prevent accidental dismissal on mobile
  }

  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "true";
    printBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.print();
    });
    printBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      window.print();
    });
  }

  if (tabVoucher && !tabVoucher.dataset.bound) {
    tabVoucher.dataset.bound = "true";
    const onVoucher = (e) => {
      if (e) e.preventDefault();
      activeReceiptTab = "voucher";
      renderLanicaDocumentContent();
    };
    tabVoucher.addEventListener("click", onVoucher);
    tabVoucher.addEventListener("touchend", onVoucher);
  }

  if (tabQuotation && !tabQuotation.dataset.bound) {
    tabQuotation.dataset.bound = "true";
    const onQuotation = (e) => {
      if (e) e.preventDefault();
      activeReceiptTab = "quotation";
      renderLanicaDocumentContent();
    };
    tabQuotation.addEventListener("click", onQuotation);
    tabQuotation.addEventListener("touchend", onQuotation);
  }

  const setBranch = (branchKey) => {
    if (!activeReceiptOrder) return;
    activeReceiptOrder._selectedBranch = branchKey;
    const cfg = LANICA_BRANCHES[branchKey] || LANICA_BRANCHES.calamba;
    activeReceiptOrder._docBranch = {
      title: cfg.title,
      address: cfg.address,
      contact: cfg.contact,
      voucherLocation: cfg.voucherLocation,
    };
    renderLanicaDocumentContent();
    showToast(`Switched document to ${cfg.name}.`, "info");
  };

  if (branchCalamba && !branchCalamba.dataset.bound) {
    branchCalamba.dataset.bound = "true";
    const onCalamba = (e) => {
      if (e) e.preventDefault();
      setBranch("calamba");
    };
    branchCalamba.addEventListener("click", onCalamba);
    branchCalamba.addEventListener("touchend", onCalamba);
  }

  if (branchPila && !branchPila.dataset.bound) {
    branchPila.dataset.bound = "true";
    const onPila = (e) => {
      if (e) e.preventDefault();
      setBranch("pila");
    };
    branchPila.addEventListener("click", onPila);
    branchPila.addEventListener("touchend", onPila);
  }

  const area = document.getElementById("lanica-printable-area");
  if (area && !area.dataset.bound) {
    area.dataset.bound = "true";

    // Track real-time edits to signatories, branch details, and quotation fields
    area.addEventListener("input", (e) => {
      if (!activeReceiptOrder) return;

      // 1. Signatory edits
      const sigEl = e.target.closest("[data-sig-field]");
      if (sigEl) {
        const field = sigEl.getAttribute("data-sig-field");
        if (field) {
          if (!activeReceiptOrder._voucherSignatories) {
            activeReceiptOrder._voucherSignatories = {};
          }
          activeReceiptOrder._voucherSignatories[field] = sigEl.innerText.trim();
        }
        return;
      }

      // 2. Branch header & location edits
      const branchEl = e.target.closest("[data-branch-field]");
      if (branchEl) {
        const field = branchEl.getAttribute("data-branch-field");
        if (field) {
          if (!activeReceiptOrder._docBranch) {
            activeReceiptOrder._docBranch = {};
          }
          activeReceiptOrder._docBranch[field] = branchEl.innerText.trim();
        }
        return;
      }

      // 3. Customer & Quotation detail edits
      const docEl = e.target.closest("[data-quotation-field]");
      if (docEl) {
        const field = docEl.getAttribute("data-quotation-field");
        if (field) {
          if (!activeReceiptOrder._docQuotation) {
            activeReceiptOrder._docQuotation = {};
          }
          activeReceiptOrder._docQuotation[field] = docEl.innerText.trim();
        }
        return;
      }
    });

    // Prevent multiline breaks on Enter in single-line editable spans
    area.addEventListener("keydown", (e) => {
      const fieldEl = e.target.closest("[contenteditable='true']");
      if (fieldEl && e.key === "Enter") {
        e.preventDefault();
        fieldEl.blur();
      }
    });

    // Reset and E-Sign button handlers
    area.addEventListener("click", (e) => {
      const attachBtn = e.target.closest(".btn-attach-esign");
      if (attachBtn) {
        const role = attachBtn.getAttribute("data-sig-role");
        const title = attachBtn.getAttribute("data-sig-title");
        if (role) openLanicaEsignModal(role, title);
        return;
      }

      const removeSigBtn = e.target.closest(".btn-remove-esign");
      if (removeSigBtn && activeReceiptOrder) {
        const role = removeSigBtn.getAttribute("data-sig-role");
        if (role && activeReceiptOrder._voucherSignatories && activeReceiptOrder._voucherSignatories.signatures) {
          delete activeReceiptOrder._voucherSignatories.signatures[role];
          renderLanicaDocumentContent();
          showToast("Signature removed.", "info");
        }
        return;
      }

      const resetSigBtn = e.target.closest("#btn-reset-voucher-sig");
      if (resetSigBtn && activeReceiptOrder) {
        delete activeReceiptOrder._voucherSignatories;
        renderLanicaDocumentContent();
        showToast("Signatories reset to default.", "info");
        return;
      }

      const resetBranchBtn = e.target.closest("#btn-reset-branch-btn");
      if (resetBranchBtn && activeReceiptOrder) {
        const branchKey = activeReceiptOrder._selectedBranch || "calamba";
        const cfg = LANICA_BRANCHES[branchKey] || LANICA_BRANCHES.calamba;
        activeReceiptOrder._docBranch = {
          title: cfg.title,
          address: cfg.address,
          contact: cfg.contact,
          voucherLocation: cfg.voucherLocation,
        };
        renderLanicaDocumentContent();
        showToast(`Branch header reset to ${cfg.name} defaults.`, "info");
        return;
      }
    });
  }
}

/**
 * Opens the high-fidelity Lanica document modal for a specific order.
 */
function openLanicaReceiptModal(orderId, defaultTab = "voucher") {
  initLanicaReceiptModalListeners();

  const order =
    (allOrders || []).find((o) => o.id === orderId) ||
    (currentSelectedOrder && currentSelectedOrder.id === orderId ? currentSelectedOrder : null);
  if (!order) {
    showToast("Unable to load order details for receipt generation.", "error");
    return;
  }

  activeReceiptOrder = order;
  activeReceiptTab = defaultTab || "voucher";

  // Auto-detect branch based on order address/notes if not already explicitly selected
  if (!activeReceiptOrder._selectedBranch) {
    const rawAddr = (formatOrderDeliveryAddress(order) || "").toLowerCase();
    const rawLandmark = (formatOrderLandmark(order) || "").toLowerCase();
    const branchHint = String(order.branch || order.branchName || "").toLowerCase();

    if (
      rawAddr.includes("pila") ||
      rawAddr.includes("labuin") ||
      rawLandmark.includes("pila") ||
      branchHint.includes("pila")
    ) {
      activeReceiptOrder._selectedBranch = "pila";
    } else {
      activeReceiptOrder._selectedBranch = "calamba";
    }
  }

  renderLanicaDocumentContent();

  const modal = document.getElementById("lanica-receipt-modal");
  if (modal) {
    modal.classList.add("active");
    modal.style.display = "flex";
  }
}

/**
 * Renders the authentic Lanica business documents (Payment Request Voucher or Official Quotation).
 */
function renderLanicaDocumentContent() {
  const area = document.getElementById("lanica-printable-area");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");

  if (!area || !activeReceiptOrder) return;

  const order = activeReceiptOrder;

  // Toggle Tab Button Active Visuals
  if (tabVoucher && tabQuotation) {
    if (activeReceiptTab === "voucher") {
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

  // Toggle Branch Button Active Visuals
  const currentBranchKey = order._selectedBranch || "calamba";
  const branchConfig = LANICA_BRANCHES[currentBranchKey] || LANICA_BRANCHES.calamba;

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

  // Preserve custom branch header edits or initialize from branch config
  if (!order._docBranch) {
    order._docBranch = {
      title: branchConfig.title,
      address: branchConfig.address,
      contact: branchConfig.contact,
      voucherLocation: branchConfig.voucherLocation,
    };
  }
  const branch = order._docBranch;

  // Financial calculations
  const totalVal = Number(order.totalAmount || order.total || 0);
  const isAwaitingCounter = order.paymentStatus === "awaiting_counter_downpayment";
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounter;
  const paidVal = isAwaitingCounter
    ? Number(order.downpaymentPaid || 0)
    : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
  const remainingVal = Number(order.remainingBalance ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
  const isPartial = isDownpayment && remainingVal > 0;

  const deliveryCharge = Number(order.deliveryFee ?? order.shippingFee ?? order.shippingAddress?.shippingCost ?? 1000);
  const discountDf = Number(order.discountedDeliveryFee ?? order.discountDf ?? 0);
  const itemsSubtotal = Math.max(0, totalVal - deliveryCharge);
  const totalPlusDf = itemsSubtotal + deliveryCharge;
  const grandTotal = totalVal;

  // Preserve quotation customer field edits
  const customQuotation = order._docQuotation || {};
  const customerName = customQuotation.customerName || resolveCustomerDisplay(order);
  const customerAddress = customQuotation.customerAddress || formatOrderDeliveryAddress(order);
  const customerPhone = customQuotation.customerPhone || formatOrderRecipientPhone(order);
  const quotationNumber = customQuotation.quotationNumber || String(order.orderId || order.id || "0122").slice(0, 10).toUpperCase();

  const purchaseDate = customQuotation.purchaseDate || formatFormalDate(order.createdAt, false);
  const purchaseDateUpper = formatFormalDate(order.createdAt, true);
  const deliveryDate = customQuotation.deliveryDate || formatFormalDate(order.targetDeliveryDate || order.estimatedDeliveryDate || order.deliveredAt, true);

  const proofUrl = pickFirstNonEmpty(order.proofUrl, order.paymentProof, order.paymentProofUrl, "");
  const methodDisplay = formatTransactionMethod(order.paymentMethod || order.paymentType);

  // Common Header Template matching authentic Lanica format with editable branch details
  const headerHtml = `
    <!-- Subtle Inline Editing Notification (Hidden on print) -->
    <div class="modal-no-print voucher-edit-hint" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; padding: 6px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; font-size: 0.76rem; color: #1d4ed8;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.9rem;">✎</span>
        <span>Branch header, address, customer details &amp; signatories are fully editable inline.</span>
      </div>
      <button type="button" id="btn-reset-branch-btn" title="Reset branch details to defaults" style="background: #ffffff; border: 1px solid #bfdbfe; border-radius: 5px; font-size: 0.72rem; font-weight: 600; color: #1e40af; padding: 3px 8px; cursor: pointer; transition: all 0.15s ease;">
        ↺ Reset to ${escapeHtml(branchConfig.name)}
      </button>
    </div>

    <!-- Authentic Document Header -->
    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 18px; margin-bottom: 8px;">
      <img src="assets/lanicalogo.jpg" alt="Lanica Logo" style="width: 76px; height: 76px; object-fit: contain; border: 1.5px solid #000; padding: 2px;" onerror="this.onerror=null;this.src='assets/product_sofa.png';" />
      <div style="text-align: center; flex: 1;">
        <div
          contenteditable="true"
          spellcheck="false"
          class="doc-editable-field"
          data-branch-field="title"
          title="Click to edit branch name"
          style="font-size: 0.95rem; font-weight: 800; letter-spacing: 0.05em; color: #000; text-transform: uppercase; cursor: text; padding: 1px 4px;"
        >${escapeHtml(branch.title)}</div>
        <div
          contenteditable="true"
          spellcheck="false"
          class="doc-editable-field"
          data-branch-field="address"
          title="Click to edit branch address"
          style="font-size: 0.8rem; font-weight: 600; color: #1f2937; margin-top: 3px; text-transform: uppercase; cursor: text; padding: 1px 4px;"
        >${escapeHtml(branch.address)}</div>
        <div style="font-size: 0.8rem; font-weight: 700; color: #000; margin-top: 2px;">
          CONTACT NO#: <span
            contenteditable="true"
            spellcheck="false"
            class="doc-editable-field"
            data-branch-field="contact"
            title="Click to edit contact number"
            style="cursor: text; padding: 1px 4px;"
          >${escapeHtml(branch.contact)}</span>
        </div>
      </div>
    </div>
    <div style="height: 4px; background: #000; width: 100%; margin-bottom: 22px;"></div>
  `;

  if (activeReceiptTab === "voucher") {
    // ==========================================
    // DOCUMENT 2: PAYMENT REQUEST VOUCHER (Image 2)
    // ==========================================
    const firstItem = (order.items && order.items[0]) || null;
    const firstItemName = firstItem ? (firstItem.name || firstItem.title || "SEMI ELEGANT") : "SEMI ELEGANT";
    const particulars = `PAYMENT FOR ${escapeHtml(firstItemName.toUpperCase())} SOFA SET`;
    const staffSignatory = order.assignedStaffName || "Joanna (Staff)";
    const signDate = purchaseDate;

    // Use preserved custom edits on the order if any exist, or defaults
    if (!order._voucherSignatories) {
      order._voucherSignatories = {
        preparedBy: staffSignatory,
        preparedDate: signDate,
        checkedBy: "Artisan Lead",
        checkedDate: signDate,
        approvedBy: "SUPERVISOR",
        approvedDate: signDate,
        receivedBy: "OWNER/REPRESENTATIVE",
        receivedDate: signDate,
        signatures: {},
      };
    }
    if (!order._voucherSignatories.signatures) {
      order._voucherSignatories.signatures = {};
    }
    const sigs = order._voucherSignatories;

    const renderSignatoryCol = (roleKey, roleLabel, defaultName, isCursive = false) => {
      const nameVal = sigs[roleKey] || defaultName;
      const dateVal = sigs[roleKey + "Date"] || purchaseDate;
      const signatureImg = (sigs.signatures && sigs.signatures[roleKey]) || null;

      return `
        <div style="display: flex; flex-direction: column; justify-content: flex-end;">
          <div style="font-weight: 700; text-transform: uppercase; color: #000; min-height: 28px; display: flex; align-items: center; justify-content: center; line-height: 1.2;">${roleLabel}</div>
          
          <!-- E-Signature Slot Above Name -->
          <div class="voucher-signature-slot" style="min-height: 52px; display: flex; align-items: flex-end; justify-content: center; position: relative; margin: 6px auto 2px; width: 90%;">
            ${
              signatureImg
                ? `
                  <div style="position: relative; display: inline-block;">
                    <img src="${signatureImg}" alt="Signature" style="max-height: 48px; max-width: 130px; object-fit: contain; display: block;" />
                    <div class="modal-no-print" style="position: absolute; top: -6px; right: -8px;">
                      <button type="button" class="btn-remove-esign" data-sig-role="${roleKey}" title="Remove signature" style="background: #ef4444; color: #fff; border: none; border-radius: 50%; width: 18px; height: 18px; font-size: 11px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.25); touch-action: manipulation;">&times;</button>
                    </div>
                  </div>
                `
                : `
                  <div class="modal-no-print" style="width: 100%;">
                    <button type="button" class="btn-attach-esign" data-sig-role="${roleKey}" data-sig-title="${escapeHtml(roleLabel.replace(/<br\s*\/?>/gi, ' '))}" title="Attach or draw electronic signature" style="width: 100%; border: 1.5px dashed #93c5fd; background: #eff6ff; color: #1d4ed8; border-radius: 6px; padding: 4px 2px; font-size: 0.68rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 3px; transition: all 0.15s ease; touch-action: manipulation;">
                      ✍️ + Attach / Draw
                    </button>
                  </div>
                `
            }
          </div>

          <div
            contenteditable="true"
            spellcheck="false"
            class="voucher-editable-signatory"
            data-sig-field="${roleKey}"
            title="Click to edit name"
            style="margin: 2px auto 4px; border-bottom: 1.5px solid #000; width: 90%; min-height: 22px; font-weight: ${isCursive ? '600' : '800'}; ${isCursive ? "font-family: cursive, 'Brush Script MT', sans-serif; font-size: 0.95rem; color: #1e293b;" : "font-size: 0.78rem; color: #000;"} padding: 1px 4px; text-align: center; cursor: text;"
          >${escapeHtml(nameVal)}</div>

          <div style="font-size: 0.72rem; color: #475569;">
            DATE: <span contenteditable="true" spellcheck="false" class="voucher-editable-date" data-sig-field="${roleKey}Date" title="Click to edit date" style="padding: 1px 4px; cursor: text;">${escapeHtml(dateVal)}</span>
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
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">${escapeHtml(order.paymentMethod === "walk_in_cash" || order.paymentMethod === "cash" || String(order.paymentMethod || "").toLowerCase().includes("counter") ? "CASH (COUNTER)" : "QR PH / PAYMONGO")}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">LOCATION:</td>
              <td
                contenteditable="true"
                spellcheck="false"
                class="doc-editable-field"
                data-branch-field="voucherLocation"
                title="Click to edit voucher location"
                style="border: 1px solid #000; padding: 7px 12px; font-weight: 600; text-transform: uppercase; cursor: text;"
              >${escapeHtml(branch.voucherLocation || branch.address)}</td>
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
                AMOUNT PAID (Partial ${isPartial ? '<strong>[ ☑ ]</strong>' : '[ ☐ ]'} Full ${!isPartial ? '<strong>[ ☑ ]</strong>' : '[ ☐ ]'})
              </td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700;">₱ ${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; text-transform: uppercase;">REMAINING BALANCE:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; font-size: 0.95rem;">₱ ${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <div style="font-size: 0.9rem; font-weight: 700; color: #000;">2. APPROVAL &amp; CHECK/PAYMENT RELEASE SIGNATORIES</div>
          <div class="modal-no-print" style="display: flex; align-items: center; gap: 8px;">
            <span class="voucher-edit-hint" style="font-size: 0.74rem; font-weight: 600; color: #1d4ed8; background: #eff6ff; padding: 3px 10px; border-radius: 6px; border: 1px solid #bfdbfe;">
              ✎ Click any name or attach signature above
            </span>
            <button type="button" id="btn-reset-voucher-sig" title="Reset signatories and signatures to default" style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.72rem; font-weight: 600; color: #475569; padding: 3px 8px; cursor: pointer; transition: all 0.15s ease;">
              ↺ Reset
            </button>
          </div>
        </div>
        <div style="border-top: 2px solid #000; padding-top: 14px; margin-bottom: 24px;">
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center; font-size: 0.78rem;">
            ${renderSignatoryCol("preparedBy", "PREPARED BY", staffSignatory, true)}
            ${renderSignatoryCol("checkedBy", "CHECKED BY", "Artisan Lead", true)}
            ${renderSignatoryCol("approvedBy", "APPROVED AND CHECK<br/>SIGNATORY", "SUPERVISOR", false)}
            ${renderSignatoryCol("receivedBy", "CHECK PAYMENT<br/>RECEIVE", "OWNER/REPRESENTATIVE", false)}
          </div>
        </div>

        ${proofUrl ? `
          <div style="margin-top: 18px; border: 1.5px dashed #64748b; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: #334155; margin-bottom: 10px;">ATTACHED PAYMENT VERIFICATION SCREENSHOT / ADVICE:</div>
            <img src="${proofUrl}" alt="Proof of Payment" style="max-height: 260px; max-width: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); margin: 0 auto; display: block;" onerror="this.onerror=null;this.parentElement.style.display='none';" />
          </div>
        ` : `
          <div style="margin-top: 18px; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; color: #059669;">PAYMENT RECONCILED &amp; VERIFIED VIA ${escapeHtml(methodDisplay)}</div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 3px;">Lanica Financial Ledger Ref: <strong>TX-${escapeHtml(String(quotationNumber).slice(0, 10))}</strong> &bull; Reconciled on ${escapeHtml(purchaseDate)}</div>
          </div>
        `}
      </div>
    `;
  } else {
    // ==========================================
    // DOCUMENT 1: OFFICIAL QUOTATION (Image 1)
    // ==========================================
    const items = (order.items && order.items.length > 0) ? order.items : [{
      name: "SEMI ELEGANT LTYPE FULLBACKREST",
      quantity: 1,
      price: itemsSubtotal,
      material: "Pure Goodlumber / Uratex 4in",
      color: "Gamusa Bailey Mustang",
      customNotes: "With 1 arm sa kanan, with flesh lining"
    }];

    const itemsRowsHtml = items.map((item, idx) => {
      const itemQty = Number(item.quantity || 1);
      const itemPrice = parseItemPrice(item.price);
      const itemTotal = itemPrice * itemQty;
      const itemName = String(item.name || item.title || "SEMI ELEGANT LTYPE FULLBACKREST").toUpperCase();

      // Match catalog product for fallback/lookup
      const matchedProduct = Array.isArray(allProducts)
        ? allProducts.find((p) => p.id === item.productId || (p.name && item.name && p.name.toLowerCase() === item.name.toLowerCase()))
        : null;

      // Dynamic Color
      const rawColor = item.color || item.fabricColor || (matchedProduct && (matchedProduct.color || matchedProduct.fabricColor || (Array.isArray(matchedProduct.colors) && matchedProduct.colors[0]))) || "GAMUSA BAILEY MUSTANG";
      const itemColor = String(rawColor).toUpperCase();

      const itemSpecs = item.customNotes || item.specs || "With 1 arm sa kanan, with flesh lining";

      // Dynamic Freebies
      const rawFreebies = item.freebies || (matchedProduct && matchedProduct.freebies) || "5 PILLOWS, FOOTSTOOL (CLASS A FOAM), FOOTINGS";
      const freebiesList = (Array.isArray(rawFreebies) ? rawFreebies : String(rawFreebies).split(/[\n,]+/))
        .map((f) => String(f).trim())
        .filter(Boolean);

      // Resolve Product Materials from Admin Configured Product Data
      const isUpholsteryOnly = (val) => {
        if (!val) return true;
        const s = String(val).trim().toLowerCase();
        return s === "fabric" || s === "leather" || s === "standard" || s === "custom";
      };

      let materialsList = [];
      if (matchedProduct && Array.isArray(matchedProduct.materials) && matchedProduct.materials.length > 0) {
        materialsList = matchedProduct.materials
          .map((m) => String(m).trim())
          .filter((m) => m && !isUpholsteryOnly(m));
      }
      if (materialsList.length === 0 && Array.isArray(item.materials) && item.materials.length > 0) {
        materialsList = item.materials
          .map((m) => String(m).trim())
          .filter((m) => m && !isUpholsteryOnly(m));
      }
      if (materialsList.length === 0 && matchedProduct && matchedProduct.material && !isUpholsteryOnly(matchedProduct.material)) {
        materialsList = String(matchedProduct.material)
          .split(/[\n,]+/)
          .map((m) => m.trim())
          .filter((m) => m && !isUpholsteryOnly(m));
      }
      if (materialsList.length === 0 && item.materials && typeof item.materials === "string" && !isUpholsteryOnly(item.materials)) {
        materialsList = String(item.materials)
          .split(/[\n,]+/)
          .map((m) => m.trim())
          .filter((m) => m && !isUpholsteryOnly(m));
      }
      if (materialsList.length === 0) {
        materialsList = [
          "PURE GOODLUMBER WOOD FRAME (KILN DRIED)",
          "PURE 4 INCHES URATEX FOAM",
          "ANTI ANAY AT BUKBOK TREATED",
          "PLUSH PREMIUM UPHOLSTERY FABRIC"
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
                ${freebiesList.length > 0 
                  ? freebiesList.map(f => `✓ ${escapeHtml(f.toUpperCase())}`).join("<br/>") 
                  : "✓ STANDARD INCLUSIONS"}
              </div>
            </div>

            <div style="margin-top: 8px; font-size: 0.8rem;">
              <div style="font-weight: 700; text-transform: uppercase;">MATERIALS:</div>
              <div style="padding-left: 4px; line-height: 1.4;">
                ${materialsList.map(m => `✓ ${escapeHtml(m.toUpperCase())}`).join("<br/>")}
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

        <!-- Customer & Quotation Meta Grid (Directly Inline Editable) -->
        <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 22px; font-size: 0.86rem; line-height: 1.5; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 260px;">
            <div><strong>NAME:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerName" title="Click to edit customer name" style="text-transform: uppercase; cursor: text; padding: 1px 4px;">${escapeHtml(customerName)}</span></div>
            <div><strong>ADDRESS:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerAddress" title="Click to edit customer address" style="text-transform: uppercase; cursor: text; padding: 1px 4px;">${escapeHtml(customerAddress)}</span></div>
            <div><strong>CONTACT#:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerPhone" title="Click to edit contact number" style="cursor: text; padding: 1px 4px;">${escapeHtml(customerPhone)}</span></div>
          </div>
          <div style="min-width: 260px; text-align: right;">
            <div><strong>QUOTATION#</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="quotationNumber" title="Click to edit quotation#" style="cursor: text; padding: 1px 4px;">${escapeHtml(quotationNumber)}</span></div>
            <div><strong>DATE OF PURCHASE:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="purchaseDate" title="Click to edit purchase date" style="cursor: text; padding: 1px 4px;">${escapeHtml(purchaseDate)}</span></div>
            <div><strong>DATE OF DELIVERY:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="deliveryDate" title="Click to edit delivery date" style="text-transform: uppercase; cursor: text; padding: 1px 4px;">${escapeHtml(deliveryDate)}</span></div>
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
            ${discountDf > 0 ? `
              <div style="display: flex; justify-content: space-between; font-weight: 700; border-top: 1px dashed #cbd5e1; border-bottom: 1px dashed #cbd5e1; padding: 3px 0; margin: 4px 0;">
                <span>Discounted DF:</span>
                <span style="color: #dc2626; font-weight: 800;">LESS ₱ ${discountDf.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            ` : ''}
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
}


// Global Kebab Menu Click & Outside Dismiss Handler
document.addEventListener("click", (e) => {
  const kebabBtn = e.target.closest(".kebab-trigger-btn, .kebab-menu-btn");
  if (kebabBtn) {
    e.stopPropagation();
    const container = kebabBtn.closest(".kebab-menu-container, .kebab-container") || kebabBtn.parentElement;
    const dropdown = container ? container.querySelector(".kebab-dropdown-menu, .kebab-menu-dropdown") : kebabBtn.nextElementSibling;
    
    if (dropdown) {
      const isCurrentlyOpen = dropdown.style.display === "block" || dropdown.classList.contains("active");
      
      // Close all open dropdowns
      document.querySelectorAll(".kebab-dropdown-menu, .kebab-menu-dropdown").forEach((el) => {
        el.style.display = "none";
        el.classList.remove("active");
      });
      
      if (!isCurrentlyOpen) {
        dropdown.style.display = "block";
        dropdown.classList.add("active");

        // Use fixed positioning to prevent overflow clipping by table containers
        dropdown.style.position = "fixed";
        dropdown.style.zIndex = "999999";
        
        const rect = kebabBtn.getBoundingClientRect();
        const dropdownHeight = dropdown.offsetHeight || 180;
        const spaceBelow = window.innerHeight - rect.bottom;
        
        // Vertical positioning (flip upward if near viewport bottom)
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          dropdown.style.top = `${rect.top - dropdownHeight - 6}px`;
        } else {
          dropdown.style.top = `${rect.bottom + 6}px`;
        }
        
        // Horizontal positioning (align right edge with button right edge)
        const rightEdge = window.innerWidth - rect.right;
        dropdown.style.right = `${Math.max(10, rightEdge)}px`;
        dropdown.style.left = "auto";
      }
    }
  } else {
    // Dismiss all dropdowns on outside click or menu item selection
    document.querySelectorAll(".kebab-dropdown-menu, .kebab-menu-dropdown").forEach((el) => {
      el.style.display = "none";
      el.classList.remove("active");
    });
  }
});

// Dismiss fixed dropdowns on window scroll or resize to prevent floating misalignments
window.addEventListener("scroll", () => {
  document.querySelectorAll(".kebab-dropdown-menu, .kebab-menu-dropdown").forEach((el) => {
    el.style.display = "none";
    el.classList.remove("active");
  });
}, { passive: true });

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

function formatAuditLogTimestamp(log) {
  if (log.clientFormattedDate && typeof log.clientFormattedDate === "string") {
    return log.clientFormattedDate;
  }
  let dateObj = null;
  if (log.timestamp?.toDate) {
    dateObj = log.timestamp.toDate();
  } else if (log.createdAt) {
    dateObj = new Date(log.createdAt);
  } else {
    dateObj = new Date();
  }
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, "0");
  const seconds = String(dateObj.getSeconds()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const hoursStr = String(hours).padStart(2, "0");
  return `${year}-${month}-${day} ${hoursStr}:${minutes}:${seconds} ${ampm}`;
}

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

  // Delegated event listener for State Diff inspection toggle (Strictly Read-Only)
  if (!tableBody.dataset.diffBound) {
    tableBody.dataset.diffBound = "true";
    tableBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-toggle-diff");
      if (!btn) return;
      const targetId = btn.getAttribute("data-target");
      const panel = document.getElementById(targetId);
      if (!panel) return;
      const isHidden = panel.style.display === "none";
      panel.style.display = isHidden ? "block" : "none";
      const span = btn.querySelector("span");
      if (span) span.textContent = isHidden ? "Hide State Diff" : "Inspect State Diff";
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
    const logRole = (log.performedBy?.role || log.userRole || "").toLowerCase();
    if (roleVal !== "all" && logRole !== roleVal) return false;

    const logAction = (log.action || log.actionType || "").toUpperCase();
    if (actionVal !== "all") {
      if (actionVal === "deletions") {
        if (!logAction.includes("DELETE") && !logAction.includes("DELETED")) return false;
      } else if (actionVal === "payments") {
        if (!logAction.includes("DOWNPAYMENT") && !logAction.includes("PAYMENT")) return false;
      } else if (actionVal === "status") {
        if (!logAction.includes("STATUS") && !logAction.includes("ACCEPTED")) return false;
      } else {
        if (logAction !== actionVal.toUpperCase()) return false;
      }
    }

    if (searchVal) {
      const uName = (log.performedBy?.displayName || log.userName || "").toLowerCase();
      const uEmail = (log.performedBy?.email || log.userEmail || "").toLowerCase();
      const targetId = (log.targetId || "").toLowerCase();
      const act = logAction.toLowerCase();
      const det = (log.description || log.details || "").toLowerCase();
      return (
        uName.includes(searchVal) ||
        uEmail.includes(searchVal) ||
        targetId.includes(searchVal) ||
        act.includes(searchVal) ||
        det.includes(searchVal)
      );
    }
    return true;
  });

  if (filtered.length === 0) {
    renderTableEmptyState(tableBody, 5, "No immutable audit logs found matching your filters.");
    if (pagContainer) pagContainer.innerHTML = "";
    return;
  }

  const totalPages = Math.ceil(filtered.length / AUDIT_LOGS_PER_PAGE);
  if (auditLogsCurrentPage > totalPages) auditLogsCurrentPage = totalPages;

  const startIdx = (auditLogsCurrentPage - 1) * AUDIT_LOGS_PER_PAGE;
  const pageLogs = filtered.slice(startIdx, startIdx + AUDIT_LOGS_PER_PAGE);

  tableBody.innerHTML = "";
  pageLogs.forEach((log, idx) => {
    const tr = document.createElement("tr");
    tr.style.cssText = "border-bottom: 1px solid #f3f4f6; font-size: 0.85rem;";

    const dateStr = formatAuditLogTimestamp(log);

    const who = log.performedBy || {
      displayName: log.userName || "System Automated",
      email: log.userEmail || "",
      role: log.userRole || "staff",
    };
    const roleName = String(who.role || "staff").toUpperCase();
    let roleBg = "#f3f4f6";
    let roleColor = "#4b5563";
    if (roleName === "ADMIN") {
      roleBg = "#fef3c7";
      roleColor = "#92400e";
    } else if (roleName === "STAFF") {
      roleBg = "#e0f2fe";
      roleColor = "#0369a1";
    } else if (roleName === "SYSTEM") {
      roleBg = "#f1f5f9";
      roleColor = "#475569";
    }

    // Color-coded action badge specification:
    // 🔴 Red: ORDER_DELETED, PRODUCT_DELETED
    // 🟢 Green: DOWNPAYMENT_RECEIVED, ORDER_ACCEPTED
    // 🔵 Blue: ORDER_STATUS_CHANGED, PRODUCT_UPDATED
    // 🟣 Purple / Other: PRODUCT_CREATED, SETTINGS_CHANGED
    const actType = String(log.action || log.actionType || "EVENT").toUpperCase();
    let actBg = "#f3f4f6";
    let actColor = "#374151";
    let actBorder = "#e5e7eb";

    if (actType === "ORDER_DELETED" || actType === "PRODUCT_DELETED" || actType.includes("DELETE")) {
      actBg = "#fef2f2";
      actColor = "#dc2626";
      actBorder = "#fecaca";
    } else if (
      actType === "DOWNPAYMENT_RECEIVED" ||
      actType === "ORDER_ACCEPTED" ||
      actType.includes("RECEIVED") ||
      actType.includes("ACCEPTED")
    ) {
      actBg = "#ecfdf5";
      actColor = "#059669";
      actBorder = "#a7f3d0";
    } else if (
      actType === "ORDER_STATUS_CHANGED" ||
      actType === "PRODUCT_UPDATED" ||
      actType.includes("STATUS") ||
      actType.includes("UPDATE")
    ) {
      actBg = "#eff6ff";
      actColor = "#2563eb";
      actBorder = "#bfdbfe";
    } else if (actType === "PRODUCT_CREATED" || actType === "SETTINGS_CHANGED") {
      actBg = "#faf5ff";
      actColor = "#7c3aed";
      actBorder = "#e9d5ff";
    }

    const refId = log.targetId ? `#${escapeHtml(log.targetId)}` : "—";
    const targetType = log.targetType
      ? `<span style="font-size:0.68rem; color:#6b7280; text-transform:uppercase; display:block; font-weight:600;">${escapeHtml(log.targetType)}</span>`
      : "";

    const hasDiff =
      log.diff &&
      typeof log.diff === "object" &&
      ((log.diff.before && Object.keys(log.diff.before).length > 0) ||
        (log.diff.after && Object.keys(log.diff.after).length > 0));

    const safeLogId = escapeHtml(log.id || `log-${idx}-${Date.now()}`);

    tr.innerHTML = `
      <td style="padding: 12px 18px; color: #4b5563; font-size: 0.8rem; white-space: nowrap; vertical-align: top;">
        <span style="font-family: monospace; font-weight: 500;">${escapeHtml(dateStr)}</span>
      </td>
      <td style="padding: 12px 18px; vertical-align: top;">
        <strong style="color: #111827; display: block; font-size: 0.84rem;">${escapeHtml(who.displayName || "Admin Staff")}</strong>
        <span style="font-size: 0.74rem; color: #6b7280; display: block;">${escapeHtml(who.email || "")}</span>
        <span style="display: inline-block; margin-top: 4px; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${roleBg}; color: ${roleColor};">${roleName}</span>
      </td>
      <td style="padding: 12px 18px; vertical-align: top;">
        <span style="display: inline-block; font-size: 0.74rem; font-weight: 700; padding: 3px 8px; border-radius: 6px; background: ${actBg}; color: ${actColor}; border: 1px solid ${actBorder}; letter-spacing: 0.02em;">
          ${escapeHtml(actType)}
        </span>
      </td>
      <td style="padding: 12px 18px; vertical-align: top;">
        ${targetType}
        <span style="font-size: 0.78rem; font-family: monospace; background: #f3f4f6; padding: 2px 6px; border-radius: 4px; color: #1f2937; display: inline-block; word-break: break-all;">
          ${refId}
        </span>
      </td>
      <td style="padding: 12px 18px; vertical-align: top; color: #374151;">
        <div style="font-size: 0.84rem; color: #1f2937; margin-bottom: 6px; line-height: 1.45;">
          ${escapeHtml(log.description || log.details || "—")}
        </div>
        ${
          hasDiff
            ? `
          <button type="button" class="btn-toggle-diff" data-target="diff-panel-${safeLogId}" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 5px; padding: 3px 8px; font-size: 0.72rem; font-weight: 600; color: #2563eb; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><span>Inspect State Diff</span>
          </button>
          <div id="diff-panel-${safeLogId}" class="diff-container" style="display: none; margin-top: 8px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-family: monospace; font-size: 0.74rem; overflow-x: auto;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
              <div>
                <div style="font-weight: 700; color: #dc2626; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                  <span>◀</span> Before State Snapshot
                </div>
                <pre style="margin: 0; background: #fff; padding: 8px; border: 1px solid #fecaca; border-radius: 4px; color: #991b1b; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto;">${escapeHtml(JSON.stringify(log.diff.before || {}, null, 2))}</pre>
              </div>
              <div>
                <div style="font-weight: 700; color: #16a34a; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                  <span>▶</span> After State Snapshot
                </div>
                <pre style="margin: 0; background: #fff; padding: 8px; border: 1px solid #bbf7d0; border-radius: 4px; color: #166534; white-space: pre-wrap; word-break: break-all; max-height: 180px; overflow-y: auto;">${escapeHtml(JSON.stringify(log.diff.after || {}, null, 2))}</pre>
              </div>
            </div>
          </div>
        `
            : ""
        }
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
        const targetUser = allUsers.find((x) => String(x.id) === String(docId));
        const prevRole = targetUser?.role || "unknown";
        const prevPermissions = targetUser?.permissions || {};

        await updateDoc(doc(db, "users", docId), {
          role: newRole,
          permissions: permissionsPayload,
          updatedAt: new Date().toISOString(),
        });

        await recordAuditLog({
          action: "SETTINGS_CHANGED",
          targetType: "user",
          targetId: docId,
          description: `Updated security role to "${newRole}" and updated permissions for ${targetUser?.name || targetUser?.email || docId}`,
          diff: {
            before: { role: prevRole, permissions: prevPermissions },
            after: { role: newRole, permissions: permissionsPayload },
          },
          performedBy: currentUser,
        });

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
  document.addEventListener("DOMContentLoaded", () => {
    setupUserManagementControls();
    initLanicaReceiptModalListeners();
  });
} else {
  setupUserManagementControls();
  initLanicaReceiptModalListeners();
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

// User realtime subscriptions are initialized in startAdminRealtimeListeners upon authentication

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
      showToast(err.message || "Failed to update user account.", "error");
      t.textContent = "Save";
    } finally {
      t.removeAttribute("disabled");
    }
  });
}

function updateOrderStats(orders) {
  const counts = { placed: 0, "slot reserved": 0, "downpayment confirmed": 0, "in production": 0, "quality checked": 0, shipped: 0, delivered: 0, refund_requested: 0 };
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
  set("orders-pending", counts.placed + counts["slot reserved"]);
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
    } else if (ordersFilterValue === "placed") {
      rows = activeOrders.filter((o) => {
        const st = normalizeOrderStatus(o.status);
        return st === "placed" || st === "slot reserved";
      });
    } else if (ordersFilterValue === "completed") {
      rows = allOrders.filter(
        (o) =>
          (isOrderCompleted(o) || normalizeOrderStatus(o.status) === "completed") &&
          normalizeOrderAction(o.action) !== "delete"
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
    showToast("Analytics content is not available.", "warning");
    return;
  }

  if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
    showToast("PDF export library is not ready. Please refresh and try again.", "warning");
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
    showToast("Analytics exported successfully as PDF!", "success");
  } catch (err) {
    console.error("PDF export failed:", err);
    showToast("Failed to export analytics as PDF.", "error");
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
    showAdminToast("Select at least one order to delete.", "warning");
    return;
  }

  const selectedOrders = selectedIds
    .map((id) => allOrders.find((o) => o.id === id))
    .filter((o) => !!o);

  const validTargets = selectedOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return (
      (st === "declined" || st === "cancelled" || st === "delivered") &&
      normalizeOrderAction(o.action) !== "delete" &&
      !o.isDeleted
    );
  });

  if (validTargets.length === 0) {
    showAdminToast("No valid deletable orders selected.", "warning");
    selectedDeclinedOrderIds.clear();
    syncBatchDeleteUi();
    applyOrdersFilter();
    return;
  }

  const confirmed = await showAdminConfirmModal({
    title: "Batch Delete Orders",
    message: `Are you sure you want to permanently delete <strong>${validTargets.length}</strong> selected order(s)?<br><br><span style="color:#dc2626;">This action cannot be undone.</span>`,
    confirmText: `Delete ${validTargets.length} Orders`,
    cancelText: "Cancel",
    confirmType: "danger",
    icon: "delete",
  });
  if (!confirmed) return;

  if (batchDeleteDeclinedBtn) {
    batchDeleteDeclinedBtn.disabled = true;
    batchDeleteDeclinedBtn.textContent = "Deleting...";
  }

  const results = await Promise.allSettled(
    validTargets.map(async (o) => {
      await updateDoc(doc(db, "orders", o.id), {
        isDeleted: true,
        deletedBy: currentUser?.uid || "admin",
        deletedByEmail: currentUser?.email || "",
        deletedByName: currentUser?.displayName || "Admin Staff",
        deletedAt: serverTimestamp(),
        action: "delete",
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        action: "ORDER_DELETED",
        targetType: "order",
        targetId: o.id,
        description: `Soft-deleted order #${o.id.slice(0, 8)} (${o.orderNumber || o.id}) via batch deletion`,
        diff: {
          before: {
            status: o.status,
            paymentStatus: o.paymentStatus,
            isDeleted: false,
          },
          after: {
            status: o.status,
            paymentStatus: o.paymentStatus,
            isDeleted: true,
            deletedBy: currentUser?.uid || "admin",
          },
        },
        performedBy: currentUser,
      });
    })
  );

  let success = 0;
  let failed = 0;
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      success += 1;
      const delId = validTargets[idx].id;
      selectedDeclinedOrderIds.delete(delId);
      allOrders = allOrders.filter((o) => o.id !== delId);
    } else {
      failed += 1;
      console.error("Batch delete failed for order:", validTargets[idx].id, r.reason);
    }
  });

  applyOrdersFilter();
  syncBatchDeleteUi();
  if (failed > 0) {
    showAdminToast(`Deleted ${success} order(s). ${failed} failed.`, "warning");
  } else {
    showAdminToast(`Successfully deleted ${success} order(s).`, "success");
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
      showToast(e.message || "Batch delete failed.", "error");
      syncBatchDeleteUi();
    });
  });
}

let unsubOrders = null;
let unsubUsers = null;
let ordersRetryTimeout = null;
let usersRetryTimeout = null;

/**
 * Initializes authenticated realtime subscriptions for orders and users.
 * Automatically retries with backoff if initial connection occurs while token is refreshing.
 */
function startAdminRealtimeListeners(user) {
  if (!user) return;

  // 1. ORDERS SUBSCRIPTION
  if (unsubOrders) {
    try {
      unsubOrders();
    } catch (_) {}
    unsubOrders = null;
  }
  if (ordersRetryTimeout) {
    clearTimeout(ordersRetryTimeout);
    ordersRetryTimeout = null;
  }

  function setupOrdersListener() {
    try {
      const ordersQuerySorted = query(ORDERS_COLLECTION, orderBy("createdAt", "desc"));
      unsubOrders = onSnapshot(
        ordersQuerySorted,
        (snapshot) => {
          allOrders = [];
          snapshot.forEach((d) => {
            const data = d.data();
            if (data.action === "delete" || data.isDeleted === true) return;
            allOrders.push({ id: d.id, ...data });
          });
          allOrders.sort((a, b) => orderTimestampMs(b) - orderTimestampMs(a));
          applyOrdersFilter();
          hydrateCustomerNamesForOrders(allOrders);
        },
        (err) => {
          console.warn(
            "orders orderBy(createdAt) failed or initial auth pending, falling back to unsorted:",
            err
          );
          try {
            unsubOrders = onSnapshot(
              ORDERS_COLLECTION,
              (snapshot) => {
                allOrders = [];
                snapshot.forEach((d) => {
                  const data = d.data();
                  if (data.action === "delete" || data.isDeleted === true) return;
                  allOrders.push({ id: d.id, ...data });
                });
                allOrders.sort((a, b) => orderTimestampMs(b) - orderTimestampMs(a));
                applyOrdersFilter();
                hydrateCustomerNamesForOrders(allOrders);
              },
              (fallbackErr) => {
                console.warn("Orders listener fallback encountered error (will retry):", fallbackErr);
                ordersRetryTimeout = setTimeout(() => {
                  if (currentUser) setupOrdersListener();
                }, 2500);
              }
            );
          } catch (e2) {
            console.error("Could not set up fallback orders listener:", e2);
          }
        }
      );
    } catch (e) {
      console.error("Failed to initiate orders listener:", e);
    }
  }

  setupOrdersListener();

  // 2. USERS & STAFF DIRECTORY SUBSCRIPTION
  if (unsubUsers) {
    try {
      unsubUsers();
    } catch (_) {}
    unsubUsers = null;
  }
  if (usersRetryTimeout) {
    clearTimeout(usersRetryTimeout);
    usersRetryTimeout = null;
  }

  function setupUsersListener() {
    try {
      unsubUsers = onSnapshot(
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
          console.warn("Could not load users directory (will retry):", err);
          usersRetryTimeout = setTimeout(() => {
            if (currentUser) setupUsersListener();
          }, 2500);
        }
      );
    } catch (e) {
      console.error("Failed to initiate users listener:", e);
    }
  }

  setupUsersListener();
}

// Start listeners immediately if currentUser is already confirmed
if (currentUser && currentUser.role === "admin") {
  startAdminRealtimeListeners(currentUser);
}

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
    const isPickup =
      order.fulfillmentType === "pickup" ||
      order.address?.pickupAtWorkshop ||
      order.shippingAddress?.pickupAtWorkshop;
    const fullAddr = formatOrderDeliveryAddress(order);
    const fulfillmentBadgeHtml = isPickup
      ? `<span class="fulfillment-badge pickup" title="Pickup at Lanica Workshop" style="display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path></svg>Store Pickup</span>`
      : `<span class="fulfillment-badge delivery" title="${escapeHtml(fullAddr || "Home Delivery")}" style="display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>Delivery</span>`;

    const nearestLandmark = isPickup ? "" : formatOrderLandmark(order);
    const landmarkBadgeHtml = nearestLandmark
      ? `<div style="font-size:0.73rem; color:#d97706; font-weight:500; margin-top:2px; max-width:170px; line-height:1.2; white-space:normal; display:flex; align-items:flex-start; gap:3px;" title="Landmark / Instructions: ${escapeHtml(nearestLandmark)}"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><span>${escapeHtml(nearestLandmark)}</span></div>`
      : "";

    const addressDisplayHtml = !isPickup && fullAddr && fullAddr !== "No delivery address recorded"
      ? `<div style="font-size:0.75rem; color:#6b7280; margin-top:3px; max-width:170px; line-height:1.2; white-space:normal;" title="${escapeHtml(fullAddr)}">${escapeHtml(fullAddr.length > 45 ? fullAddr.slice(0, 45) + '…' : fullAddr)}</div>${landmarkBadgeHtml}`
      : isPickup
        ? `<div style="font-size:0.75rem; color:#b45309; margin-top:3px;">Lanica Workshop</div>`
        : ``;

    // Financial Breakdown calculation
    const isAwaitingCounterDownpayment = order.paymentStatus === "awaiting_counter_downpayment";
    const totalVal = Number(order.totalAmount ?? order.total ?? 0);
    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounterDownpayment;
    const paidVal = isAwaitingCounterDownpayment
      ? Number(order.downpaymentPaid || 0)
      : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
    const remainingVal = Number(order.remainingBalance ?? order.balanceDue ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
    const isBalanceSettled = order.balanceStatus === "settled" || remainingVal <= 0;
    const paidPct = totalVal > 0 ? Math.round((paidVal / totalVal) * 100) : (isDownpayment ? (isAwaitingCounterDownpayment ? 0 : 30) : 100);

    const balanceBadgeHtml = isAwaitingCounterDownpayment
      ? `<span class="balance-badge pending" style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Counter DP Pending</span>`
      : `<span class="balance-badge ${isBalanceSettled ? "settled" : "pending"}" style="display:inline-flex; align-items:center; gap:3px;">${isBalanceSettled ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Settled' : '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Pending'}</span>`;

    const financialBreakdownHtml = `
      <div class="financial-breakdown-card">
        <div>Total: <strong class="fin-total">₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div>Upfront: <span class="fin-paid">₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> <small style="color:#6b7280;">(${paidPct}%)</small></div>
        <div>Due: <span class="fin-due">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        ${balanceBadgeHtml}
      </div>
    `;

    // Refund Status & Badges
    const isRefundRequested = order.refundStatus === "refund_requested" || order.status === "cancellation_pending_review";
    const isRefundCompleted = order.refundStatus === "refund_completed" || order.status === "refunded";
    const isRefundRejected = order.refundStatus === "refund_rejected";

    let refundBadgeHtml = "";
    if (isRefundRequested) {
      refundBadgeHtml = `<div><span class="refund-status-badge requested" style="display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>Refund Requested</span></div>`;
    } else if (isRefundCompleted) {
      refundBadgeHtml = `<div><span class="refund-status-badge completed" style="display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>Refunded (₱${Number(order.refundedAmount || paidVal).toLocaleString()})</span></div>`;
    } else if (isRefundRejected) {
      refundBadgeHtml = `<div><span class="refund-status-badge rejected" style="display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>Refund Rejected</span></div>`;
    }

    const displayStatusText = (st === "downpayment confirmed" || st === "accepted")
      ? "Deposit Verified"
      : (st === "slot reserved" ? "Slot Reserved" : (st.charAt(0).toUpperCase() + st.slice(1)));

    const statusColumnHtml = `
      <div>
        <span class="order-status-badge order-status-${escapeHtml(st.replace(/\s+/g, '-'))}">${escapeHtml(
          displayStatusText
        )}</span>
        ${refundBadgeHtml}
      </div>
    `;

    const isMarkSettledVisible = !isBalanceSettled && remainingVal > 0 && st !== "placed" && st !== "pending" && st !== "cancelled" && st !== "declined";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="${isBatchDeleteMode ? "" : "is-hidden"}">
        ${
          isBatchDeleteMode && (st === "declined" || st === "cancelled")
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
      <td class="order-items-cell"><div class="order-items-summary">${escapeHtml(formatOrderItemsSummary(order.items))}</div></td>
      <td>${financialBreakdownHtml}</td>
      <td>${statusColumnHtml}</td>
      <td>
        <select class="order-assign-select" data-order-id="${escapeHtml(order.id)}" aria-label="Assign staff" ${st === "delivered" || st === "cancelled" || st === "declined" || isRefundCompleted ? "disabled" : ""} style="padding: 6px 10px; border-radius: 6px; font-size: 0.82rem; border: 1.5px solid ${!order.assignedToUid ? '#f59e0b' : '#cbd5e1'}; background: ${!order.assignedToUid ? '#fffbeb' : '#ffffff'}; color: ${!order.assignedToUid ? '#b45309' : '#1e293b'}; font-weight: ${!order.assignedToUid ? '600' : '400'}; cursor: pointer;">
          <option value="" disabled ${!order.assignedToUid ? "selected" : ""}>Unassigned (Assign Staff)</option>
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
          <div class="kebab-dropdown-menu" style="display: none; position: absolute; right: 0; top: 36px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.12); z-index: 1000; min-width: 195px; padding: 6px; text-align: left;">
            <button type="button" class="kebab-menu-item btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #334155; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              View Order Summary
            </button>
            <button type="button" class="kebab-menu-item btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="voucher" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #2563eb; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              Payment Voucher
            </button>
            <button type="button" class="kebab-menu-item btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="quotation" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #0284c7; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>
              Official Quotation
            </button>
            ${
              isRefundRequested
                ? `<button type="button" class="kebab-menu-item btn-review-refund" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: #fef2f2; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                    Review Refund
                  </button>`
                : ""
            }
            ${
              isAwaitingCounterDownpayment
                ? `<button type="button" class="kebab-menu-item btn-receive-counter-downpayment" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: #ecfdf5; border: none; font-size: 0.82rem; font-weight: 600; color: #059669; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                    Receive Counter Downpayment
                  </button>`
                : ""
            }
            ${
              isMarkSettledVisible
                ? `<button type="button" class="kebab-menu-item btn-settle-balance" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #059669; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
                    Mark Balance Settled
                  </button>`
                : ""
            }
            ${
              st === "placed" || st === "pending"
                ? `<button type="button" class="kebab-menu-item btn-accept-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #16a34a; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Confirm Downpayment
                  </button>
                  <button type="button" class="kebab-menu-item btn-decline-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    Decline Order
                  </button>`
                : ""
            }
            ${
              st === "downpayment confirmed"
                ? `<button type="button" class="kebab-menu-item btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="In Production" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #2563eb; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                    Start Production
                  </button>`
                : ""
            }
            ${
              st === "in production"
                ? `<button type="button" class="kebab-menu-item btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Quality Checked" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #7c3aed; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    Pass Quality Check
                  </button>`
                : ""
            }
            ${
              st === "quality checked"
                ? `<button type="button" class="kebab-menu-item btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Shipped" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #d97706; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    Dispatch / Ship Order
                  </button>`
                : ""
            }
            ${
              st === "shipped"
                ? `<button type="button" class="kebab-menu-item btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Delivered" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #059669; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    Mark as Delivered
                  </button>`
                : ""
            }
            ${
              st === "declined" || st === "cancelled" || st === "delivered"
                ? `<button type="button" class="kebab-menu-item btn-delete-order" data-order-id="${escapeHtml(
                    order.id
                  )}" style="width: 100%; text-align: left; padding: 8px 12px; background: none; border: none; font-size: 0.82rem; font-weight: 600; color: #dc2626; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Delete Order
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
      <td class="order-items-cell"><div class="order-items-summary">${escapeHtml(formatOrderItemsSummary(order.items))}</div></td>
      <td>${totalStr}</td>
      <td>${escapeHtml(resolveAssignedStaffName(order))}</td>
      <td>${escapeHtml(getCompletedAtLabel(order))}</td>
    `;
    ordersHistoryListEl.appendChild(tr);
  });
}

async function deductStockForLine(transaction, productId, item) {
  if (!productId) return;
  try {
    const productRef = doc(db, "products", productId);
    const pSnap = await transaction.get(productRef);
    if (!pSnap.exists()) return;
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
        lea = Math.max(0, lea - qty);
      } else if (mat === "fabric") {
        fab = Math.max(0, fab - qty);
      } else {
        if (fab >= qty) fab -= qty;
        else if (lea >= qty) lea -= qty;
        else fab = Math.max(0, fab - qty);
      }
      const combined = fab + lea;
      transaction.update(productRef, {
        fabricStock: fab,
        leatherStock: lea,
        stock: combined,
      });
    } else if (d.stock !== undefined) {
      let s = Number(d.stock) || 0;
      transaction.update(productRef, { stock: Math.max(0, s - qty) });
    }
  } catch (err) {
    console.warn("Gracefully skipping stock deduction for line:", err);
  }
}

function getStatusNotificationMessage(orderId, newStatus) {
  const norm = normalizeOrderStatus(newStatus);
  const ref = orderId ? `#${String(orderId).slice(0, 8)}` : "your order";
  switch (norm) {
    case "slot reserved":
      return `✨ Order Reservation Confirmed (${ref}): Your reservation has been recorded. Our workshop team will review your custom specifications.`;
    case "downpayment confirmed":
      return `💰 Deposit Confirmed (${ref}): 30% downpayment received and verified. Your order is now queued for workshop fabrication!`;
    case "in production":
      return `🔨 In Production (${ref}): Our master artisans have officially begun woodworking, assembly, and upholstery for your handcrafted furniture!`;
    case "quality checked":
      return `🔍 Quality Inspection Passed (${ref}): Your custom furniture has passed final workshop quality control and is being packaged for dispatch!`;
    case "shipped":
      return `🚚 Out for Delivery (${ref}): Your order has been dispatched with our logistics team and is on its way to your delivery address!`;
    case "delivered":
      return `🎉 Order Delivered (${ref}): Your handcrafted furniture has arrived! Please inspect your piece and tap "Order Received" in your orders page to finalize.`;
    case "completed":
      return `🎉 Order Completed (${ref}): Thank you for trusting Lanica Furniture! Your official receipt is ready in your Completed Transactions History.`;
    case "cancelled":
      return `❌ Order Cancelled (${ref}): This order has been cancelled. Please contact workshop support if you need assistance.`;
    default:
      return `📢 Status Update (${ref}): Your order status is now ${newStatus.toUpperCase()}.`;
  }
}

async function broadcastOrderStatusUpdate(orderId, newStatus) {
  if (!orderId || !newStatus) return;
  const orderDocRef = doc(db, "orders", orderId);
  const now = serverTimestamp();
  const textMsg = getStatusNotificationMessage(orderId, newStatus);

  const payload = {
    text: textMsg,
    message: textMsg,
    content: textMsg,
    sender: "system",
    senderId: "system",
    senderName: "Lanica System",
    senderRole: "system",
    role: "system",
    isSystem: true,
    type: 0,
    timestamp: now,
    createdAt: now,
  };

  try {
    const webCol = collection(db, "orders", orderId, "messages");
    await addDoc(webCol, payload);
  } catch (err) {
    console.warn("Could not write status update to orders/{id}/messages:", err);
  }

  try {
    const mobileCol = collection(db, "order_chats", orderId, "messages");
    await addDoc(mobileCol, payload);
  } catch (err) {
    console.warn("Could not write status update to order_chats/{id}/messages:", err);
  }

  try {
    await updateDoc(orderDocRef, {
      lastMessage: textMsg,
      lastMessageAt: now,
      lastSenderRole: "system",
      lastSenderName: "Lanica System",
    });
  } catch (_) {}
}

async function handleOrderStatusChange(orderId, newStatus) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  const next = normalizeOrderStatus(newStatus);
  if (prev === next) return;

  // Enterprise Workflow Rule: Order cannot proceed into production or fulfillment without an assigned artisan/staff member
  const requiresStaffAssignment = ["in production", "quality checked", "shipped", "delivered"].includes(next);
  if (requiresStaffAssignment && !current.assignedToUid) {
    showAdminToast(
      `Assignment Required: Please assign a staff artisan or team member to Order #${orderId.slice(0, 8)} before advancing to "${next.charAt(0).toUpperCase() + next.slice(1)}".`,
      "warning"
    );
    const assignSelect = ordersListEl?.querySelector(`.order-assign-select[data-order-id="${orderId}"]`);
    if (assignSelect) {
      assignSelect.focus();
      assignSelect.style.outline = "2px solid #f59e0b";
      assignSelect.style.boxShadow = "0 0 0 3px rgba(245, 158, 11, 0.25)";
      setTimeout(() => {
        assignSelect.style.outline = "";
        assignSelect.style.boxShadow = "";
      }, 3500);
    }
    applyOrdersFilter();
    return;
  }

  const items = Array.isArray(current.items) ? current.items : [];

  const shouldDeductStock =
    (prev === "downpayment confirmed" || prev === "accepted") &&
    (next === "in production" || next === "processing") &&
    !current.stockDeducted &&
    items.length > 0;

  if (shouldDeductStock) {
    try {
      await runTransaction(db, async (transaction) => {
        const oSnap = await transaction.get(orderRef);
        if (!oSnap.exists()) throw new Error("Order missing");
        const oData = oSnap.data();
        if (oData.stockDeducted) return;
        for (const it of items) {
          if (it.productId) {
            await deductStockForLine(transaction, it.productId, it);
          }
        }
        transaction.update(orderRef, {
          status: next,
          orderStatus: next,
          stockDeducted: true,
          updatedAt: Timestamp.now(),
        });
      });
      broadcastOrderStatusUpdate(orderId, next).catch((err) => console.warn("Broadcast update err:", err));
      showAdminToast(`Order status updated to In Production (Crafting Started).`, "success");
    } catch (e) {
      console.error(e);
      // Even if inventory update encounters issues, do not block made-to-order production!
      await updateDoc(orderRef, {
        status: next,
        orderStatus: next,
        stockDeducted: true,
        updatedAt: serverTimestamp(),
      });
      broadcastOrderStatusUpdate(orderId, next).catch((err) => console.warn("Broadcast update err:", err));
      showAdminToast(`Order advanced to In Production.`, "success");
    }
    return;
  }

  try {
    await updateDoc(orderRef, {
      status: next,
      orderStatus: next,
      updatedAt: serverTimestamp(),
    });
    broadcastOrderStatusUpdate(orderId, next).catch((err) => console.warn("Broadcast update err:", err));
    await recordAuditLog({
      action: "ORDER_STATUS_CHANGED",
      targetType: "order",
      targetId: orderId,
      description: `Updated status for order #${orderId.slice(0, 8)} (${current.orderNumber || orderId}) from "${prev}" to "${next}"`,
      diff: {
        before: { status: current.status, orderStatus: current.orderStatus || prev },
        after: { status: next, orderStatus: next },
      },
      performedBy: currentUser,
    });
    showAdminToast(`Order status updated to ${next.charAt(0).toUpperCase() + next.slice(1)}.`, "success");
  } catch (e) {
    console.error(e);
    showAdminToast("Failed to update order status.", "error");
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
    showAdminToast("This order has no items.", "warning");
    return;
  }

  const confirmed = await showAdminConfirmModal({
    title: "Confirm Downpayment & Order",
    message: `Accept and confirm downpayment for Order <strong>#${orderId.slice(0, 8)}</strong>?`,
    confirmText: "Confirm Order",
    cancelText: "Cancel",
    confirmType: "success",
    icon: "✓",
  });
  if (!confirmed) return;

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
        acceptedAt: serverTimestamp(),
        acceptedByUid: currentUser ? currentUser.uid : null,
        updatedAt: serverTimestamp(),
      });
    });
    await recordAuditLog({
      action: "ORDER_ACCEPTED",
      targetType: "order",
      targetId: orderId,
      description: `Accepted order #${orderId.slice(0, 8)} (${current.orderNumber || orderId}) and confirmed reservation downpayment`,
      diff: {
        before: { status: current.status, orderStatus: current.orderStatus || prev },
        after: { status: "downpayment confirmed", orderStatus: "downpayment confirmed" },
      },
      performedBy: currentUser,
    });
    console.log(`Accepted order ${orderId} -> downpayment confirmed`);
    showAdminToast(`Order #${orderId.slice(0, 8)} downpayment confirmed!`, "success");
  } catch (e) {
    console.error("Order accept error:", e);
    showAdminToast(e.message || "Could not accept order.", "error");
  }
}

async function handleOrderDecline(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  if (prev !== "placed" && prev !== "pending") return;

  const confirmed = await showAdminConfirmModal({
    title: "Decline Order",
    message: `Are you sure you want to decline Order <strong>#${orderId.slice(0, 8)}</strong>?`,
    confirmText: "Yes, Decline Order",
    cancelText: "Cancel",
    confirmType: "danger",
    icon: "✕",
  });
  if (!confirmed) return;

  try {
    await updateDoc(orderRef, {
      status: "declined",
      orderStatus: "declined",
      declinedAt: serverTimestamp(),
      declinedByUid: currentUser ? currentUser.uid : null,
      updatedAt: serverTimestamp(),
    });
    await recordAuditLog({
      action: "ORDER_STATUS_CHANGED",
      targetType: "order",
      targetId: orderId,
      description: `Declined order #${orderId.slice(0, 8)} (${current.orderNumber || orderId})`,
      diff: {
        before: { status: current.status, orderStatus: current.orderStatus || prev },
        after: { status: "declined", orderStatus: "declined" },
      },
      performedBy: currentUser,
    });
    console.log(`Declined order ${orderId}`);
    showAdminToast(`Order #${orderId.slice(0, 8)} has been declined.`, "info");
  } catch (e) {
    console.error("Order decline error:", e);
    showAdminToast(e.message || "Could not decline order.", "error");
  }
}

async function handleDeleteOrder(orderId) {
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const st = normalizeOrderStatus(current.status);
  if (st !== "declined" && st !== "cancelled" && st !== "delivered") {
    showAdminToast("Only cancelled, declined, or delivered orders can be deleted.", "warning");
    return;
  }

  const confirmed = await showAdminConfirmModal({
    title: "Delete Order",
    message: `Are you sure you want to delete Order <strong>#${orderId.slice(0, 8)}</strong>?<br><br><span style="color:#6b7280;">This record will be safely archived and hidden from customer and admin tables.</span>`,
    confirmText: "Yes, Delete Order",
    cancelText: "Cancel",
    confirmType: "danger",
    icon: "delete",
  });
  if (!confirmed) return;

  try {
    await updateDoc(doc(db, "orders", orderId), {
      isDeleted: true,
      deletedBy: currentUser?.uid || "admin",
      deletedByEmail: currentUser?.email || "",
      deletedByName: currentUser?.displayName || "Admin Staff",
      deletedAt: serverTimestamp(),
      action: "delete",
      updatedAt: serverTimestamp(),
    });

    await recordAuditLog({
      action: "ORDER_DELETED",
      targetType: "order",
      targetId: orderId,
      description: `Soft-deleted order #${orderId.slice(0, 8)} (${current.orderNumber || orderId}) with status "${st}"`,
      diff: {
        before: {
          status: current.status,
          paymentStatus: current.paymentStatus,
          isDeleted: false,
        },
        after: {
          status: current.status,
          paymentStatus: current.paymentStatus,
          isDeleted: true,
          deletedBy: currentUser?.uid || "admin",
        },
      },
      performedBy: currentUser,
    });

    allOrders = allOrders.filter((o) => o.id !== orderId);
    selectedDeclinedOrderIds.delete(orderId);
    applyOrdersFilter();
    syncBatchDeleteUi();
    showAdminToast(`Order #${orderId.slice(0, 8)} has been deleted.`, "success");
  } catch (e) {
    console.error("Order delete error:", e);
    showAdminToast(e.message || "Could not delete this order.", "error");
  }
}

const handleDeclinedOrderDelete = handleDeleteOrder;

async function handleOrderAssign(orderId, staffUid) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  const staff = staffMembers.find((s) => s.uid === staffUid);

  if (!staffUid || !staff) {
    showAdminToast("Please select a valid staff member to assign.", "warning");
    applyOrdersFilter();
    return;
  }

  const staffName = staff.displayName || staff.name || "Staff Member";
  const prevAssignedName = current?.assignedToName || (current?.assignedToUid ? "Previous Staff" : "Unassigned");

  try {
    await updateDoc(orderRef, {
      assignedToUid: staffUid,
      assignedToName: staffName,
      updatedAt: serverTimestamp(),
    });

    if (current) {
      current.assignedToUid = staffUid;
      current.assignedToName = staffName;
    }

    await recordAuditLog({
      action: "SETTINGS_CHANGED",
      targetType: "order",
      targetId: orderId,
      description: `Assigned Order #${orderId.slice(0, 8)} to artisan/staff: ${staffName} (previously ${prevAssignedName})`,
      diff: {
        before: { assignedToUid: current?.assignedToUid || null, assignedToName: prevAssignedName },
        after: { assignedToUid: staffUid, assignedToName: staffName },
      },
      performedBy: currentUser,
    });

    showAdminToast(`Assigned Order #${orderId.slice(0, 8)} to ${staffName}.`, "success");
    applyOrdersFilter();
  } catch (e) {
    console.error("Order assignment failed:", e);
    showAdminToast("Failed to assign staff member: " + (e.message || ""), "error");
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

    if (actionBtn.classList.contains("btn-view-order-details")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) showOrderSummaryModal(id);
    }
    if (actionBtn.classList.contains("btn-open-lanica-receipt")) {
      const id = actionBtn.getAttribute("data-order-id");
      const defaultTab = actionBtn.getAttribute("data-default-tab") || "voucher";
      if (id && typeof openLanicaReceiptModal === "function") {
        openLanicaReceiptModal(id, defaultTab);
      }
    }
    if (actionBtn.classList.contains("btn-receive-counter-downpayment")) {
      const id = actionBtn.getAttribute("data-order-id");
      if (id) handleReceiveCounterDownpayment(id);
    }
    if (actionBtn.classList.contains("btn-advance-status")) {
      const id = actionBtn.getAttribute("data-order-id");
      const nextStatus = actionBtn.getAttribute("data-next-status");
      if (id && nextStatus) handleOrderStatusChange(id, nextStatus);
    }
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
      if (id) handleDeleteOrder(id);
    }
  });
}

async function showOrderSummaryModal(orderId) {
  if (!orderId) return;

  let order = Array.isArray(allOrders)
    ? allOrders.find(
        (o) =>
          o.id === orderId ||
          o.orderId === orderId ||
          String(o.orderNumber) === String(orderId)
      )
    : null;

  if (!order) {
    try {
      const snap = await getDoc(doc(db, "orders", orderId));
      if (snap.exists()) {
        order = { id: snap.id, ...snap.data() };
      } else {
        const q = query(collection(db, "orders"), where("orderId", "==", String(orderId)));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          order = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      }
    } catch (err) {
      console.warn("Could not fetch order for summary modal:", err);
    }
  }

  if (!order) {
    showToast("Order details could not be found.", "error");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal active";
  modal.style.cssText = "position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px;";

  const isPickup =
    order.fulfillmentType === "pickup" ||
    order.address?.pickupAtWorkshop ||
    order.shippingAddress?.pickupAtWorkshop;
  const customerName = resolveCustomerDisplay(order);
  const phone = formatOrderRecipientPhone(order);
  const fullAddress = formatOrderDeliveryAddress(order);
  const landmark = isPickup ? "" : formatOrderLandmark(order);

  const proofUrl = pickFirstNonEmpty(order.proofUrl, order.paymentProof, order.paymentProofUrl, "");

  const itemsListHtml = (order.items || [])
    .map(
      (item) => `
      <div style="display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <img src="${item.url || 'assets/product_sofa.png'}" alt="${escapeHtml(item.name || 'Item')}" style="width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0;" onerror="this.onerror=null;this.src='assets/product_sofa.png';">
        <div style="flex: 1;">
          <strong style="color: #0f172a; font-size: 0.9rem;">${escapeHtml(item.name || item.title || "Item")}</strong>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">Variant / Material: <strong>${escapeHtml(item.material || "Standard")}</strong> &bull; Qty: <strong>${item.quantity || 1}</strong></div>
          ${item.customNotes ? `<div style="font-size: 0.76rem; color: #b45309; background: #fffbeb; border: 1px solid #fef3c7; padding: 4px 8px; border-radius: 6px; margin-top: 4px; line-height: 1.3;"><strong>Custom Specs:</strong> ${escapeHtml(item.customNotes)}</div>` : ""}
        </div>
        <strong style="color: #0f172a; font-size: 0.92rem;">₱${((parseItemPrice(item.price)) * Number(item.quantity || 1)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      </div>
    `
    )
    .join("");

  const totalVal = Number(order.totalAmount || order.total || 0);
  const isAwaitingCounterDownpayment = order.paymentStatus === "awaiting_counter_downpayment";
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounterDownpayment;
  const paidVal = isAwaitingCounterDownpayment
    ? Number(order.downpaymentPaid || 0)
    : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
  const remainingVal = Number(order.remainingBalance ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
  const canonicalStatus = getOrderCanonicalStatus(order);

  modal.innerHTML = `
    <div style="background: #ffffff; border-radius: 16px; max-width: 580px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">
        <div>
          <h3 style="margin: 0; font-size: 1.2rem; color: #0f172a;">Order Summary #${escapeHtml(String(order.orderId || order.id || "").slice(0, 8))}</h3>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 3px;">Placed on ${formatOrderDate(order.createdAt)}</div>
        </div>
        <button type="button" class="btn-close-modal" style="background: #f1f5f9; border: none; font-size: 1.2rem; cursor: pointer; color: #64748b; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">&times;</button>
      </div>

      <div style="background: #f8fafc; padding: 14px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 0.85rem; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 6px;">
        <div><strong>Customer Name:</strong> ${escapeHtml(resolveCustomerDisplay(order))} ${phone !== "—" ? `(${escapeHtml(phone)})` : ""}</div>
        <div><strong>Delivery Address:</strong> ${escapeHtml(fullAddress)}</div>
        ${landmark ? `<div style="color: #b45309; background: #fffbeb; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><strong>Landmark:</strong> ${escapeHtml(landmark)}</div>` : ""}
        <div><strong>Current Status:</strong> <span style="font-weight: 600; color: #1e293b; background: #e2e8f0; padding: 2px 8px; border-radius: 4px;">${escapeHtml(canonicalStatus)}</span></div>
        <div><strong>Payment Method:</strong> ${escapeHtml(order.paymentMethod === "walk_in_cash" || order.paymentMethod === "cash" || String(order.paymentMethod || "").toLowerCase().includes("counter") ? "Cash (Counter)" : "QR Ph (PayMongo)")}</div>
      </div>

      ${proofUrl ? `
        <div style="margin-bottom: 16px; padding: 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px;">
          <div style="font-size: 0.82rem; font-weight: 600; color: #6b21a8; margin-bottom: 6px;">Payment Verification Screenshot</div>
          <a href="${proofUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block;">
            <img src="${proofUrl}" alt="Proof of Payment" style="max-height: 140px; border-radius: 8px; border: 1px solid #d8b4fe; object-fit: contain;">
          </a>
        </div>
      ` : ""}

      <h4 style="margin: 0 0 8px; font-size: 0.95rem; color: #334155;">Ordered Items Breakdown</h4>
      <div style="margin-bottom: 16px;">${itemsListHtml || "<p style='color:#94a3b8;'>No items listed.</p>"}</div>

      <div style="border-top: 2px solid #e2e8f0; padding-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; background: #f8fafc; padding: 12px 16px; border-radius: 10px;">
        <div style="display: flex; justify-content: space-between;"><span>Contract Total:</span><strong>₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div style="display: flex; justify-content: space-between; color: #059669;"><span>Amount Paid:</span><strong>₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div style="display: flex; justify-content: space-between; color: ${remainingVal > 0 ? "#dc2626" : "#64748b"};"><span>Balance Remaining:</span><strong>₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      </div>

      <div style="margin-top: 20px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn-summary-open-voucher" data-order-id="${escapeHtml(
          order.id
        )}" style="padding: 10px 16px; cursor: pointer; border-radius: 8px; background: #2563eb; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; touch-action: manipulation;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
          Payment Voucher
        </button>
        <button type="button" class="btn-summary-open-quotation" data-order-id="${escapeHtml(
          order.id
        )}" style="padding: 10px 16px; cursor: pointer; border-radius: 8px; background: #0284c7; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; touch-action: manipulation;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>
          Official Quotation
        </button>
        ${
          order.paymentStatus === "awaiting_counter_downpayment"
            ? `<button type="button" class="btn-summary-receive-counter-downpayment" data-order-id="${escapeHtml(
                order.id
              )}" style="padding: 10px 18px; cursor: pointer; border-radius: 8px; background: #059669; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; touch-action: manipulation;">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                Receive Counter Downpayment
              </button>`
            : ""
        }
        <button type="button" class="btn-close-modal btn-primary" style="padding: 10px 24px; cursor: pointer; border-radius: 8px; background: #0f172a; color: white; border: none; font-weight: 600; touch-action: manipulation;">Close Summary</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const sumVoucherBtn = modal.querySelector(".btn-summary-open-voucher");
  if (sumVoucherBtn) {
    sumVoucherBtn.addEventListener("click", () => {
      modal.remove();
      if (typeof openLanicaReceiptModal === "function") {
        openLanicaReceiptModal(order.id, "voucher");
      }
    });
  }

  const sumQuotationBtn = modal.querySelector(".btn-summary-open-quotation");
  if (sumQuotationBtn) {
    sumQuotationBtn.addEventListener("click", () => {
      modal.remove();
      if (typeof openLanicaReceiptModal === "function") {
        openLanicaReceiptModal(order.id, "quotation");
      }
    });
  }

  const receiveBtn = modal.querySelector(".btn-summary-receive-counter-downpayment");
  if (receiveBtn) {
    receiveBtn.addEventListener("click", () => {
      modal.remove();
      handleReceiveCounterDownpayment(order.id);
    });
  }

  modal.querySelectorAll(".btn-close-modal").forEach((btn) => {
    btn.addEventListener("click", () => modal.remove());
  });
  // Backdrop click dismissal disabled to avoid accidental close on phone
}

async function handleReceiveCounterDownpayment(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const totalAmount = Number(current.totalAmount || current.total || 0);
  const downpaymentRequired = Number(current.downpaymentRequired ?? Math.round(totalAmount * 0.30));

  const confirmed = await showAdminConfirmModal({
    title: "Receive Counter Downpayment",
    message: `Confirm receipt of 30% counter cash downpayment of <strong>₱${downpaymentRequired.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> for Order <strong>#${orderId.slice(0, 8)}</strong>?<br><br>The order status will advance to <strong>Deposit Verified</strong>. You can then assign a staff artisan and proceed to In Production.`,
    confirmText: "Yes, Confirm Receipt",
    cancelText: "Cancel",
    confirmType: "success",
    icon: "payment",
  });
  if (!confirmed) return;

  try {
    await updateDoc(orderRef, {
      paymentStatus: "downpayment_paid",
      downpaymentPaid: downpaymentRequired,
      orderStatus: "downpayment confirmed",
      status: "downpayment confirmed",
      downpaymentPaidAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await recordAuditLog({
      action: "DOWNPAYMENT_RECEIVED",
      targetType: "order",
      targetId: orderId,
      description: `Marked 30% Downpayment (₱${downpaymentRequired.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) received via Counter Cash for Order #${orderId.slice(0, 8)}. Status updated to Deposit Verified.`,
      diff: {
        before: {
          orderStatus: current.orderStatus || current.status || "slot_reserved",
          paymentStatus: current.paymentStatus || "awaiting_counter_downpayment",
          downpaymentPaid: current.downpaymentPaid || 0,
        },
        after: {
          orderStatus: "downpayment confirmed",
          paymentStatus: "downpayment_paid",
          downpaymentPaid: downpaymentRequired,
          status: "downpayment confirmed",
        },
      },
      performedBy: currentUser,
    });

    console.log(`Received counter downpayment for order ${orderId} -> downpayment confirmed (Deposit Verified)`);
    showAdminToast(`Counter downpayment of ₱${downpaymentRequired.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded! Order status is now Deposit Verified.`, "success");
  } catch (e) {
    console.error("Counter downpayment confirmation error:", e);
    showAdminToast(e.message || "Could not record counter downpayment.", "error");
  }
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
      showAdminToast("Transaction Reference ID is required for audit & refund approval.", "warning");
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

      showAdminToast(`Refund for Order #${currentRefundOrderId} approved and marked completed!`, "success");
      closeRefundModal();
    } catch (err) {
      console.error("Failed to approve refund:", err);
      showAdminToast(err.message || "Failed to process refund.", "error");
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

    const confirmed = await showAdminConfirmModal({
      title: "Reject Refund Request",
      message: `Are you sure you want to reject the refund request for Order <strong>#${currentRefundOrderId}</strong>?`,
      confirmText: "Yes, Reject Refund",
      cancelText: "Cancel",
      confirmType: "danger",
      icon: "✕",
    });
    if (!confirmed) return;

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

      showAdminToast(`Refund request for Order #${currentRefundOrderId} has been rejected.`, "info");
      closeRefundModal();
    } catch (err) {
      console.error("Failed to reject refund:", err);
      showAdminToast(err.message || "Failed to reject refund request.", "error");
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

  const confirmed = await showAdminConfirmModal({
    title: "Mark Balance Settled",
    message: `Mark remaining balance of <strong>₱${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> as settled in cash for Order <strong>#${orderId.slice(0, 8)}</strong>?`,
    confirmText: "Confirm Settled",
    cancelText: "Cancel",
    confirmType: "success",
    icon: "payment",
  });
  if (!confirmed) return;

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
    showAdminToast(`Balance of ₱${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} marked as settled.`, "success");
  } catch (err) {
    console.error("Failed to settle balance:", err);
    showAdminToast(err.message || "Could not mark balance settled.", "error");
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
    await handleOrderStatusChange(orderId, nextStatus);
    console.log(`Advanced order ${orderId} to ${nextStatus}`);
  } catch (err) {
    console.error("Failed to advance crafting stage:", err);
    showToast(err.message || "Failed to update order status.", "error");
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
      <div style="font-weight: 700; color: #f87171; font-size: 0.74rem; text-transform: uppercase; margin-bottom: 2px; display: flex; align-items: center; gap: 5px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> New Customer Message</div>
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
  const dashBadge = document.getElementById("dash-chat-badge");
  const dashWidgetCount = document.getElementById("dash-widget-chat-count");
  const unreadFilterBadge = document.getElementById("admin-chat-unread-filter-badge");

  const countStr = totalUnread > 99 ? "99+" : String(totalUnread);
  if (navBadge) {
    if (totalUnread > 0) {
      navBadge.textContent = countStr;
      navBadge.style.display = "inline-block";
    } else {
      navBadge.style.display = "none";
    }
  }
  if (dashBadge) {
    if (totalUnread > 0) {
      dashBadge.textContent = countStr;
      dashBadge.style.display = "inline-block";
    } else {
      dashBadge.style.display = "none";
    }
  }
  if (unreadFilterBadge) {
    unreadFilterBadge.textContent = String(totalUnread);
  }
  if (dashWidgetCount) {
    dashWidgetCount.textContent = totalUnread > 0 ? `${countStr} Unread` : `${allChatSessions.length} Active`;
    dashWidgetCount.style.background = totalUnread > 0 ? "#fef2f2" : "#eff6ff";
    dashWidgetCount.style.color = totalUnread > 0 ? "#dc2626" : "#2563eb";
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

  // Detect if rawText is an image URL (Firebase Storage or direct image file)
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

  // If rawText matches mediaUrl or is purely an image URL, do not show the raw URL string as text
  let displayText = rawText;
  if (mediaUrl && (displayText === mediaUrl || isImageTarget)) {
    displayText = "";
  }

  return { mediaUrl, displayText };
}

function setupAdminLiveChat() {
  const sessionsListEl = document.getElementById("admin-chat-sessions-list");
  const messagesEl = document.getElementById("admin-chat-messages");
  const customerNameEl = document.getElementById("admin-chat-customer-name");
  const customerEmailEl = document.getElementById("admin-chat-customer-email");
  const chatForm = document.getElementById("admin-chat-form");
  const chatInput = document.getElementById("admin-chat-input");
  const chatSubmitBtn = document.getElementById("admin-chat-submit-btn");
  const chatHeaderActions = document.getElementById("admin-chat-header-actions");
  const chatViewOrderBtn = document.getElementById("admin-chat-view-order-btn");
  const chatTotalCount = document.getElementById("admin-chat-total-count");
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
          showToast("Attachment must be under 5MB.", "warning");
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
  const filterUnreadBtn = document.getElementById("admin-chat-filter-unread");
  const filterSupportBtn = document.getElementById("admin-chat-filter-support");
  const filterOrdersBtn = document.getElementById("admin-chat-filter-orders");
  const filterClosedBtn = document.getElementById("admin-chat-filter-closed");

  // Reply Quoting State
  let activeReplyingMessage = null;
  const replyPreviewEl = document.getElementById("admin-chat-reply-preview");
  const replySenderEl = document.getElementById("admin-chat-reply-sender");
  const replySnippetEl = document.getElementById("admin-chat-reply-snippet");
  const cancelReplyBtn = document.getElementById("admin-chat-cancel-reply");

  function setReplyingMessage(m) {
    activeReplyingMessage = m;
    if (replyPreviewEl && replySenderEl && replySnippetEl) {
      if (m) {
        const { mediaUrl, displayText } = parseChatMessageContent(m);
        const snippet = displayText || (mediaUrl ? "[Photo Attachment]" : "Message");
        replySenderEl.textContent = m.senderName || (m.senderRole === "admin" || m.senderRole === "staff" ? "Lanica Workshop" : "Customer");
        replySnippetEl.textContent = `"${snippet.slice(0, 65)}${snippet.length > 65 ? "..." : ""}"`;
        replyPreviewEl.style.display = "flex";
        if (chatInput) chatInput.focus();
      } else {
        replyPreviewEl.style.display = "none";
      }
    }
  }

  if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener("click", () => setReplyingMessage(null));
  }

  function renderAvatarHtml(photoURL, name, isSupport = false, size = 36) {
    const nameParts = (name || "Customer").trim().split(/\s+/);
    const initials = nameParts.length > 1
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : (nameParts[0].slice(0, 2)).toUpperCase();

    const bg = isSupport ? "#fef3c7" : "#f1f5f9";
    const fg = isSupport ? "#92400e" : "#334155";
    const border = isSupport ? "#fde68a" : "#e2e8f0";

    const fallback = `<span style="display: ${photoURL ? "none" : "flex"}; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: ${Math.round(size * 0.38)}px; font-weight: 700; color: ${fg}; user-select: none;">${escapeHtml(initials)}</span>`;

    if (photoURL && (photoURL.startsWith("http://") || photoURL.startsWith("https://") || photoURL.startsWith("data:"))) {
      return `
        <div style="width: ${size}px; height: ${size}px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: ${bg}; border: 1.5px solid ${border}; position: relative; display: flex; align-items: center; justify-content: center;">
          <img src="${escapeHtml(photoURL)}" alt="${escapeHtml(name)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
          ${fallback}
        </div>
      `;
    }

    return `
      <div style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${bg}; border: 1.5px solid ${border}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <span style="font-size: ${Math.round(size * 0.38)}px; font-weight: 700; color: ${fg}; user-select: none;">${escapeHtml(initials)}</span>
      </div>
    `;
  }

  function setChatFilter(filter) {
    currentChatFilter = filter;
    [filterAllBtn, filterUnreadBtn, filterSupportBtn, filterOrdersBtn, filterClosedBtn].forEach((btn) => {
      if (!btn) return;
      btn.classList.remove("active");
      btn.removeAttribute("data-active");
    });
    const activeBtn =
      filter === "unread"
        ? filterUnreadBtn
        : filter === "support"
        ? filterSupportBtn
        : filter === "orders"
        ? filterOrdersBtn
        : filter === "closed"
        ? filterClosedBtn
        : filterAllBtn;
    if (activeBtn) {
      activeBtn.classList.add("active");
      activeBtn.setAttribute("data-active", "true");
    }
    renderChatSessionsList(allChatSessions);
  }

  if (filterAllBtn) filterAllBtn.addEventListener("click", () => setChatFilter("all"));
  if (filterUnreadBtn) filterUnreadBtn.addEventListener("click", () => setChatFilter("unread"));
  if (filterSupportBtn) filterSupportBtn.addEventListener("click", () => setChatFilter("support"));
  if (filterOrdersBtn) filterOrdersBtn.addEventListener("click", () => setChatFilter("orders"));
  if (filterClosedBtn) filterClosedBtn.addEventListener("click", () => setChatFilter("closed"));

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
          const { mediaUrl, displayText } = parseChatMessageContent(latestMsg);
          const textPreview = displayText || (mediaUrl ? "[Photo Attachment]" : "No message text");

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
          const { mediaUrl, displayText } = parseChatMessageContent(latestMsg || {});
          const preview = displayText || (mediaUrl ? "Sent a photo attachment" : "Sent a message");
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

    // Filter by active category tab (exclude closed threads from active tabs)
    let filteredSessions = sessions.filter((s) => {
      if (currentChatFilter === "closed") {
        return Boolean(s.isClosed);
      }
      if (s.isClosed) return false;

      if (currentChatFilter === "unread") return (sessionUnreadCounts.get(s.id) || 0) > 0;
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

    if (chatTotalCount) {
      if (adminChatSearchQuery || currentChatFilter !== "all") {
        chatTotalCount.textContent = `${filteredSessions.length} / ${sessions.length}`;
      } else {
        chatTotalCount.textContent = `${sessions.length} Chats`;
      }
    }

    if (filteredSessions.length === 0) {
      if (adminChatSearchQuery) {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">No conversations found matching "${escapeHtml(adminChatSearchQuery)}".</div>`;
      } else {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">No ${
          currentChatFilter === "unread"
            ? "unread"
            : currentChatFilter === "support"
            ? "general live support"
            : currentChatFilter === "orders"
            ? "order crafting"
            : currentChatFilter === "closed"
            ? "closed / archived"
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
      item.className = `chat-session-item ${isSelected ? "is-selected" : ""} ${unreadCount > 0 ? "has-unread" : ""}`;
      item.setAttribute("data-session-id", s.id);

      item.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-start;">
          ${renderAvatarHtml(s.photoURL, s.customerName, isSupport, 38)}
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <strong style="font-size: 0.84rem; color: ${unreadCount > 0 ? "#0f172a" : "#1e293b"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 175px;">
                ${escapeHtml(s.customerName || "Customer")}
              </strong>
              <span style="font-size: 0.70rem; color: #94a3b8; flex-shrink: 0;">${timeStr}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
              ${
                isSupport
                  ? `<span style="font-size: 0.66rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 3px;"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Support</span>`
                  : `<span style="font-size: 0.66rem; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; display: inline-flex; align-items: center; gap: 3px;"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>#${escapeHtml(s.orderId || s.id)}</span>`
              }
              <span style="font-size: 0.66rem; padding: 1px 5px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 500;">
                ${escapeHtml(s.status || (isSupport ? "Active" : "Placed"))}
              </span>
              ${
                s.isClosed
                  ? `<span style="font-size: 0.66rem; padding: 1px 5px; border-radius: 4px; background: #f3f4f6; color: #64748b; font-weight: 600;">Closed</span>`
                  : ""
              }
              ${
                unreadCount > 0
                  ? `<span style="margin-left: auto; background: #ef4444; color: #ffffff; font-size: 0.68rem; font-weight: 700; padding: 1px 6px; border-radius: 9999px; line-height: 1.2;">${unreadCount}</span>`
                  : ""
              }
            </div>
            <div style="font-size: 0.76rem; color: ${
              unreadCount > 0 ? "#0f172a" : "#64748b"
            }; font-weight: ${
              unreadCount > 0 ? "600" : "400"
            }; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${unreadCount > 0 ? '<span style="color: #ef4444; margin-right: 3px;">●</span>' : ""}${escapeHtml(displayMessage)}
            </div>
          </div>
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
  const activeAvatarEl = document.getElementById("admin-chat-active-avatar");
  const optionsMenuBtn = document.getElementById("admin-chat-options-menu-btn");
  const optionsDropdown = document.getElementById("admin-chat-options-dropdown");
  const archiveActionBtn = document.getElementById("admin-chat-action-archive");
  const archiveText = document.getElementById("admin-chat-archive-text");
  const deleteActionBtn = document.getElementById("admin-chat-action-delete");

  if (mobileBackBtn && chatWorkspaceEl) {
    mobileBackBtn.addEventListener("click", () => {
      chatWorkspaceEl.classList.remove("mobile-chat-open");
    });
  }

  // Close dropdown on click outside
  document.addEventListener("click", (e) => {
    if (optionsDropdown && !e.target.closest(".messenger-header-dropdown-wrap")) {
      optionsDropdown.style.display = "none";
    }
  });

  let adminChatVisibleLimit = 20;

  function selectChatSession(session) {
    activeChatSessionId = session.id;
    adminChatVisibleLimit = 20; // Default to 20 messages batch
    const isSupport = session.sessionType === "support";
    setReplyingMessage(null);

    if (chatWorkspaceEl) {
      chatWorkspaceEl.classList.add("mobile-chat-open");
    }

    // Immediately clear unread status for this session
    sessionUnreadCounts.set(session.id, 0);
    updateAdminNavChatBadge();
    markOrderMessagesAsRead(session.id, "admin", isSupport);

    // Enable chat input & submit button
    if (chatInput) {
      chatInput.disabled = false;
      chatInput.style.background = "#ffffff";
      chatInput.placeholder = session.isArchived || session.isClosed
        ? "Type to send a message and unarchive this conversation..."
        : "Type a message or WIP photo update...";
      chatInput.focus();
    }
    if (chatSubmitBtn) {
      chatSubmitBtn.disabled = false;
      chatSubmitBtn.style.opacity = "1";
      chatSubmitBtn.style.cursor = "pointer";
    }

    // Header Avatar
    if (activeAvatarEl) {
      activeAvatarEl.innerHTML = renderAvatarHtml(session.photoURL, session.customerName, isSupport, 40);
    }

    // Configure Header Actions (Order, Messenger Dropdown Options)
    if (chatHeaderActions) {
      chatHeaderActions.style.display = "flex";

      if (chatViewOrderBtn) {
        if (!isSupport && (session.orderId || session.id)) {
          chatViewOrderBtn.style.display = "inline-flex";
          chatViewOrderBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const orderDocId = session.id || session.orderId;
            if (typeof showOrderSummaryModal === "function") {
              await showOrderSummaryModal(orderDocId);
            }
          };
        } else {
          chatViewOrderBtn.style.display = "none";
        }
      }

      const isArchived = Boolean(session.isArchived || session.isClosed);
      if (archiveText) {
        archiveText.textContent = isArchived ? "Unarchive Chat" : "Archive Chat";
      }

      if (optionsMenuBtn && optionsDropdown) {
        optionsMenuBtn.onclick = (e) => {
          e.stopPropagation();
          const isShown = optionsDropdown.style.display === "flex";
          optionsDropdown.style.display = isShown ? "none" : "flex";
        };
      }

      if (archiveActionBtn) {
        archiveActionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (optionsDropdown) optionsDropdown.style.display = "none";
          try {
            if (isArchived) {
              await unarchiveChatSession({ targetId: session.id, isUserSupport: isSupport });
              session.isArchived = false;
              session.isClosed = false;
              showToast("Chat unarchived and moved to Inbox.", "success");
            } else {
              await archiveChatSession({ targetId: session.id, isUserSupport: isSupport });
              session.isArchived = true;
              session.isClosed = true;
              showToast("Chat archived.", "info");
            }
            renderChatSessionsList(allChatSessions);
            selectChatSession(session);
          } catch (err) {
            showToast(err.message || "Failed to update chat status.", "error");
          }
        };
      }

      if (deleteActionBtn) {
        deleteActionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (optionsDropdown) optionsDropdown.style.display = "none";
          const confirmed = await showConfirmModal({
            title: "Delete Conversation?",
            message: "Are you sure you want to delete this entire conversation? All message history will be permanently deleted.",
            confirmText: "Delete",
            cancelText: "Cancel",
            isDestructive: true,
          });

          if (confirmed) {
            try {
              await deleteConversation({ targetId: session.id, isUserSupport: isSupport });
              showToast("Conversation deleted.", "info");
              activeChatSessionId = null;
              if (chatWorkspaceEl) chatWorkspaceEl.classList.remove("mobile-chat-open");
              if (customerNameEl) customerNameEl.textContent = "Select a conversation";
              if (customerEmailEl) customerEmailEl.textContent = "Choose a customer from the left panel to begin";
              if (activeAvatarEl) activeAvatarEl.innerHTML = "";
              if (chatHeaderActions) chatHeaderActions.style.display = "none";
              if (messagesEl) messagesEl.innerHTML = `<div style="margin: auto; text-align: center; color: #9ca3af; font-size: 0.9rem;">Select a conversation from the left to start chatting.</div>`;
              if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = "Select a conversation to reply...";
              }
              if (chatSubmitBtn) {
                chatSubmitBtn.disabled = true;
                chatSubmitBtn.style.opacity = "0.6";
                chatSubmitBtn.style.cursor = "not-allowed";
              }
            } catch (err) {
              showToast(err.message || "Failed to delete conversation.", "error");
            }
          }
        };
      }
    }

    if (customerNameEl) {
      if (isSupport) {
        customerNameEl.innerHTML = `<span style="background: #fef3c7; color: #92400e; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>LIVE SUPPORT</span>${escapeHtml(
          session.customerName || "Customer"
        )}${session.isClosed ? ' <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 500;">(Closed)</span>' : ""}`;
      } else {
        customerNameEl.innerHTML = `<span style="background: #e0f2fe; color: #0369a1; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>ORDER #${escapeHtml(
          session.orderId || session.id
        )}</span>${escapeHtml(session.customerName || "Customer")}${session.isClosed ? ' <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 500;">(Closed)</span>' : ""}`;
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
        loadMoreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>Load earlier messages (${hiddenCount} hidden)`;
        loadMoreBtn.addEventListener("click", () => {
          const oldScrollHeight = messagesEl.scrollHeight;
          adminChatVisibleLimit += 20;
          renderMessageBatch();
          messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
        });
        messagesEl.appendChild(loadMoreBtn);
      }

      visibleMsgs.forEach((m) => {
        const isSystem =
          Boolean(m.isSystem) ||
          m.senderRole === "system" ||
          m.senderRole === "bot" ||
          m.sender === "system" ||
          m.senderId === "system" ||
          (typeof m.senderName === "string" && (m.senderName.toLowerCase().includes("system") || m.senderName.toLowerCase().includes("bot")));

        const isStaff =
          !isSystem &&
          (m.senderRole === "admin" ||
           m.senderRole === "staff" ||
           m.senderId === "support_admin");

        const row = document.createElement("div");
        row.className = `chat-message-row ${isSystem ? "is-system" : isStaff ? "is-staff" : "is-customer"}`;

        const senderLabel = isSystem
          ? (m.senderName || "Lanica System")
          : isStaff
            ? "Lanica Workshop & Admin"
            : (session.customerName || m.senderName || "Customer");

        const timeVal = m.timestamp || m.createdAt;
        const timeStr = timeVal?.toDate
          ? timeVal.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        const { mediaUrl, displayText } = parseChatMessageContent(m);

        // Avatar for message: system has robot icon, customer has photo/initials, staff has none
        const avatarCol = isSystem
          ? `<div class="chat-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: #fef3c7; color: #b45309; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 700; flex-shrink: 0; border: 1.5px solid #fde68a;" title="Lanica System Notification">🤖</div>`
          : !isStaff
            ? renderAvatarHtml(session.photoURL, senderLabel, isSupport, 32)
            : "";

        // Quoted Reply HTML
        const quotedHtml = m.replyTo && m.replyTo.text
          ? `
            <div class="chat-quoted-box">
              <span class="chat-quoted-box-sender">Replying to ${escapeHtml(m.replyTo.senderName || "User")}</span>
              <span class="chat-quoted-box-text">${escapeHtml(m.replyTo.text)}</span>
            </div>
          `
          : "";

        row.innerHTML = `
          ${avatarCol}
          <div class="chat-message-content-wrap">
            <span style="font-size: 0.72rem; color: ${isSystem ? '#b45309' : '#6b7280'}; margin-bottom: 2px; font-weight: ${isSystem ? '700' : '500'};">
              ${escapeHtml(senderLabel)} • ${timeStr}
            </span>
            <div class="chat-bubble-with-actions">
              ${
                m.isUnsent
                  ? `<div class="chat-bubble-unsent">${isStaff ? "You unsent a message" : `${escapeHtml(senderLabel)} unsent a message`}</div>`
                  : `
                <div class="chat-bubble-${isSystem ? "system" : isStaff ? "staff" : "customer"}" style="padding: 10px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.4; background: ${
                  isSystem ? "#fffbeb" : isStaff ? "#6b4423" : "#ffffff"
                }; color: ${isSystem ? "#92400e" : isStaff ? "#fff" : "#1f2937"}; border: 1px solid ${
                  isSystem ? "#fde68a" : isStaff ? "#6b4423" : "#e5e7eb"
                }; box-shadow: 0 1px 2px rgba(0,0,0,0.05); max-width: 100%;">
                  ${quotedHtml}
                  ${displayText ? `<p style="margin: 0 0 ${mediaUrl ? '8px' : '0'} 0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(displayText)}</p>` : ""}
                  ${
                    mediaUrl
                      ? `<a href="${mediaUrl}" target="_blank" rel="noopener" style="display: block; border-radius: 8px; overflow: hidden; max-width: 280px; max-height: 280px; border: 1px solid rgba(0,0,0,0.08); background: #000; text-decoration: none;" title="Click to view full image">
                          <img src="${mediaUrl}" loading="lazy" style="width: 100%; height: 100%; max-height: 280px; object-fit: contain; display: block;" alt="Attachment" />
                        </a>`
                      : ""
                  }
                </div>
                `
              }
              ${
                !m.isUnsent
                  ? `
                <div class="chat-msg-actions">
                  <button type="button" class="chat-msg-action-btn reply-btn" title="Reply to message">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 9V5L3 12l7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                  </button>
                  ${
                    isStaff
                      ? `<button type="button" class="chat-msg-action-btn unsend unsend-btn" title="More options / Unsend"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`
                      : ""
                  }
                </div>
                `
                  : ""
              }
            </div>
          </div>
        `;

        const replyBtn = row.querySelector(".reply-btn");
        if (replyBtn) {
          replyBtn.onclick = () => setReplyingMessage(m);
        }

        const unsendBtn = row.querySelector(".unsend-btn");
        if (unsendBtn) {
          unsendBtn.onclick = async () => {
            const result = await showMessengerUnsendModal({ canUnsendForEveryone: isStaff });
            if (!result) return;
            try {
              await unsendChatMessage({
                targetId: session.id,
                messageId: m.id,
                isUserSupport: isSupport,
                unsendFor: result.unsendFor,
                currentUserId: currentUser ? currentUser.uid : "admin",
              });
              showToast(result.unsendFor === "everyone" ? "You unsent a message." : "Message removed for you.", "info");
            } catch (err) {
              console.error("Unsend error:", err);
              showToast(err.message || "Could not unsend message.", "error");
            }
          };
        }

        messagesEl.appendChild(row);
      });
    }

    if (messagesEl) {
      messagesEl.onscroll = () => {
        if (messagesEl.scrollTop <= 10 && allLoadedMessages.length > adminChatVisibleLimit) {
          const oldScrollHeight = messagesEl.scrollHeight;
          adminChatVisibleLimit += 20;
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
        showToast("Please select a customer conversation first.", "info");
        return;
      }

      const activeSession = allChatSessions.find((s) => s.id === activeChatSessionId);
      const isSupport = activeSession?.sessionType === "support";
      const replyPayload = activeReplyingMessage
        ? {
            id: activeReplyingMessage.id,
            senderName: activeReplyingMessage.senderName || (activeReplyingMessage.senderRole === "admin" || activeReplyingMessage.senderRole === "staff" ? "Lanica Workshop" : "Customer"),
            text: activeReplyingMessage.text || activeReplyingMessage.content || "[Photo]",
          }
        : null;

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
          replyTo: replyPayload,
        });

        if (chatInput) chatInput.value = "";
        setReplyingMessage(null);
      } catch (err) {
        console.error("Chat send error:", err);
        showToast(err.message || "Failed to send reply.", "error");
      }
    });
  }
}

setupAdminLiveChat();
setupAddonsRepeaterUI();
setupBedSizesRepeaterUI();

syncBatchDeleteUi();

// Initialize section routing from URL hash or default to Dashboard
const initialHash = (window.location.hash || "").replace("#", "").toLowerCase();
showAdminSection(initialHash || "dashboard");

window.addEventListener("hashchange", () => {
  const currentHash = (window.location.hash || "").replace("#", "").toLowerCase();
  showAdminSection(currentHash || "dashboard");
});


