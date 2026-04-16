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
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

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

// Cloudinary Configuration
// SECURITY WARNING: In frontend JavaScript, NEVER use your API Key and Secret.
// Anyone can view frontend code and steal them. Instead, use an "Unsigned Upload Preset".
const cloudinaryConfig = {
  cloudName: "daoz8m2oh",
  uploadPreset: "ml_lanica",
};

// Meshy API Configuration
// SECURITY WARNING: In frontend JS, putting your API Key exposes it to anyone.
// Best practice is to use a backend server. Use this for testing/development.
const meshyConfig = {
  apiKey: "msy_MjNcfrt0xvjdoYRrI843GqmvI0yFDNe9dZfH", // e.g., msy_xxxxxxxxxxxxxxxxxxx
};

let currentUser = null;

// Protect Admin Route (admin role only)
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  currentUser = user;
  const role = await getUserRole(user);
  if (role !== "admin") {
    window.location.replace("/staff.html");
  }
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
}

// Helper function to upload an image/video to Cloudinary and return its URL
async function uploadImage(file, path) {
  if (!file) return null;

  const url = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/auto/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", cloudinaryConfig.uploadPreset);

  // Optional: You can organize files into a folder
  formData.append("folder", "lanica_products");

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    console.error("Cloudinary error response:", await response.text());
    throw new Error("Failed to upload media to Cloudinary");
  }

  const data = await response.json();
  return data.secure_url; // Return the secure Cloudinary URL
}

async function waitForMeshyModelUrl(taskId, maxAttempts = 40, delayMs = 3000) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const statusRes = await fetch(`https://api.meshy.ai/v1/image-to-3d/${taskId}`, {
        headers: { Authorization: `Bearer ${meshyConfig.apiKey}` },
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const status = String(statusData.status || "").toUpperCase();
        if (status === "SUCCEEDED") {
          const url =
            (statusData.model_urls && (statusData.model_urls.glb || statusData.model_urls.usdz)) || null;
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

// Add / Update Product
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  submitBtn.textContent = "Saving...";
  submitBtn.disabled = true;

  try {
    const transparentImageFile = document.getElementById("img-bg").files[0];
    const imageFiles = {
      isoImage: document.getElementById("img-iso").files[0],
      bgImage: transparentImageFile,
    };

    const existingImages = isEditing ? JSON.parse(productForm.dataset.existingImages || "{}") : {};

    // Helper to get URL: Check if new file uploaded, else keep existing
    const getImageUrl = async (key) => {
      if (imageFiles[key]) {
        const uniqueName = `${Date.now()}_${imageFiles[key].name}`;
        return await uploadImage(imageFiles[key], `products/${uniqueName}`);
      }
      return existingImages[key] || "";
    };

    // Upload all selected files concurrently
    const [isoImage, bgImage] = await Promise.all([
      getImageUrl("isoImage"),
      getImageUrl("bgImage"),
    ]);

    // Keep previous Meshy artifacts only when we are NOT regenerating from a new transparent image.
    let meshyTaskId = isEditing ? productForm.dataset.meshyTaskId || null : null;
    let modelUrl = isEditing ? productForm.dataset.modelUrl || null : null;
    let meshyStatus = isEditing ? productForm.dataset.meshyStatus || null : null;
    const shouldRegenerateMeshy = !!transparentImageFile;
    if (shouldRegenerateMeshy) {
      // Explicitly clear old task id so stale/expired ids are never kept
      // when a new transparent image is uploaded during edit.
      meshyTaskId = null;
      modelUrl = null;
      meshyStatus = "PENDING";
    }

    // Meshy source should always be the transparent-background asset, never the thumbnail.
    const meshySourceImageUrl = bgImage || existingImages.bgImage || existingImages.frontBg || "";

    // Automatically trigger Meshy.ai API only when a NEW transparent background image was uploaded.
    if (shouldRegenerateMeshy) {
      if (meshyConfig.apiKey === "YOUR_MESHY_API_KEY") {
        throw new Error("Meshy API key is missing. Cannot regenerate 3D model.");
      }
      if (!meshySourceImageUrl) {
        throw new Error("Transparent background image is required for Meshy generation.");
      }
      submitBtn.textContent = isEditing
        ? "Regenerating 3D Model..."
        : "Starting 3D Generation...";
      try {
        // Send Cloudinary URL of the transparent image to Meshy image-to-3d endpoint
        const payload = { image_url: meshySourceImageUrl, enable_pbr: true };

        const meshyResponse = await fetch("https://api.meshy.ai/v1/image-to-3d", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${meshyConfig.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (meshyResponse.ok) {
          const meshyData = await meshyResponse.json();
          meshyTaskId = meshyData.result; // Fresh Task ID returned by Meshy
          meshyStatus = "PENDING";
          console.log("Meshy 3D Generation started! Task ID:", meshyTaskId);

          // Poll best-effort to fetch fresh model URL, but do not abort the product save
          // if Meshy status polling temporarily fails after token has already been consumed.
          let isGenerating = true;
          let pollAttempts = 0;
          while (isGenerating && pollAttempts < 10) {
            pollAttempts += 1;
            try {
              const statusRes = await fetch(`https://api.meshy.ai/v1/image-to-3d/${meshyTaskId}`, {
                headers: { Authorization: `Bearer ${meshyConfig.apiKey}` },
              });

              if (statusRes.ok) {
                const statusData = await statusRes.json();
                const status = String(statusData.status || "").toUpperCase();
                meshyStatus = status || meshyStatus;
                if (status === "SUCCEEDED") {
                  modelUrl =
                    (statusData.model_urls && (statusData.model_urls.glb || statusData.model_urls.usdz)) || null;
                  submitBtn.textContent = "3D Finished! Saving Product...";
                  isGenerating = false;
                } else if (status === "IN_PROGRESS" || status === "PENDING") {
                  submitBtn.textContent = `Generating 3D: ${statusData.progress || 0}%...`;
                  await new Promise((r) => setTimeout(r, 3000));
                } else {
                  // Failed/cancelled jobs should persist status, but still allow save.
                  isGenerating = false;
                }
              } else {
                // Stop polling but keep the new task id; viewer can continue polling later.
                isGenerating = false;
              }
            } catch (pollErr) {
              console.warn("Meshy status polling interrupted, saving with new task ID:", pollErr);
              isGenerating = false;
            }
          }
        } else {
          console.error("Meshy error:", await meshyResponse.text());
          throw new Error("Failed to start Meshy API");
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
      stock,
      material,
      size: document.getElementById("product-size").value,
      color: document.getElementById("product-color").value,
      images: { isoImage, bgImage },
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

    // Ensure regenerated products eventually store BOTH meshyTaskId and modelUrl.
    // If modelUrl was not ready during the initial save, finalize it now.
    if (shouldRegenerateMeshy && meshyTaskId && !modelUrl && savedProductRef) {
      submitBtn.textContent = "Finalizing 3D model URL...";
      const finalMeshy = await waitForMeshyModelUrl(meshyTaskId, 40, 3000);
      await updateDoc(savedProductRef, {
        meshyStatus: finalMeshy.status,
        modelUrl: finalMeshy.modelUrl || null,
        updatedAt: Timestamp.now(),
      });
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

// Show percentage while downloading the heavy .glb file into the browser
modelViewer.addEventListener("progress", (e) => {
  const progress = e.detail.totalProgress;
  if (progress < 1) {
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = `Downloading and Opening 3D Model... ${Math.round(progress * 100)}%`;
    setViewerLoading(true, "Calibrating 3D object...");
  } else {
    viewerStatus.style.visibility = "hidden";
    setViewerLoading(false);
  }
});

async function fetchLatestMeshyTaskId(productId) {
  const pRef = doc(db, "products", productId);
  const snap = await getDoc(pRef);
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.meshyTaskId || null;
}

async function pollMeshyAndLoad(taskId, attempt = 0) {
  const response = await fetch(`https://api.meshy.ai/v1/image-to-3d/${taskId}`, {
    headers: { Authorization: `Bearer ${meshyConfig.apiKey}` },
  });

  if (!response.ok) throw new Error("Failed to fetch status. Check your API Key.");

  const data = await response.json();
  const status = String(data.status || "").toUpperCase();
  const progress = Number(data.progress || 0);

  if (status === "SUCCEEDED" && data.model_urls && data.model_urls.glb) {
    viewerStatus.style.visibility = "visible";
    viewerStatus.textContent = "Starting 3D download...";
    setViewerLoading(true, "Calibrating 3D object...");
    const proxiedGlbUrl = `/api/meshy-glb?url=${encodeURIComponent(data.model_urls.glb)}`;
    modelViewer.src = proxiedGlbUrl;
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
  // Clear out previous model temporarily to show grey box while checking status
  modelViewer.src = "";

  try {
    const taskId = await fetchLatestMeshyTaskId(productId);
    if (!taskId) {
      setViewerLoading(false);
      viewerStatus.textContent = "No Meshy task found for this product yet.";
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
  modelViewer.src = "";
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

    document.getElementById("product-stock").value = product.stock || 0;
    document.getElementById("product-material").value = product.material || "Fabric";
    document.getElementById("product-size").value = product.size || "";
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
                      product.meshyTaskId
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

function renderLowStockWatchlist(products) {
  if (!analyticsLowStockListEl) return;
  const lowItems = products
    .filter((p) => Number(p.stock) > 0 && Number(p.stock) < 10)
    .sort((a, b) => Number(a.stock) - Number(b.stock))
    .slice(0, 6);

  if (!lowItems.length) {
    analyticsLowStockListEl.innerHTML = `<div class="analytics-empty">No low-stock items right now.</div>`;
    return;
  }

  analyticsLowStockListEl.innerHTML = lowItems
    .map(
      (p) => `<div class="analytics-watch-item">
      <span class="analytics-watch-name">${escapeHtml(p.name || "Unnamed Product")}</span>
      <span class="analytics-watch-stock">${Number(p.stock) || 0} left</span>
    </div>`
    )
    .join("");
}

const updateStats = (products) => {
  let totalItems = products.length;
  let lowStockCount = products.filter((p) => p.stock < 10 && p.stock > 0).length;
  let outOfStockCount = products.filter((p) => p.stock === 0).length;
  let totalValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);
  const totalUnits = products.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  const avgPrice = totalItems ? products.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / totalItems : 0;
  const avgStockPerProduct = totalItems ? totalUnits / totalItems : 0;

  const materialUnits = products.reduce((acc, p) => {
    const key = String(p.material || "Unspecified").trim() || "Unspecified";
    acc[key] = (acc[key] || 0) + (Number(p.stock) || 0);
    return acc;
  }, {});
  const categoryUnits = products.reduce((acc, p) => {
    const key = String(p.category || "Uncategorized").trim() || "Uncategorized";
    acc[key] = (acc[key] || 0) + (Number(p.stock) || 0);
    return acc;
  }, {});

  totalProductsStat.textContent = totalItems;
  lowStockStat.textContent = lowStockCount; // Could combine or show separately

  // Format currency
  totalValueStat.textContent =
    "₱" +
    totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (analyticsTotalUnitsEl) analyticsTotalUnitsEl.textContent = String(totalUnits);
  if (analyticsOutOfStockEl) analyticsOutOfStockEl.textContent = String(outOfStockCount);
  if (analyticsAvgPriceEl) {
    analyticsAvgPriceEl.textContent =
      "₱" + avgPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (analyticsAvgStockEl) analyticsAvgStockEl.textContent = avgStockPerProduct.toFixed(1);

  const materialEntries = Object.entries(materialUnits).sort((a, b) => b[1] - a[1]);
  const categoryEntries = Object.entries(categoryUnits).sort((a, b) => b[1] - a[1]).slice(0, 8);
  renderBars(analyticsMaterialBarsEl, materialEntries, totalUnits);
  renderBars(analyticsCategoryBarsEl, categoryEntries, totalUnits);
  renderLowStockWatchlist(products);
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
const navInventory = document.getElementById("nav-inventory");
const navOrders = document.getElementById("nav-orders");
const navUsers = document.getElementById("nav-users");
const inventorySection = document.getElementById("inventory-section");
const ordersSection = document.getElementById("orders-section");
const usersSection = document.getElementById("users-section");

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
    if (roleByUid.exists()) return (roleByUid.data().role || "").toLowerCase();
  } catch (e) {
    console.warn("Could not read user role by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return ((snap.docs[0].data() || {}).role || "").toLowerCase();
    }
  } catch (e) {
    console.warn("Could not read user role by email:", e);
  }
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
    (order.shippingAddress && pickFirstNonEmpty(order.shippingAddress.fullName, order.shippingAddress.name)) ||
    (order.deliveryAddress && pickFirstNonEmpty(order.deliveryAddress.fullName, order.deliveryAddress.name)) ||
    (order.address && pickFirstNonEmpty(order.address.fullName, order.address.name)) ||
    (order.shippingInfo && pickFirstNonEmpty(order.shippingInfo.fullName, order.shippingInfo.name)) ||
    (order.customer && pickFirstNonEmpty(order.customer.fullName, order.customer.name)) ||
    "";

  return pickFirstNonEmpty(
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
  ) || "—";
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
  if (raw == null) return "pending";
  const s = String(raw).toLowerCase().trim();
  if (
    ["pending", "accepted", "processing", "shipped", "delivered", "declined", "completed", "received"].includes(
      s
    )
  )
    return s;
  return "pending";
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

function materialHint(m) {
  const x = (m == null ? "" : String(m)).toLowerCase();
  if (x.includes("leather")) return "leather";
  if (x.includes("fabric")) return "fabric";
  return null;
}

function showAdminSection(name) {
  const showInv = name === "inventory";
  const showOrders = name === "orders";
  const showUsers = name === "users";
  if (inventorySection) inventorySection.classList.toggle("is-hidden", !showInv);
  if (ordersSection) ordersSection.classList.toggle("is-hidden", !showOrders);
  if (usersSection) usersSection.classList.toggle("is-hidden", !showUsers);
  if (navInventory) navInventory.classList.toggle("active", showInv);
  if (navOrders) navOrders.classList.toggle("active", showOrders);
  if (navUsers) navUsers.classList.toggle("active", showUsers);
}

if (navInventory) {
  navInventory.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("inventory");
  });
}
if (navOrders) {
  navOrders.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("orders");
  });
}
if (navUsers) {
  navUsers.addEventListener("click", (e) => {
    e.preventDefault();
    showAdminSection("users");
  });
}

async function loadStaffMembers() {
  try {
    // Read all users and filter client-side so role casing like "Staff"/"STAFF" still works.
    const snap = await getDocs(collection(db, "users"));
    staffMembers = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => String(u.role || "").toLowerCase().trim() === "staff")
      .map((u) => ({
        uid: u.uid || u.id,
        email: u.email || "",
        displayName: u.displayName || u.name || u.email || u.id,
      }))
      .filter((u) => !!u.uid);

    // Re-render orders once staff list is ready so assignment dropdown gets populated.
    applyOrdersFilter();
  } catch (e) {
    console.warn("Could not load staff users (check Firestore rules / index):", e);
    staffMembers = [];
  }
}

loadStaffMembers();

function normalizeUserRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "admin" || r === "staff" || r === "customer") return r;
  return "customer";
}

function normalizeUserStatus(status) {
  const s = String(status || "").trim().toLowerCase();
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
  if (usersFilterValue === "admin" || usersFilterValue === "staff" || usersFilterValue === "customer") {
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
    applyUsersFilter();
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
    if (!(roleSelect instanceof HTMLSelectElement) || !(statusSelect instanceof HTMLSelectElement)) return;

    const role = normalizeUserRole(roleSelect.value);
    const status = normalizeUserStatus(statusSelect.value);

    try {
      t.setAttribute("disabled", "true");
      t.textContent = "Saving...";
      await updateDoc(doc(db, "users", docId), {
        role,
        status,
        updatedAt: Timestamp.now(),
        updatedByUid: currentUser ? currentUser.uid : null,
      });
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
  const counts = { pending: 0, accepted: 0, processing: 0, shipped: 0 };
  orders.forEach((o) => {
    const st = normalizeOrderStatus(o.status);
    if (counts[st] !== undefined) counts[st]++;
  });
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(n);
  };
  set("orders-pending", counts.pending);
  set("orders-processing", counts.accepted);
  set("orders-shipped", counts.processing);
  set("orders-delivered", counts.shipped);
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
  updateOrderStats(allOrders);
  syncBatchDeleteUi();
}

function getVisibleDeclinedCheckboxes() {
  if (!ordersListEl) return [];
  return Array.from(ordersListEl.querySelectorAll(".declined-order-checkbox"));
}

function syncBatchDeleteUi() {
  if (ordersSelectHeaderEl) ordersSelectHeaderEl.classList.toggle("is-hidden", !isBatchDeleteMode);
  if (batchDeleteControlsEl) batchDeleteControlsEl.classList.toggle("is-hidden", !isBatchDeleteMode);
  if (toggleBatchDeleteModeBtn) {
    toggleBatchDeleteModeBtn.textContent = isBatchDeleteMode ? "Exit Batch Delete" : "Batch Delete Mode";
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
    (o) => normalizeOrderStatus(o.status) === "declined" && normalizeOrderAction(o.action) !== "delete"
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
    issues.push(
      `${invalidQtyCount} line${invalidQtyCount > 1 ? "s" : ""} with invalid quantity`
    );
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
        <select class="order-assign-select" data-order-id="${escapeHtml(order.id)}" aria-label="Assign rider">
          <option value="">Unassigned</option>
          ${staffMembers
            .map((s) => {
              const sel = order.assignedToUid === s.uid ? "selected" : "";
              return `<option value="${escapeHtml(s.uid)}" ${sel}>${escapeHtml(s.displayName)}</option>`;
            })
            .join("")}
        </select>
      </td>
      <td>
        ${
          st === "pending"
            ? `<div class="order-action-group">
                <button class="btn-icon order-action-btn order-action-accept btn-accept-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Accept order" title="Accept">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
                <button class="btn-icon order-action-btn order-action-decline btn-decline-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Decline order" title="Decline">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>`
            : st === "declined"
              ? `<button class="btn-icon order-action-btn order-action-delete btn-delete-order" data-order-id="${escapeHtml(
                  order.id
                )}" aria-label="Delete declined order" title="Delete">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>`
            : `<span style="font-size:0.82rem;color:#6b7280;">No action</span>`
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
  if (prev !== "pending") return;

  const items = Array.isArray(current.items) ? current.items : [];
  if (items.length === 0) {
    alert("This order has no items.");
    return;
  }

  for (const it of items) {
    if (!it.productId) {
      alert("This order has a line without productId. Fix the order data first.");
      return;
    }
  }

  if (!current.assignedToUid) {
    alert("Assign a staff member first before accepting the order.");
    return;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const oSnap = await transaction.get(orderRef);
      if (!oSnap.exists()) throw new Error("Order missing");
      const oData = oSnap.data();
      const latestStatus = normalizeOrderStatus(oData.status);
      if (latestStatus !== "pending") return;

      transaction.update(orderRef, {
        status: "accepted",
        stockDeducted: !!oData.stockDeducted,
        acceptedAt: Timestamp.now(),
        acceptedByUid: currentUser ? currentUser.uid : null,
        updatedAt: Timestamp.now(),
      });
    });
  } catch (e) {
    console.error(e);
    alert(e.message || "Could not accept order.");
  }
}

async function handleOrderDecline(orderId) {
  const orderRef = doc(db, "orders", orderId);
  const current = allOrders.find((o) => o.id === orderId);
  if (!current) return;

  const prev = normalizeOrderStatus(current.status);
  if (prev !== "pending") return;

  if (!confirm("Decline this order?")) return;

  try {
    await updateDoc(orderRef, {
      status: "declined",
      declinedAt: Timestamp.now(),
      declinedByUid: currentUser ? currentUser.uid : null,
      updatedAt: Timestamp.now(),
    });
  } catch (e) {
    console.error(e);
    alert("Could not decline order.");
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
  try {
    await updateDoc(orderRef, {
      assignedToUid: staffUid || null,
      assignedToName: staff ? staff.displayName : null,
      updatedAt: Timestamp.now(),
    });
  } catch (e) {
    console.error(e);
    alert("Failed to assign rider.");
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

syncBatchDeleteUi();
