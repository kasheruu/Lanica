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

// Color picker logic
const colorPicker = document.getElementById("product-color-picker");
const colorInput = document.getElementById("product-color");

// Auto-resize description text area
const productDescriptionTextarea = document.getElementById("product-description");
if (productDescriptionTextarea) {
  productDescriptionTextarea.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  });
}

colorPicker.addEventListener("input", (e) => {
  colorInput.value = e.target.value.toUpperCase();
});

colorInput.addEventListener("input", (e) => {
  const val = e.target.value;
  if (/^#[0-9A-F]{6}$/i.test(val)) {
    colorPicker.value = val;
  }
});

// Quick Material Preset Chip Clicks
document.addEventListener("click", (e) => {
  const chipBtn = e.target.closest(".material-chip-btn");
  if (chipBtn) {
    e.preventDefault();
    const val = chipBtn.dataset.val || chipBtn.textContent;
    const matInput = document.getElementById("product-material");
    if (matInput) {
      matInput.value = val;
      matInput.focus();
    }
  }
});

// --- Input Validation with Warnings ---
const validationRules = [
  { id: "product-name", max: 100, msg: "Product name cannot exceed 100 characters" },
  { id: "product-description", max: 500, msg: "Description cannot exceed 500 characters" },
  { id: "product-price", max: 99999999, msg: "Price cannot exceed ₱99,999,999" },
  { id: "product-cost", max: 99999999, msg: "Cost cannot exceed ₱99,999,999" },
  { id: "product-stock", max: 99999, msg: "Stock cannot exceed 99,999 units" },
  { id: "product-size-w", max: 120, msg: "Width cannot exceed 120 inches" },
  { id: "product-size-h", max: 120, msg: "Height cannot exceed 120 inches" },
  { id: "product-size-d", max: 120, msg: "Depth cannot exceed 120 inches" },
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
      if (value && parseFloat(value) > rule.max) {
        showWarning(input, rule.msg);
        input.value = rule.max; // Cap at max
      } else {
        clearWarning(input);
      }
    }
  });

  input.addEventListener("blur", () => {
    // Clear warning on blur but keep value capped
    if (input.id.startsWith("product-size")) {
      if (parseFloat(input.value) > rule.max) input.value = rule.max;
    }
    clearWarning(input);
  });
});

// Modal state
let isEditing = false;
let currentEditId = null;

// --- Modal Functions ---
window.openModal = () => {
  productModal.classList.add("active");
  if (!isEditing) {
    document.getElementById("modal-title").textContent = "Add New Product";
    // When adding new, front bg is required as minimum
    document.getElementById("img-bg").required = true;
    document.getElementById("img-iso").required = true;
  }
};

window.closeModal = () => {
  productModal.classList.remove("active");
  productForm.reset();
  isEditing = false;
  currentEditId = null;
  delete productForm.dataset.existingImages;
  delete productForm.dataset.meshyTaskId;

  // Reset required states
  document.getElementById("img-iso").required = true;
  document.getElementById("img-bg").required = true;

  // Reset textarea height
  if (productDescriptionTextarea) {
    productDescriptionTextarea.style.height = "auto";
  }
};

addProductBtn.addEventListener("click", window.openModal);
closeModalBtn.addEventListener("click", window.closeModal);
cancelBtn.addEventListener("click", window.closeModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) window.closeModal();
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
let allProducts = [];

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
    console.log("Starting upload for file:", file.name, "Size:", file.size, "Type:", file.type);
    // Create a unique filename
    const uniqueName = `${Date.now()}_${file.name}`;
    const targetPath = folderPath ? `${folderPath}/${uniqueName}` : `products/${uniqueName}`;
    const storageRef = ref(storage, targetPath);

    console.log("Uploading to path:", targetPath);
    // Upload file to Firebase Storage
    const snapshot = await uploadBytes(storageRef, file);
    console.log("Upload successful, getting download URL...");

    // Get download URL
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
  submitBtn.textContent = "Saving...";
  submitBtn.disabled = true;

  try {
    const transparentFrontFile = document.getElementById("img-bg").files[0];
    const leftBgFile = document.getElementById("img-bg-left")?.files[0] || null;
    const rightBgFile = document.getElementById("img-bg-right")?.files[0] || null;
    const backBgFile = document.getElementById("img-bg-back")?.files[0] || null;

    const imageFiles = {
      isoImage: document.getElementById("img-iso").files[0],
      bgImage: transparentFrontFile,
      leftBgImage: leftBgFile,
      rightBgImage: rightBgFile,
      backBgImage: backBgFile,
    };

    const existingImages = isEditing ? JSON.parse(productForm.dataset.existingImages || "{}") : {};

    // Helper to get URL: Check if new file uploaded, else keep existing
    const getImageUrl = async (key, folderPath) => {
      if (imageFiles[key]) {
        return await uploadImage(imageFiles[key], folderPath);
      }
      return existingImages[key] || "";
    };

    // Upload selected files concurrently into specified Firebase Storage folders
    const [isoImage, bgImage, leftBgImage, rightBgImage, backBgImage] = await Promise.all([
      getImageUrl("isoImage", "products/thumbnails"),
      getImageUrl("bgImage", "products/productsnobg"),
      getImageUrl("leftBgImage", "products/productsnobg"),
      getImageUrl("rightBgImage", "products/productsnobg"),
      getImageUrl("backBgImage", "products/productsnobg"),
    ]);

    // Keep previous Meshy artifacts only when we are NOT regenerating from a new transparent image.
    let meshyTaskId = isEditing ? productForm.dataset.meshyTaskId || null : null;
    let modelUrl = isEditing ? productForm.dataset.modelUrl || null : null;
    let meshyStatus = isEditing ? productForm.dataset.meshyStatus || null : null;
    const shouldRegenerateMeshy = !!(transparentFrontFile || leftBgFile || rightBgFile || backBgFile);

    if (shouldRegenerateMeshy) {
      // Explicitly clear old task ids and URLs when new transparent image(s) are uploaded.
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
      submitBtn.textContent = isEditing
        ? "Regenerating 3D Model..."
        : "Starting 3D Generation...";
      try {
        // Always try to create task (single or multi-view)
        const originalTask = await createMeshyTask(meshyPayload);
        meshyTaskId = originalTask.result;

        meshyStatus = "PENDING";
        console.log("Meshy 3D Generation started!", {
          original: meshyTaskId,
          isMultiView: !!(leftBgImage || rightBgImage || backBgImage),
        });

        submitBtn.textContent = "Waiting for 3D model URL...";

        // Wait for original (required)
        const originalResult = await waitForMeshyModelUrl(meshyTaskId, 40, 3000);
        const rawModelUrl = originalResult.modelUrl || null;
        meshyStatus = originalResult.status || meshyStatus;

        if (rawModelUrl) {
          submitBtn.textContent = "Saving 3D model to Firebase Storage...";
          const productName = document.getElementById("product-name").value || "product";
          const safeName = productName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          modelUrl = await uploadGlbFromUrl(rawModelUrl, "products/productsmodel", `${safeName}.glb`);
        } else {
          modelUrl = null;
        }
      } catch (err) {
        console.error("Failed to generate 3D model", err);
        alert("Failed to generate 3D model: " + err.message);
        submitBtn.textContent = "Save Product";
        submitBtn.disabled = false;
        return; // ABORT SAVE
      }
    }

    const stock = parseInt(document.getElementById("product-stock").value, 10) || 0;
    const material = document.getElementById("product-material").value;

    const productData = {
      name: document.getElementById("product-name").value,
      description: document.getElementById("product-description").value,
      category: document.getElementById("product-category").value,
      price: parseFloat(document.getElementById("product-price").value),
      cost: parseFloat(document.getElementById("product-cost").value),
      stock,
      material,
      size: `${document.getElementById("product-size-w").value} × ${document.getElementById("product-size-h").value} × ${document.getElementById("product-size-d").value} in`,
      color: document.getElementById("product-color").value,
      images: {
        isoImage,
        bgImage,
        leftBgImage: leftBgImage || "",
        rightBgImage: rightBgImage || "",
        backBgImage: backBgImage || "",
      },
      meshyTaskId: meshyTaskId,
      modelUrl: modelUrl,
      meshyStatus: meshyStatus,
      meshyRegeneratedAt: shouldRegenerateMeshy ? Timestamp.now() : null,
    };

    let savedProductRef = null;
    if (isEditing) {
      savedProductRef = doc(db, "products", currentEditId);
      await updateDoc(savedProductRef, productData);
    } else {
      savedProductRef = await addDoc(productsCollection, productData);
    }

    // Ensure regenerated products eventually store Meshy URLs uploaded to Firebase Storage.
    if (shouldRegenerateMeshy && savedProductRef) {
      const updates = {};
      if (meshyTaskId && !modelUrl) {
        submitBtn.textContent = "Finalizing 3D model URL...";
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

    window.closeModal();
  } catch (e) {
    console.error("Error saving product: ", e);
    alert("Failed to save product. See console for details.");
  } finally {
    submitBtn.textContent = "Save Product";
    submitBtn.disabled = false;
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

// Edit Product (Load data into form)
window.editProduct = (id, productJsonBase64) => {
  try {
    const product = JSON.parse(decodeURIComponent(atob(productJsonBase64)));
    document.getElementById("product-name").value = product.name;
    document.getElementById("product-description").value = product.description || "";
    document.getElementById("product-category").value = product.category;
    document.getElementById("product-price").value = product.price;
    document.getElementById("product-cost").value =
      product.cost != null && product.cost !== "" ? product.cost : 0;

    document.getElementById("product-stock").value = product.stock || 0;
    document.getElementById("product-material").value = product.material || "Fabric";
    const sizeParts = (product.size || "").split(" × ");
    document.getElementById("product-size-w").value = sizeParts[0] || "72";
    document.getElementById("product-size-h").value = sizeParts[1] || "72";
    document.getElementById("product-size-d").value = sizeParts[2]?.replace(" in", "") || "12";
    document.getElementById("product-color").value = product.color || "";

    // When editing, files are not required
    document.getElementById("img-iso").required = false;
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
    productForm.dataset.meshyTaskId = product.meshyTaskId || "";
    productForm.dataset.modelUrl = product.modelUrl || "";
    productForm.dataset.meshyStatus = product.meshyStatus || "";
    productForm.dataset.productName = product.name || "";
    productForm.dataset.productDescription = product.description || "";

    isEditing = true;
    currentEditId = id;
    document.getElementById("modal-title").textContent = "Edit Product";
    window.openModal();
  } catch (e) {
    console.error("Failed to parse product for editing", e);
  }
};

// --- Rendering ---
const renderInventory = (products) => {
  inventoryList.innerHTML = "";

  if (products.length === 0) {
    inventoryList.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">No products found. Add some!</td></tr>`;
    return;
  }

  products.forEach((product) => {
    let statusClass = "status-in-stock";
    let statusText = "In Stock";

    if (product.stock === 0) {
      statusClass = "status-out-stock";
      statusText = "Out of Stock";
    } else if (product.stock < 10) {
      statusClass = "status-low-stock";
      statusText = "Low Stock";
    }

    const thumbImage =
      product.images && (product.images.isoImage || product.images.frontBg)
        ? product.images.isoImage || product.images.frontBg
        : "https://via.placeholder.com/48";
    const productPayload = btoa(encodeURIComponent(JSON.stringify(product)));

    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td>
                <div class="table-product-info">
                    <img src="${thumbImage}" alt="${product.name}" class="table-product-img" onerror="this.src='https://via.placeholder.com/48'">
                    <strong>${product.name}</strong>
                </div>
            </td>
            <td>${product.category}</td>
            <td>₱${product.price.toFixed(2)}</td>
            <td>${escapeHtml(product.material || "—")}</td>
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
                    <!-- encoded values handle quotes -->
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
};

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

function renderLowStockWatchlist(products) {
  if (!analyticsLowStockListEl) return;
  const lowItems = products
    .filter((p) => Number(p.stock) <= 5)
    .sort((a, b) => Number(a.stock) - Number(b.stock));

  if (!lowItems.length) {
    analyticsLowStockListEl.innerHTML = `<div class="analytics-empty" style="color: #059669; font-weight: 500;">All products have healthy stock levels (&gt; 5 units).</div>`;
    return;
  }

  const TARGET_STOCK = 10;
  analyticsLowStockListEl.innerHTML = lowItems
    .map((p) => {
      const stock = Number(p.stock) || 0;
      const isCritical = stock <= 2;
      const badgeClass = isCritical ? "critical" : "warning";
      const badgeText = isCritical ? "Critical (< 3)" : "Low Stock";
      const pct = Math.min(100, Math.max(5, (stock / TARGET_STOCK) * 100));

      return `<div class="stock-alert-item">
        <div class="stock-alert-header">
          <span class="stock-alert-title">${escapeHtml(p.name || "Unnamed Product")}</span>
          <span class="stock-alert-badge ${badgeClass}">${badgeText} — ${stock} / ${TARGET_STOCK} left</span>
        </div>
        <div class="stock-progress-track">
          <div class="stock-progress-fill ${badgeClass}" style="width: ${pct}%;"></div>
        </div>
      </div>`;
    })
    .join("");
}

const updateStats = (products) => {
  let totalItems = products.length;
  let lowStockCount = products.filter((p) => Number(p.stock) <= 5 && Number(p.stock) > 0).length;
  let outOfStockCount = products.filter((p) => Number(p.stock) === 0).length;
  let totalValue = products.reduce((sum, p) => sum + Number(p.price || 0) * Number(p.stock || 0), 0);
  const totalUnits = products.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  const avgPrice = totalItems
    ? products.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / totalItems
    : 0;
  const avgStockPerProduct = totalItems ? totalUnits / totalItems : 0;

  const materialUnits = products.reduce((acc, p) => {
    const key = String(p.material || "Unspecified").trim() || "Unspecified";
    acc[key] = (acc[key] || 0) + (Number(p.stock) || 0);
    return acc;
  }, {});

  if (totalProductsStat) totalProductsStat.textContent = totalItems;
  if (lowStockStat) lowStockStat.textContent = lowStockCount;
  if (totalValueStat) {
    totalValueStat.textContent =
      "₱" +
      totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  if (analyticsTotalUnitsEl) analyticsTotalUnitsEl.textContent = String(totalUnits);
  if (analyticsOutOfStockEl) analyticsOutOfStockEl.textContent = String(outOfStockCount);
  if (analyticsAvgPriceEl) {
    analyticsAvgPriceEl.textContent =
      "₱" +
      avgPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (analyticsAvgStockEl) analyticsAvgStockEl.textContent = avgStockPerProduct.toFixed(1);

  const materialEntries = Object.entries(materialUnits).sort((a, b) => b[1] - a[1]);
  renderBars(analyticsMaterialBarsEl, materialEntries, totalUnits);
  renderCategoryDonutChart(products);
  renderLowStockWatchlist(products);
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
const navUsers = document.getElementById("nav-users");
const dashboardSection = document.getElementById("dashboard-section");
const inventorySection = document.getElementById("inventory-section");
const analyticsSection = document.getElementById("analytics-section");
const workshopSection = document.getElementById("workshop-section");
const chatsSection = document.getElementById("chats-section");
const ordersSection = document.getElementById("orders-section");
const usersSection = document.getElementById("users-section");

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
let staffMembers = [];
let ordersFilterValue = "all";
const selectedDeclinedOrderIds = new Set();
let isBatchDeleteMode = false;
let allUsers = [];
let usersFilterValue = "all";
const customerNameByUid = new Map();
const customerNameByEmail = new Map();
let customerHydrationInFlight = false;

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
  if (s === "pending") return "placed";
  if (s === "accepted") return "downpayment confirmed";
  if (s === "processing" || s === "packed") return "in production";
  if (s === "declined") return "cancelled";
  if (s === "completed" || s === "received" || s === "arrived") return "delivered";
  if (
    [
      "placed",
      "downpayment confirmed",
      "in production",
      "quality checked",
      "shipped",
      "delivered",
      "cancelled",
    ].includes(s)
  ) {
    return s;
  }
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

function getOrderCost(order) {
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item) => {
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const product = item.productId ? productById.get(item.productId) : null;
    const unitCost = Number(item.cost ?? item.productCost ?? product?.cost ?? 0);
    return sum + (Number.isFinite(unitCost) ? unitCost : 0) * qty;
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
      buckets.push({ key, label: labelOf(cursor), revenue: 0, profit: 0 });
    }
    if (granularity === "month") cursor.setMonth(cursor.getMonth() + 1, 1);
    else if (granularity === "week") cursor.setDate(cursor.getDate() + 7);
    else cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  const indexByKey = new Map(buckets.map((b, idx) => [b.key, idx]));
  orders.forEach((order) => {
    if (!isOrderCompleted(order)) return;
    const dt = orderEventDate(order);
    if (!dt) return;
    const ms = dt.getTime();
    if (ms < startDate.getTime() || ms > endDate.getTime()) return;
    const key = keyOf(dt);
    const idx = indexByKey.get(key);
    if (idx == null) return;

    const revenue = getOrderRevenue(order);
    const cost = getOrderCost(order);
    buckets[idx].revenue += revenue;
    buckets[idx].profit += revenue - cost;
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
    return;
  }

  const granularity = range.days > 180 ? "month" : range.days > 45 ? "week" : "day";
  const buckets = getRevenueBuckets(allOrders, range.start, range.end, granularity);
  const maxValue = Math.max(
    1,
    ...buckets.map((b) => Math.max(Number(b.revenue) || 0, Number(b.profit) || 0))
  );
  const totalRevenue = buckets.reduce((sum, b) => sum + b.revenue, 0);
  const totalProfit = buckets.reduce((sum, b) => sum + b.profit, 0);

  if (ordersTotalRevenueEl) ordersTotalRevenueEl.textContent = formatPeso(totalRevenue);
  if (ordersTotalProfitEl) ordersTotalProfitEl.textContent = formatPeso(totalProfit);

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
          <div class="orders-revenue-fill revenue" style="height:${revPct.toFixed(1)}%" title="Revenue: ${escapeHtml(
            formatPeso(bucket.revenue)
          )}"></div>
          <div class="orders-revenue-fill profit" style="height:${profitPct.toFixed(1)}%" title="Profit: ${escapeHtml(
            formatPeso(bucket.profit)
          )}"></div>
        </div>
        <span class="orders-revenue-label ${showLabel ? "is-visible" : ""} ${hasData ? "has-data" : ""}">${escapeHtml(
          bucket.label
        )}</span>
        <div class="orders-revenue-values" title="Revenue: ${escapeHtml(formatPeso(bucket.revenue))} | Profit: ${escapeHtml(
          formatPeso(bucket.profit)
        )}">
          ${hasData ? `R ${escapeHtml(formatPeso(bucket.revenue))}<br/>P ${escapeHtml(formatPeso(bucket.profit))}` : ""}
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

  const headers = ["Product ID", "Name", "Category", "Price (PHP)", "Cost (PHP)", "Stock", "Material", "Color", "Dimensions (WxHxD in)"];
  const csvRows = [headers.join(",")];

  allProducts.forEach((p) => {
    const dims = p.size ? `"${p.size.w || 0}x${p.size.h || 0}x${p.size.d || 0}"` : '""';
    const row = [
      `"${(p.id || "").replace(/"/g, '""')}"`,
      `"${(p.name || "").replace(/"/g, '""')}"`,
      `"${(p.category || "").replace(/"/g, '""')}"`,
      Number(p.price || 0).toFixed(2),
      Number(p.cost || 0).toFixed(2),
      Number(p.stock || 0),
      `"${(p.material || "").replace(/"/g, '""')}"`,
      `"${(p.color || "").replace(/"/g, '""')}"`,
      dims
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
  // Made-to-Order items have 0 physical stock. Showroom units normally have 1-3.
  // Low stock warning alerts only if showroom display stock is 1 or 2 left.
  const lowStockCount = products ? products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 2).length : 0;

  const activeOrders = orders ? orders.filter((o) => normalizeOrderAction(o.action) !== "delete") : [];

  const pendingOrdersCount = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "placed" || st === "downpayment confirmed" || st === "in production";
  }).length;

  const totalRevenue = activeOrders
    .filter((o) => {
      const st = normalizeOrderStatus(o.status);
      return st === "delivered" || st === "shipped" || st === "quality checked" || st === "in production" || st === "downpayment confirmed";
    })
    .reduce((sum, o) => sum + (Number(o.total != null ? o.total : o.totalAmount) || 0), 0);

  if (dashTotalRevenueEl) {
    dashTotalRevenueEl.textContent =
      "₱" + totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (dashPendingOrdersEl) dashPendingOrdersEl.textContent = String(pendingOrdersCount);
  if (dashLowStockEl) dashLowStockEl.textContent = String(lowStockCount);
  if (dashTotalProductsEl) dashTotalProductsEl.textContent = String(totalProducts);

  renderDashboardRecentOrders(activeOrders.slice(0, 5));
}

function renderDashboardRecentOrders(recentOrders) {
  if (!dashRecentOrdersListEl) return;
  dashRecentOrdersListEl.innerHTML = "";

  if (!recentOrders || recentOrders.length === 0) {
    dashRecentOrdersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #6b7280;">No customer orders recorded yet.</td></tr>`;
    return;
  }

  recentOrders.forEach((order) => {
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
}

function showAdminSection(name) {
  const showDash = name === "dashboard" || !name;
  const showInv = name === "inventory";
  const showAnalytics = name === "analytics";
  const showWorkshop = name === "workshop";
  const showChats = name === "chats";
  const showOrders = name === "orders";
  const showUsers = name === "users";

  if (dashboardSection) dashboardSection.classList.toggle("is-hidden", !showDash);
  if (inventorySection) inventorySection.classList.toggle("is-hidden", !showInv);
  if (analyticsSection) analyticsSection.classList.toggle("is-hidden", !showAnalytics);
  if (workshopSection) workshopSection.classList.toggle("is-hidden", !showWorkshop);
  if (chatsSection) chatsSection.classList.toggle("is-hidden", !showChats);
  if (ordersSection) ordersSection.classList.toggle("is-hidden", !showOrders);
  if (usersSection) usersSection.classList.toggle("is-hidden", !showUsers);

  if (navDashboard) navDashboard.classList.toggle("active", showDash);
  if (navInventory) navInventory.classList.toggle("active", showInv);
  if (navAnalytics) navAnalytics.classList.toggle("active", showAnalytics);
  if (navWorkshop) navWorkshop.classList.toggle("active", showWorkshop);
  if (navChats) navChats.classList.toggle("active", showChats);
  if (navOrders) navOrders.classList.toggle("active", showOrders);
  if (navUsers) navUsers.classList.toggle("active", showUsers);

  if (showWorkshop) renderWorkshopQueue(allOrders);

  window.location.hash = name || "dashboard";
}

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
if (navUsers) {
  navUsers.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("users");
  });
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
    // Read all users and filter client-side for staff, artisan, or admin
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

    // Re-render orders once staff list is ready so assignment dropdown gets populated.
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
  if (!usersTotalEl || !usersAdminsEl || !usersStaffEl || !usersInactiveEl) return;
  const total = users.length;
  const admins = users.filter((u) => normalizeUserRole(u.role) === "admin").length;
  const staff = users.filter((u) => normalizeUserRole(u.role) === "staff").length;
  const inactive = users.filter((u) => normalizeUserStatus(u.status) === "inactive").length;
  usersTotalEl.textContent = String(total);
  usersAdminsEl.textContent = String(admins);
  usersStaffEl.textContent = String(staff);
  usersInactiveEl.textContent = String(inactive);
}

function renderUsersList(users) {
  if (!usersListEl) return;
  usersListEl.innerHTML = "";

  if (!users.length) {
    usersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#6b7280;">No users found.</td></tr>`;
    return;
  }

  users.forEach((u) => {
    const name = pickFirstNonEmpty(u.displayName, u.name, u.fullName, "—");
    const email = pickFirstNonEmpty(u.email, "—");
    const uid = pickFirstNonEmpty(u.uid, u.id, "—");
    const role = normalizeUserRole(u.role);
    const status = normalizeUserStatus(u.status);
    const isSelf = !!currentUser && (uid === currentUser.uid || u.id === currentUser.uid);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(email)}</td>
      <td>
        <select class="user-role-select" data-user-doc-id="${escapeHtml(u.id)}" ${isSelf ? "disabled" : ""}>
          <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
          <option value="staff" ${role === "staff" ? "selected" : ""}>Staff</option>
          <option value="customer" ${role === "customer" ? "selected" : ""}>Customer</option>
        </select>
      </td>
      <td>
        <select class="user-status-select" data-user-doc-id="${escapeHtml(u.id)}" ${isSelf ? "disabled" : ""}>
          <option value="active" ${status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${status === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </td>
      <td style="font-size:0.8rem;color:#6b7280;">${escapeHtml(uid)}</td>
      <td>
        ${
          isSelf
            ? `<span style="font-size:0.82rem;color:#6b7280;">Current account</span>`
            : `<button class="btn-secondary user-save-btn" data-user-doc-id="${escapeHtml(u.id)}">Save</button>`
        }
      </td>
    `;
    usersListEl.appendChild(tr);
  });
}

function applyUsersFilter() {
  let rows = allUsers;
  if (
    usersFilterValue === "admin" ||
    usersFilterValue === "staff" ||
    usersFilterValue === "customer"
  ) {
    rows = rows.filter((u) => normalizeUserRole(u.role) === usersFilterValue);
  } else if (usersFilterValue === "inactive") {
    rows = rows.filter((u) => normalizeUserStatus(u.status) === "inactive");
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
  const counts = { placed: 0, "downpayment confirmed": 0, "in production": 0, "quality checked": 0, shipped: 0, delivered: 0 };
  orders.forEach((o) => {
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
}

function applyOrdersFilter() {
  const activeOrders = allOrders.filter(
    (o) => !isOrderCompleted(o) && normalizeOrderAction(o.action) !== "delete"
  );

  let rows = activeOrders;
  if (ordersFilterValue && ordersFilterValue !== "all") {
    rows = activeOrders.filter((o) => normalizeOrderStatus(o.status) === ordersFilterValue);
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
    ordersListEl.innerHTML = `<tr><td colspan="${isBatchDeleteMode ? 8 : 7}" style="text-align:center;padding:24px;color:#6b7280;">No orders yet. Orders created by the customer app appear here.</td></tr>`;
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
    const total = order.total != null ? order.total : order.totalAmount;
    const totalStr =
      total != null && total !== ""
        ? `₱${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";
    const connectionIssues = getOrderConnectionIssues(order);
    const isConnected = connectionIssues.length === 0;
    const connectionBadgeHtml = isConnected
      ? `<div style="font-size:0.72rem;color:#137333;background:#e6f4ea;border-radius:999px;display:inline-block;padding:2px 8px;margin-top:6px;">Connected</div>`
      : `<div title="${escapeHtml(connectionIssues.join(", "))}" style="font-size:0.72rem;color:#b06000;background:#fef7e0;border-radius:999px;display:inline-block;padding:2px 8px;margin-top:6px;">Needs fix</div>`;

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
        ${connectionBadgeHtml}
      </td>
      <td>${escapeHtml(String(customer))}</td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td>${totalStr}</td>
      <td>
        <span class="order-status-badge order-status-${escapeHtml(st)}">${escapeHtml(
          st.charAt(0).toUpperCase() + st.slice(1)
        )}</span>
      </td>
      <td>
        <select class="order-assign-select" data-order-id="${escapeHtml(order.id)}" aria-label="Assign staff" ${st === "delivered" || st === "cancelled" || st === "declined" ? "disabled" : ""}>
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
        ${
          st === "placed" || st === "pending"
            ? `<div class="order-action-group">
                <button class="btn-icon order-action-btn order-action-accept btn-accept-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Accept order" title="Accept Order & Confirm Downpayment">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
                <button class="btn-icon order-action-btn order-action-decline btn-decline-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Decline order" title="Decline Order">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>`
            : st === "declined" || st === "cancelled"
              ? `<button class="btn-icon order-action-btn order-action-delete btn-delete-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Delete declined order" title="Delete">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>`
              : `<span style="font-size:0.82rem;color:#059669;font-weight:500;text-transform:capitalize;">${escapeHtml(st)}</span>`
        }
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
    prev === "accepted" && next === "processing" && !current.stockDeducted && items.length > 0;

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

function renderWorkshopQueue(orders) {
  const queueList = document.getElementById("workshop-queue-list");
  if (!queueList) return;

  const craftingOrders = (orders || []).filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return (
      !isOrderCompleted(o) &&
      normalizeOrderAction(o.action) !== "delete" &&
      ["placed", "downpayment confirmed", "in production", "quality checked"].includes(st)
    );
  });

  const queuedCount = craftingOrders.filter((o) => normalizeOrderStatus(o.status) === "downpayment confirmed").length;
  const inProdCount = craftingOrders.filter((o) => normalizeOrderStatus(o.status) === "in production").length;
  const qcPassedCount = craftingOrders.filter((o) => normalizeOrderStatus(o.status) === "quality checked").length;
  const showroomCount = (allProducts || []).reduce((sum, p) => sum + (Number(p.stock) || 0), 0);

  const elQueued = document.getElementById("workshop-deposit-verified");
  const elInProd = document.getElementById("workshop-in-production");
  const elQc = document.getElementById("workshop-qc-passed");
  const elShowroom = document.getElementById("workshop-showroom-units");

  if (elQueued) elQueued.textContent = String(queuedCount);
  if (elInProd) elInProd.textContent = String(inProdCount);
  if (elQc) elQc.textContent = String(qcPassedCount);
  if (elShowroom) elShowroom.textContent = String(showroomCount);

  if (craftingOrders.length === 0) {
    queueList.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #6b7280;">No active crafting orders in workshop queue.</td></tr>`;
    return;
  }

  queueList.innerHTML = "";
  craftingOrders.forEach((o) => {
    const st = normalizeOrderStatus(o.status);
    const customer = resolveCustomerDisplay(o);
    const items = Array.isArray(o.items) ? o.items : [];

    const customSpecsHTML = items
      .map((it) => {
        const notes = it.customNotes
          ? `<div style="font-size: 0.78rem; color: #b45309; background: #fef3c7; padding: 2px 6px; border-radius: 4px; margin-top: 3px; display: inline-block;"><strong>Custom Specs:</strong> ${escapeHtml(
              it.customNotes
            )}</div>`
          : "";
        return `
          <div style="margin-bottom: 4px;">
            <strong>${escapeHtml(it.name || "Item")}</strong> (${escapeHtml(it.material || "Standard")}) x${it.quantity || 1}
            ${notes}
          </div>
        `;
      })
      .join("");

    const isDownpayment = o.paymentOption === "downpayment" || Number(o.downpaymentAmount) > 0;
    const paymentHTML = isDownpayment
      ? `
      <div style="font-size: 0.82rem;">
        <div>Paid: <strong style="color: #059669;">₱${parseFloat(o.downpaymentAmount || 0).toLocaleString()}</strong> (50%)</div>
        <div>Bal: <strong style="color: #d97706;">₱${parseFloat(o.balanceDue || 0).toLocaleString()}</strong></div>
        ${
          o.paymentDetails?.paymentSlipUrl
            ? `<a href="${o.paymentDetails.paymentSlipUrl}" target="_blank" rel="noopener" style="color: #4338ca; text-decoration: underline; font-weight: 500;">View Deposit Slip ↗</a>`
            : ""
        }
      </div>
    `
      : `
      <div style="font-size: 0.82rem;">
        <div>Full: <strong>₱${parseFloat(o.total || o.totalAmount || 0).toLocaleString()}</strong></div>
      </div>
    `;

    let nextStage = "";
    let nextLabel = "";
    if (st === "placed") {
      nextStage = "downpayment confirmed";
      nextLabel = "Verify Deposit";
    } else if (st === "downpayment confirmed") {
      nextStage = "in production";
      nextLabel = "Start Crafting";
    } else if (st === "in production") {
      nextStage = "quality checked";
      nextLabel = "Pass QC Check";
    } else if (st === "quality checked") {
      nextStage = "shipped";
      nextLabel = "Dispatch / Ship";
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong style="font-size: 0.88rem;">${escapeHtml(o.id.slice(0, 8))}…</strong>
        <div style="font-size: 0.72rem; color: #9ca3af; margin-top: 2px;">${escapeHtml(o.orderType || "Made-to-Order")}</div>
      </td>
      <td>${escapeHtml(String(customer))}</td>
      <td style="max-width: 240px;">${customSpecsHTML}</td>
      <td>${paymentHTML}</td>
      <td style="font-size: 0.82rem;">${escapeHtml(o.estimatedLeadTime || "14–21 Business Days")}</td>
      <td>
        <span class="order-status-badge order-status-${escapeHtml(st.replace(/\s+/g, "-"))}">
          ${escapeHtml(st.toUpperCase())}
        </span>
      </td>
      <td>
        ${
          nextStage
            ? `
          <button type="button" class="btn-primary btn-advance-crafting" data-order-id="${escapeHtml(
            o.id
          )}" data-next-status="${nextStage}" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px; white-space: nowrap;">
            ${nextLabel} &rarr;
          </button>
        `
            : `<span style="font-size: 0.8rem; color: #6b7280;">Ready</span>`
        }
      </td>
    `;
    queueList.appendChild(tr);
  });
}

const workshopQueueTable = document.getElementById("workshop-queue-list");
if (workshopQueueTable) {
  workshopQueueTable.addEventListener("click", async (e) => {
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
}

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

  function renderChatSessionsList(sessions) {
    if (!sessionsListEl) return;

    // Filter by active category tab
    const filteredSessions = sessions.filter((s) => {
      if (currentChatFilter === "support") return s.sessionType === "support";
      if (currentChatFilter === "orders") return s.sessionType === "order";
      return true;
    });

    if (filteredSessions.length === 0) {
      sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #9ca3af; font-size: 0.85rem;">No ${
        currentChatFilter === "support"
          ? "general live support"
          : currentChatFilter === "orders"
          ? "order crafting"
          : "active"
      } conversations found.</div>`;
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

  function selectChatSession(session) {
    activeChatSessionId = session.id;
    const isSupport = session.sessionType === "support";

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

    activeChatUnsubscribe = subscribeToMessages(session.id, (messages) => {
      if (!messagesEl) return;

      // Mark messages read in real time as they arrive while chat is open
      markOrderMessagesAsRead(session.id, "admin", isSupport);
      sessionUnreadCounts.set(session.id, 0);
      updateAdminNavChatBadge();

      if (messages.length === 0) {
        messagesEl.innerHTML = `<div style="margin: auto; text-align: center; color: #9ca3af; font-size: 0.88rem;">No messages in this ${
          isSupport ? "support" : "order"
        } thread yet. Send a greeting!</div>`;
        return;
      }

      messagesEl.innerHTML = "";
      messages.forEach((m) => {
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

syncBatchDeleteUi();

// Initialize section routing from URL hash or default to Dashboard
const initialHash = (window.location.hash || "").replace("#", "").toLowerCase();
showAdminSection(initialHash || "dashboard");

window.addEventListener("hashchange", () => {
  const currentHash = (window.location.hash || "").replace("#", "").toLowerCase();
  showAdminSection(currentHash || "dashboard");
});
