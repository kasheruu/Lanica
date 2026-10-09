import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
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
  db,
  ensureAuth,
  subscribeToCart,
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  getUserAddresses,
  saveUserAddress,
  placeOrderAtomic,
  getAvailableStock,
  parsePrice,
  fetchWishlist,
  toggleWishlist,
  isItemInWishlist,
  getLocalWishlist,
} from "./cartService.js";

import { getCachedModelUrl } from "./modelCacheService.js";

import {
  getCustomerOrders,
  sendChatMessage,
  subscribeToMessages,
  subscribeToUserSupportMessages,
  markUserSupportMessagesAsRead,
  uploadChatAttachment,
} from "./chatService.js";

// Global State
let currentUser = null;
let currentCartItems = [];
let allProductsList = [];
let currentModalProduct = null;
let pdpQuantity = 1;

// Helper: Fallback Catalog when Firestore returns partial data or errors
function getFallbackProductsList() {
  return [
    {
      id: "prod-aura-cloud-sofa",
      name: "Aura Cloud Sofa",
      category: "sofa",
      price: 1299,
      description:
        "Sink-in comfort with high-resilience memory foam & stain-resistant boucle linen upholstery.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "36 × 64 in",
      FabricStocks: 12,
      LeatherStocks: 5,
    },
    {
      id: "prod-lumina-accent-chair",
      name: "Lumina Accent Chair",
      category: "chair",
      price: 549,
      description:
        "Ergonomic curved silhouette with solid mahogany wood base & Italian leather cushion.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "30 × 32 in",
      FabricStocks: 8,
      LeatherStocks: 4,
    },
    {
      id: "prod-minimalist-oak-table",
      name: "Minimalist Oak Coffee Table",
      category: "table",
      price: 899,
      description:
        "Sustainably sourced white oak table with soft rounded edges & water-resistant matte finish.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "48 × 24 in",
      FabricStocks: 15,
      LeatherStocks: 10,
    },
    {
      id: "prod-velvet-swivel-armchair",
      name: "Velvet Swivel Armchair",
      category: "chair",
      price: 699,
      description:
        "360-degree silent brass swivel base wrapped in plush jewel-toned velvet fabric.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "32 × 34 in",
      FabricStocks: 6,
      LeatherStocks: 2,
    },
    {
      id: "prod-golden-arch-floor-lamp",
      name: "Golden Arch Floor Lamp",
      category: "lamp",
      price: 299,
      description:
        "Brushed brass arching arm with heavy marble base & warm ambient LED bulb included.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "18 × 72 in",
      FabricStocks: 20,
      LeatherStocks: 20,
    },
    {
      id: "prod-modular-sectional-sofa",
      name: "Modular Sectional Sofa",
      category: "sofa",
      price: 1899,
      description:
        "Customizable 4-piece sectional arrangement with deep seats & removable machine-washable covers.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      dimensions: "108 × 68 in",
      FabricStocks: 4,
      LeatherStocks: 2,
    },
  ];
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function getProductThumbnails(product) {
  let thumbs = [];
  if (Array.isArray(product.images) && product.images.length > 0) {
    thumbs = product.images.filter(Boolean);
  } else if (Array.isArray(product.thumbnails) && product.thumbnails.length > 0) {
    thumbs = product.thumbnails.filter(Boolean);
  }
  if (thumbs.length === 0 && (product.imageUrl || product.image || product.thumbnail)) {
    thumbs.push(product.imageUrl || product.image || product.thumbnail);
  }
  if (thumbs.length === 0) {
    thumbs.push("assets/product_sofa.png");
  }
  return thumbs;
}

function updateWishlistBadges(wishlist) {
  const list = wishlist || getLocalWishlist();
  const count = list.length;
  const badge = document.getElementById("wishlist-badge");
  const countBadge = document.getElementById("wishlist-count-badge");

  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
  }
  if (countBadge) {
    countBadge.textContent = count;
  }
}

function initAnimations() {
  const observerOptions = { threshold: 0.1 };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
      }
    });
  }, observerOptions);

  document.querySelectorAll(".slide-up, .reveal").forEach((el) => {
    observer.observe(el);
    el.classList.add("active");
  });
}

// Render Wishlist Grid
function renderWishlistGrid() {
  const container = document.getElementById("wishlist-products-grid");
  if (!container) return;

  const wishlistRaw = getLocalWishlist();
  const wishlistIds = wishlistRaw.map((item) => String(item && item.id ? item.id : item));

  // Map each saved wishlist ID to a product from allProductsList or fallback catalog
  const wishlistProducts = [];
  wishlistIds.forEach((savedId) => {
    let found = allProductsList.find((p) => String(p.id) === savedId);
    if (!found) {
      const fallbackList = getFallbackProductsList();
      found = fallbackList.find((p) => String(p.id) === savedId);
    }
    if (!found && savedId) {
      found = {
        id: savedId,
        name: "Handcrafted Furniture Piece",
        category: "sofa",
        price: 1299,
        description: "Premium handcrafted Lanica furniture piece.",
        image: "assets/product_sofa.png",
        thumbnail: "assets/product_sofa.png",
      };
    }
    if (found && !wishlistProducts.some((p) => String(p.id) === String(found.id))) {
      wishlistProducts.push(found);
    }
  });

  updateWishlistBadges(wishlistRaw);

  if (wishlistProducts.length === 0) {
    container.innerHTML = `
      <div class="empty-state-container" style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 60px 20px; background: #ffffff; border-radius: 24px; border: 1px dashed #e5e7eb; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
        <div style="width: 80px; height: 80px; border-radius: 50%; background: #fef2f2; color: #ef4444; display: inline-flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.15);">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </div>
        <h3 class="empty-state-title" style="font-size: 1.4rem; font-weight: 700; color: #111827; margin-bottom: 8px;">Your Wishlist is Empty</h3>
        <p class="empty-state-subtitle" style="color: #6b7280; font-size: 0.95rem; max-width: 440px; margin: 0 auto 24px; line-height: 1.5;">
          You haven't saved any furniture models yet. Browse our handcrafted catalog and click the heart icon on any piece to save it here.
        </p>
        <a href="products.html" class="btn-primary" style="display: inline-flex; align-items: center; gap: 8px; text-decoration: none; padding: 12px 28px; border-radius: 12px; font-weight: 600;">
          <span>Explore Furniture</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  let delay = 0.05;

  wishlistProducts.forEach((product) => {
    const thumbnails = getProductThumbnails(product);
    const hasMultipleThumbs = thumbnails.length >= 2;
    const priceFormatted = parseFloat(product.price || 0).toLocaleString();

    const imageSectionHTML = hasMultipleThumbs
      ? `
        <div class="product-image-container card-slideshow" data-product-id="${product.id}">
          <div class="card-slideshow-track">
            ${thumbnails
              .map(
                (src, i) => `
              <div class="card-slideshow-slide ${i === 0 ? "active" : ""}">
                <img src="${src}" alt="${escapeHtml(product.name)} - View ${i + 1}" class="product-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
              </div>
            `
              )
              .join("")}
          </div>
          <button type="button" class="card-slideshow-btn prev" aria-label="Previous view">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button type="button" class="card-slideshow-btn next" aria-label="Next view">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <div class="card-slideshow-dots">
            ${thumbnails
              .map(
                (_, i) => `
              <span class="card-slideshow-dot ${i === 0 ? "active" : ""}" data-index="${i}"></span>
            `
              )
              .join("")}
          </div>
          <button class="btn-ar-view" data-product-id="${product.id}" title="View in 3D / AR">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>3D</span>
          </button>
          <button type="button" class="btn-wishlist-heart active" data-product-id="${product.id}" title="Remove from Wishlist">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
        </div>
      `
      : `
        <div class="product-image-container">
          <img src="${thumbnails[0]}" alt="${escapeHtml(product.name)}" class="product-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <button class="btn-ar-view" data-product-id="${product.id}" title="View in 3D / AR">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>3D</span>
          </button>
          <button type="button" class="btn-wishlist-heart active" data-product-id="${product.id}" title="Remove from Wishlist">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
        </div>
      `;

    const productHTML = `
      <div class="product-card active reveal" data-product-id="${product.id}" style="--delay: ${delay}s">
        ${imageSectionHTML}
        <div class="product-info">
          <h3>${escapeHtml(product.name)}</h3>
          <div class="price-row" style="margin-bottom: 12px;">
            <span class="price">₱${priceFormatted}</span>
            <span class="price-badge-tag">${escapeHtml((product.category || "SOFA").toUpperCase())}</span>
          </div>
          <div class="wishlist-card-actions" style="display: flex; gap: 8px; margin-top: 10px;">
            <button type="button" class="btn-primary btn-move-cart" data-product-id="${product.id}" style="flex: 1; padding: 10px 14px; font-size: 0.85rem; border-radius: 10px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>Add to Bag</span>
            </button>
            <button type="button" class="btn-secondary btn-card-details" data-product-id="${product.id}" title="Quick View" style="padding: 10px; border-radius: 10px; border: 1.5px solid #e5e7eb; display: inline-flex; align-items: center; justify-content: center;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    container.insertAdjacentHTML("beforeend", productHTML);
    delay += 0.05;
  });

  bindProductCardButtons();
  initAnimations();
}

function bindProductCardButtons() {
  bindARButtons();

  // Card details trigger
  document.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (
        e.target.closest(".btn-ar-view") ||
        e.target.closest(".btn-wishlist-heart") ||
        e.target.closest(".btn-move-cart") ||
        e.target.closest(".card-slideshow-btn") ||
        e.target.closest(".card-slideshow-dot")
      ) {
        return;
      }
      const productId = card.getAttribute("data-product-id");
      const prod = allProductsList.find((p) => String(p.id) === String(productId));
      if (prod) {
        openProductModal(prod);
      }
    });
  });

  // Explicit Quick View details button
  document.querySelectorAll(".btn-card-details").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const productId = btn.getAttribute("data-product-id");
      const prod = allProductsList.find((p) => String(p.id) === String(productId));
      if (prod) openProductModal(prod);
    });
  });

  // Move to Cart / Add to Bag Button
  document.querySelectorAll(".btn-move-cart").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const productId = btn.getAttribute("data-product-id");
      const prod = allProductsList.find((p) => String(p.id) === String(productId));
      if (!prod) return;

      const res = await addToCart(currentUser?.uid, prod, 1);
      if (res.success) {
        showToast(`Added ${prod.name || "furniture item"} to shopping bag!`, "success");
        const cartDrawerOverlay = document.getElementById("cart-drawer-overlay");
        if (cartDrawerOverlay) {
          cartDrawerOverlay.classList.add("active");
          document.body.style.overflow = "hidden";
        }
      }
    });
  });

  // Un-save / Heart button handler
  document.querySelectorAll(".btn-wishlist-heart").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const productId = btn.getAttribute("data-product-id");
      if (!productId) return;

      const res = await toggleWishlist(productId, currentUser?.uid);
      showToast(res.isFav ? "Saved to wishlist!" : "Removed from wishlist", "success");
      renderWishlistGrid();
    });
  });

  initCardSlideshows();
}

function initCardSlideshows() {
  document.querySelectorAll(".card-slideshow").forEach((container) => {
    const track = container.querySelector(".card-slideshow-track");
    const slides = container.querySelectorAll(".card-slideshow-slide");
    const dots = container.querySelectorAll(".card-slideshow-dot");
    const prevBtn = container.querySelector(".card-slideshow-btn.prev");
    const nextBtn = container.querySelector(".card-slideshow-btn.next");
    if (!track || slides.length < 2) return;

    let currentIndex = 0;
    let autoInterval = null;

    function goToSlide(index) {
      currentIndex = (index + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle("active", i === currentIndex));
      dots.forEach((d, i) => d.classList.toggle("active", i === currentIndex));
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(currentIndex - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(currentIndex + 1);
      });
    }

    dots.forEach((dot) => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(dot.getAttribute("data-index"), 10);
        goToSlide(idx);
      });
    });

    function startAutoSlide() {
      if (autoInterval) clearInterval(autoInterval);
      autoInterval = setInterval(() => goToSlide(currentIndex + 1), 4000);
    }

    function stopAutoSlide() {
      if (autoInterval) clearInterval(autoInterval);
    }

    container.addEventListener("mouseenter", stopAutoSlide);
    container.addEventListener("mouseleave", startAutoSlide);
    startAutoSlide();
  });
}

function bindARButtons() {
  document.querySelectorAll(".btn-ar-view").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const productId = btn.getAttribute("data-product-id");
      const prod = allProductsList.find((p) => String(p.id) === String(productId));
      if (prod) openARModal(prod);
    });
  });
}

async function openARModal(product) {
  const arModal = document.getElementById("ar-modal");
  const arViewer = document.getElementById("ar-viewer");
  const arTitle = document.getElementById("ar-model-title");

  if (!arModal || !arViewer) return;

  if (arTitle) {
    arTitle.textContent = `3D & AR View · ${product.name || "Furniture Model"}`;
  }

  const glbUrl = product.glbUrl || product.modelUrl || "";
  const usdzUrl = product.usdzUrl || "";

  if (!glbUrl) {
    showToast("3D model file is not available for this item.", "info");
    return;
  }

  const cachedUrl = await getCachedModelUrl(glbUrl);
  arViewer.setAttribute("src", cachedUrl);
  if (usdzUrl) {
    arViewer.setAttribute("ios-src", usdzUrl);
  } else {
    arViewer.removeAttribute("ios-src");
  }

  arModal.classList.add("active");
  document.body.style.overflow = "hidden";
}

// Fetch Catalog Products with Fallback Catalog Merging
async function loadCatalogProducts() {
  let firestoreProducts = [];
  try {
    const snap = await getDocs(collection(db, "products"));
    firestoreProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("Error fetching products from Firestore:", err);
  }

  const fallbackProducts = getFallbackProductsList();

  const productMap = new Map();
  fallbackProducts.forEach((p) => productMap.set(String(p.id), p));
  firestoreProducts.forEach((p) => productMap.set(String(p.id), p));

  // Ensure any saved wishlist item ID missing from productMap gets a displayable object
  const wishlistIds = getLocalWishlist();
  wishlistIds.forEach((savedId) => {
    const strId = String(savedId);
    if (!productMap.has(strId)) {
      productMap.set(strId, {
        id: savedId,
        name: `Handcrafted Furniture Piece`,
        category: "sofa",
        price: 999,
        description: "Premium handcrafted Lanica furniture piece.",
        image: "assets/product_sofa.png",
        thumbnail: "assets/product_sofa.png",
      });
    }
  });

  allProductsList = Array.from(productMap.values());
  renderWishlistGrid();
}

// PDP Quick View Modal Logic
function openProductModal(product) {
  currentModalProduct = product;
  pdpQuantity = 1;

  const modal = document.getElementById("product-detail-modal");
  if (!modal) return;

  document.getElementById("pv-name").textContent = product.name || "Furniture Piece";
  document.getElementById("pv-price").textContent = `₱${parseFloat(product.price || 0).toLocaleString()}`;
  document.getElementById("pv-category-badge").textContent = (product.category || "SOFA").toUpperCase();

  const isMTO = (product.inventory_status || "made_to_order") === "made_to_order";
  const stockQty = getAvailableStock(product);

  const stockStatusEl = document.getElementById("pv-stock-status");
  const leadtimeEl = document.getElementById("pv-leadtime-badge");
  const addCartLabel = document.getElementById("pdp-add-cart-label");

  if (isMTO || stockQty <= 0) {
    stockStatusEl.textContent = "Pre-Order / Made to Order";
    stockStatusEl.style.background = "#fff7ed";
    stockStatusEl.style.color = "#c2410c";
    leadtimeEl.textContent = "MTO (~21-28 days)";
    addCartLabel.textContent = "Pre-Order Now";
  } else {
    stockStatusEl.textContent = `In Stock (${stockQty} left)`;
    stockStatusEl.style.background = "#f0fdf4";
    stockStatusEl.style.color = "#15803d";
    leadtimeEl.textContent = "In Stock (Fast Shipping)";
    addCartLabel.textContent = "Add to Cart";
  }

  const dimInfo = document.getElementById("pv-dimensions-info");
  if (dimInfo) {
    dimInfo.textContent = product.dimensions || product.size || "Standard Handcrafted Dimensions";
  }

  const mainImg = document.getElementById("pv-image");
  const thumbnails = getProductThumbnails(product);
  mainImg.src = thumbnails[0];

  const qtyInput = document.getElementById("pdp-qty-input");
  if (qtyInput) qtyInput.value = 1;

  recalculatePdpTotals();
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function recalculatePdpTotals() {
  if (!currentModalProduct) return;
  const basePrice = parseFloat(currentModalProduct.price || 0);
  let total = basePrice * pdpQuantity;
  const stickyPriceEl = document.getElementById("pdp-sticky-price");
  if (stickyPriceEl) {
    stickyPriceEl.textContent = `₱${total.toLocaleString()}`;
  }
}

// Cart Drawer Handling
function updateCartUI(cartItems) {
  currentCartItems = cartItems || [];
  const cartBadge = document.getElementById("cart-badge");
  const totalCount = currentCartItems.reduce((acc, item) => acc + (item.quantity || 1), 0);
  if (cartBadge) {
    cartBadge.textContent = totalCount;
    cartBadge.style.display = totalCount > 0 ? "flex" : "none";
  }

  const container = document.getElementById("cart-items-container");
  const subtotalEl = document.getElementById("cart-subtotal-display");
  const checkoutBtn = document.getElementById("proceed-checkout-btn");

  if (!container) return;

  if (currentCartItems.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <p>Your shopping bag is empty.</p>
      </div>
    `;
    if (subtotalEl) subtotalEl.textContent = "₱0";
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  let subtotal = 0;
  container.innerHTML = "";

  currentCartItems.forEach((item) => {
    const price = parsePrice(item.price);
    const itemTotal = price * (item.quantity || 1);
    subtotal += itemTotal;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <img src="${item.imageUrl || "assets/product_sofa.png"}" alt="${escapeHtml(item.name)}" class="cart-item-img">
      <div class="cart-item-details">
        <h4>${escapeHtml(item.name)}</h4>
        <div class="cart-item-price">₱${price.toLocaleString()}</div>
        <div class="cart-item-qty">
          <button class="cart-qty-btn minus" data-id="${item.id}">-</button>
          <span>${item.quantity || 1}</span>
          <button class="cart-qty-btn plus" data-id="${item.id}">+</button>
          <button class="cart-remove-btn" data-id="${item.id}">Remove</button>
        </div>
      </div>
    `;
    container.appendChild(div);
  });

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (checkoutBtn) checkoutBtn.disabled = false;

  container.querySelectorAll(".cart-qty-btn.minus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => String(i.id) === String(id));
      if (item && item.quantity > 1) {
        updateCartItemQuantity(currentUser?.uid, id, item.quantity - 1);
      } else {
        removeCartItem(currentUser?.uid, id);
      }
    });
  });

  container.querySelectorAll(".cart-qty-btn.plus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => String(i.id) === String(id));
      if (item) {
        updateCartItemQuantity(currentUser?.uid, id, item.quantity + 1);
      }
    });
  });

  container.querySelectorAll(".cart-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      removeCartItem(currentUser?.uid, id);
    });
  });
}

// Global Event Listeners & Setup
document.addEventListener("DOMContentLoaded", () => {
  // Mobile Nav Toggle
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const navLinks = document.querySelector(".nav-links");
  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener("click", () => {
      const expanded = mobileMenuBtn.getAttribute("aria-expanded") === "true";
      mobileMenuBtn.setAttribute("aria-expanded", !expanded);
      navLinks.classList.toggle("active");
    });
  }

  // Cart Overlay Toggle
  const cartToggleBtn = document.getElementById("cart-toggle-btn");
  const closeCartBtn = document.getElementById("close-cart-btn");
  const cartDrawerOverlay = document.getElementById("cart-drawer-overlay");

  if (cartToggleBtn && cartDrawerOverlay) {
    cartToggleBtn.addEventListener("click", () => {
      cartDrawerOverlay.classList.add("active");
      document.body.style.overflow = "hidden";
    });
  }
  if (closeCartBtn && cartDrawerOverlay) {
    closeCartBtn.addEventListener("click", () => {
      cartDrawerOverlay.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  // Close AR Modal
  const closeArBtn = document.getElementById("close-ar-modal-btn");
  const arModal = document.getElementById("ar-modal");
  if (closeArBtn && arModal) {
    closeArBtn.addEventListener("click", () => {
      arModal.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  // Close Product Detail Modal
  const closePdpBtn = document.getElementById("close-product-modal-btn");
  const pdpModal = document.getElementById("product-detail-modal");
  if (closePdpBtn && pdpModal) {
    closePdpBtn.addEventListener("click", () => {
      pdpModal.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  // PDP Quantity Controls
  const qtyMinus = document.getElementById("pdp-qty-minus");
  const qtyPlus = document.getElementById("pdp-qty-plus");
  const qtyInput = document.getElementById("pdp-qty-input");

  if (qtyMinus && qtyInput) {
    qtyMinus.addEventListener("click", () => {
      let val = parseInt(qtyInput.value, 10) || 1;
      if (val > 1) {
        pdpQuantity = val - 1;
        qtyInput.value = pdpQuantity;
        recalculatePdpTotals();
      }
    });
  }
  if (qtyPlus && qtyInput) {
    qtyPlus.addEventListener("click", () => {
      let val = parseInt(qtyInput.value, 10) || 1;
      pdpQuantity = val + 1;
      qtyInput.value = pdpQuantity;
      recalculatePdpTotals();
    });
  }

  // PDP Add to Cart Button
  const pdpAddCartBtn = document.getElementById("pdp-add-cart-btn");
  if (pdpAddCartBtn) {
    pdpAddCartBtn.addEventListener("click", async () => {
      if (!currentModalProduct) return;
      const res = await addToCart(currentUser?.uid, currentModalProduct, pdpQuantity, {
        notes: document.getElementById("pv-custom-notes")?.value || "",
      });
      if (res.success) {
        showToast("Added to shopping bag!", "success");
        pdpModal.classList.remove("active");
        document.body.style.overflow = "";
        cartDrawerOverlay.classList.add("active");
      }
    });
  }

  // Auth Modal Controls
  const authModalBtn = document.getElementById("auth-modal-btn");
  const closeAuthModalBtn = document.getElementById("close-auth-modal-btn");
  const authModal = document.getElementById("auth-modal");

  if (authModalBtn && authModal) {
    authModalBtn.addEventListener("click", () => {
      authModal.classList.add("active");
      document.body.style.overflow = "hidden";
    });
  }
  if (closeAuthModalBtn && authModal) {
    closeAuthModalBtn.addEventListener("click", () => {
      authModal.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  // Auth Tabs
  const tabLoginBtn = document.getElementById("tab-login-btn");
  const tabRegisterBtn = document.getElementById("tab-register-btn");
  const loginForm = document.getElementById("auth-login-form");
  const registerForm = document.getElementById("auth-register-form");

  if (tabLoginBtn && tabRegisterBtn) {
    tabLoginBtn.addEventListener("click", () => {
      tabLoginBtn.classList.add("active");
      tabRegisterBtn.classList.remove("active");
      tabLoginBtn.style.borderBottom = "2px solid #111827";
      tabRegisterBtn.style.borderBottom = "2px solid transparent";
      loginForm.style.display = "block";
      registerForm.style.display = "none";
    });
    tabRegisterBtn.addEventListener("click", () => {
      tabRegisterBtn.classList.add("active");
      tabLoginBtn.classList.remove("active");
      tabRegisterBtn.style.borderBottom = "2px solid #111827";
      tabLoginBtn.style.borderBottom = "2px solid transparent";
      registerForm.style.display = "block";
      loginForm.style.display = "none";
    });
  }

  // Auth Login Form
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value;
      const pass = document.getElementById("login-password").value;
      try {
        await signInWithEmailAndPassword(auth, email, pass);
        showToast("Signed in successfully!", "success");
        authModal.classList.remove("active");
        document.body.style.overflow = "";
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // Auth Register Form
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("reg-email").value;
      const pass = document.getElementById("reg-password").value;
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
        showToast("Account created successfully!", "success");
        authModal.classList.remove("active");
        document.body.style.overflow = "";
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // Auth Sign Out Button
  const signoutBtn = document.getElementById("signout-btn");
  if (signoutBtn) {
    signoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      showToast("Signed out", "info");
      authModal.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  // Auth State Subscription
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const signedOutView = document.getElementById("auth-signed-out-view");
    const signedInView = document.getElementById("auth-signed-in-view");

    if (user) {
      if (signedOutView) signedOutView.style.display = "none";
      if (signedInView) signedInView.style.display = "block";
      const nameEl = document.getElementById("user-display-name");
      const emailEl = document.getElementById("user-display-email");
      const initialEl = document.getElementById("user-avatar-initial");

      if (nameEl) nameEl.textContent = user.displayName || user.email.split("@")[0];
      if (emailEl) emailEl.textContent = user.email;
      if (initialEl) initialEl.textContent = (user.displayName || user.email)[0].toUpperCase();

      fetchWishlist(user.uid).then((wl) => {
        updateWishlistBadges(wl);
        renderWishlistGrid();
      });
    } else {
      if (signedOutView) signedOutView.style.display = "block";
      if (signedInView) signedInView.style.display = "none";
      updateWishlistBadges();
      renderWishlistGrid();
    }

    subscribeToCart(user?.uid, (items) => {
      updateCartUI(items);
    });
  });

  // Load product catalog & wishlist items
  loadCatalogProducts();
});
