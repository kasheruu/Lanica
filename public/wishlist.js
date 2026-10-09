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
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  auth,
  db,
  signUpUser,
  signInUser,
  signInWithGoogle,
  sendPasswordReset,
  validatePasswordStrength,
} from "./authService.js";
import { initAuthModalController } from "./authModalController.js";

import {
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
  clearLocalWishlist,
  toggleWishlist,
  isItemInWishlist,
  getLocalWishlist,
  renderCartDrawerComponent,
} from "./cartService.js";

import { getCachedModelUrl, attachModelToViewer } from "./modelCacheService.js";

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

let savedAddresses = [];
let selectedAddressId = null;
let selectedPaymentMethod = "qr_code";
let selectedPaymentTerm = "downpayment";

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
  const list = (currentUser && wishlist) ? wishlist : (currentUser ? getLocalWishlist() : []);
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

  if (!currentUser) {
    clearLocalWishlist();
    updateWishlistBadges([]);
    container.innerHTML = `
      <div class="empty-state-container" style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 60px 20px; background: #ffffff; border-radius: 24px; border: 1px dashed #e5e7eb; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
        <div style="width: 80px; height: 80px; border-radius: 50%; background: #fef3c7; color: #d97706; display: inline-flex; align-items: center; justify-content: center; margin: 0 auto 20px; box-shadow: 0 4px 14px rgba(217, 119, 6, 0.15);">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 15v2m0 4h.01M5.07 19H18.93a2 2 0 001.78-2.89L13.78 4.11a2 2 0 00-3.56 0L3.29 16.11A2 2 0 005.07 19z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3 class="empty-state-title" style="font-size: 1.4rem; font-weight: 700; color: #111827; margin-bottom: 8px;">Sign In to View Your Wishlist</h3>
        <p class="empty-state-subtitle" style="color: #6b7280; font-size: 0.95rem; max-width: 440px; margin: 0 auto 24px; line-height: 1.5;">
          Your wishlist is saved to your account. Please log in or create an account to view and manage your saved furniture pieces.
        </p>
        <button id="wishlist-login-prompt-btn" type="button" class="btn-auth-primary" style="display: inline-flex; align-items: center; justify-content: center; padding: 12px 32px; border-radius: 9999px; font-weight: 700; font-size: 0.9rem; cursor: pointer; border: none;">
          LOG IN / REGISTER
        </button>
      </div>
    `;
    const promptBtn = document.getElementById("wishlist-login-prompt-btn");
    if (promptBtn) {
      promptBtn.addEventListener("click", () => {
        const modal = document.getElementById("auth-modal");
        if (modal) modal.classList.add("active");
      });
    }
    return;
  }

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
          <div class="wishlist-card-actions" style="margin-top: 10px;">
            <button type="button" class="btn-primary btn-move-cart" data-product-id="${product.id}" style="width: 100%; padding: 12px 14px; font-size: 0.85rem; border-radius: 10px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>Add to Bag</span>
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

      const res = await addToCart(currentUser?.uid, prod, "Fabric", 1);
      if (res && res.success) {
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

      if (!currentUser) {
        showToast("Please log in to manage your wishlist", "error");
        const modal = document.getElementById("auth-modal");
        if (modal) modal.classList.add("active");
        return;
      }

      const res = await toggleWishlist(productId, currentUser.uid);
      if (res.requireAuth) {
        showToast("Please log in to manage your wishlist", "error");
        const modal = document.getElementById("auth-modal");
        if (modal) modal.classList.add("active");
        return;
      }
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

  await attachModelToViewer(arViewer, glbUrl, { usdzUrl });

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
    let dimStr = "";
    if (typeof product.dimensions === "string" && product.dimensions.trim()) {
      dimStr = product.dimensions;
    } else if (typeof product.size === "string" && product.size.trim()) {
      dimStr = product.size;
    } else if (typeof product.dimensions === "object" && product.dimensions !== null) {
      if (product.dimensions.raw) {
        dimStr = product.dimensions.raw;
      } else {
        const parts = Object.entries(product.dimensions)
          .filter(([_, v]) => v != null && String(v).trim() !== "")
          .map(([k, v]) => `${k.toUpperCase()}: ${v}`);
        dimStr = parts.length > 0 ? parts.join(" × ") : "Standard Handcrafted Dimensions";
      }
    } else if (typeof product.size === "object" && product.size !== null) {
      const parts = Object.entries(product.size)
        .filter(([_, v]) => v != null && String(v).trim() !== "")
        .map(([k, v]) => `${k.toUpperCase()}: ${v}`);
      dimStr = parts.length > 0 ? parts.join(" × ") : "Standard Handcrafted Dimensions";
    }
    dimInfo.textContent = dimStr || "Standard Handcrafted Dimensions";
  }

  const mainImg = document.getElementById("pv-image");
  const thumbnails = getProductThumbnails(product);
  mainImg.src = thumbnails[0];

  recalculatePdpTotals();
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function recalculatePdpTotals() {
  if (!currentModalProduct) return;
  const basePrice = parseFloat(currentModalProduct.price || 0);
  let total = basePrice * pdpQuantity;

  const qtyValEl = document.getElementById("pv-qty-val") || document.getElementById("pdp-qty-val");
  if (qtyValEl) qtyValEl.textContent = pdpQuantity;

  const totalPriceEl = document.getElementById("pv-total-price-display") || document.getElementById("pdp-sticky-price");
  if (totalPriceEl) {
    totalPriceEl.textContent = `₱${total.toLocaleString()}`;
  }
}

// Cart Drawer Handling
function updateCartUI(cartItems) {
  currentCartItems = cartItems || [];

  renderCartDrawerComponent({
    items: currentCartItems,
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

function updateSubmitButtonText() {
  const grandTotal = currentCartItems.reduce(
    (sum, item) => sum + parsePrice(item.price) * Number(item.quantity),
    0
  );
  const downAmt = Math.round(grandTotal * 0.3);
  const dueToday = selectedPaymentTerm === "downpayment" ? downAmt : grandTotal;

  const submitBtn = document.getElementById("place-order-submit-btn");
  if (submitBtn) {
    submitBtn.textContent = `PLACE ORDER & PAY ₱${dueToday.toLocaleString()}`;
  }
}

function updateProofOfPaymentBox() {
  const proofBox = document.getElementById("proof-payment-box");
  if (!proofBox) return;
  if (selectedPaymentMethod === "COD" || selectedPaymentMethod === "Workshop") {
    proofBox.style.display = "none";
  } else {
    proofBox.style.display = "block";
  }
}

function updateCheckoutTotals() {
  const subtotal = currentCartItems.reduce(
    (sum, item) => sum + parsePrice(item.price) * Number(item.quantity),
    0
  );
  const shippingFee = 0;
  const grandTotal = subtotal + shippingFee;

  const subtotalEl = document.getElementById("checkout-subtotal");
  const shippingEl = document.getElementById("checkout-shipping");
  const totalEl = document.getElementById("checkout-total");
  const dueTodayEl = document.getElementById("checkout-due-today");
  const balanceDueEl = document.getElementById("checkout-balance-due");
  const termFullAmt = document.getElementById("term-full-amount");
  const termDownAmt = document.getElementById("term-down-amount");
  const summaryDueLabel = document.getElementById("term-summary-due-label");
  const chargeLabel = document.getElementById("checkout-charge-label");
  const chargeAmount = document.getElementById("checkout-charge-amount");
  const balanceDueSummary = document.getElementById("checkout-balance-due-summary");
  const itemCountEl = document.getElementById("checkout-item-count");
  const itemsListEl = document.getElementById("checkout-items-list");
  const downpaymentRow = document.getElementById("checkout-downpayment-row");
  const balanceRow = document.getElementById("checkout-balance-row");

  if (itemCountEl) {
    const count = currentCartItems.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    itemCountEl.textContent = count;
  }

  if (itemsListEl) {
    itemsListEl.innerHTML = currentCartItems
      .map(
        (item) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f9fafb; border-radius: 10px; border: 1px solid #f3f4f6;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${item.url || "assets/product_sofa.png"}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover;" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div>
            <div style="font-weight: 600; font-size: 0.88rem; color: #111827;">${escapeHtml(item.name)}</div>
            <div style="font-size: 0.78rem; color: #6b7280;">Qty: ${item.quantity} · ${escapeHtml(item.material || "Fabric")}</div>
          </div>
        </div>
        <div style="font-weight: 700; font-size: 0.92rem; color: #111827;">₱${(parsePrice(item.price) * Number(item.quantity)).toLocaleString()}</div>
      </div>
    `
      )
      .join("");
  }

  const downAmt = Math.round(grandTotal * 0.3);
  const balAmt = grandTotal - downAmt;

  if (termFullAmt) termFullAmt.textContent = `₱${grandTotal.toLocaleString()}`;
  if (termDownAmt) termDownAmt.textContent = `₱${downAmt.toLocaleString()}`;

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (shippingEl)
    shippingEl.textContent = shippingFee === 0 ? "FREE" : `₱${shippingFee.toLocaleString()}`;
  if (totalEl) totalEl.textContent = `₱${grandTotal.toLocaleString()}`;

  let dueToday = grandTotal;
  let remainingBal = 0;

  if (selectedPaymentTerm === "downpayment") {
    dueToday = downAmt;
    remainingBal = balAmt;
    if (summaryDueLabel) summaryDueLabel.textContent = "Due Today (30% Downpayment):";
    if (chargeLabel) chargeLabel.textContent = "Today's Charge (30% Downpayment)";
    if (downpaymentRow) {
      downpaymentRow.style.display = "flex";
      const lbl = downpaymentRow.querySelector("span:first-child");
      if (lbl) lbl.textContent = "Today's Charge (30% Downpayment)";
    }
    if (balanceRow) balanceRow.style.display = "flex";
  } else {
    dueToday = grandTotal;
    remainingBal = 0;
    if (summaryDueLabel) summaryDueLabel.textContent = "Due Today (Full 100%):";
    if (chargeLabel) chargeLabel.textContent = "Today's Charge (Full 100%)";
    if (downpaymentRow) {
      downpaymentRow.style.display = "flex";
      const lbl = downpaymentRow.querySelector("span:first-child");
      if (lbl) lbl.textContent = "Today's Charge (Full 100%)";
    }
    if (balanceRow) balanceRow.style.display = "none";
  }

  if (dueTodayEl) dueTodayEl.textContent = `₱${dueToday.toLocaleString()}`;
  if (balanceDueEl) balanceDueEl.textContent = `₱${remainingBal.toLocaleString()}`;
  if (chargeAmount) chargeAmount.textContent = `₱${dueToday.toLocaleString()}`;
  if (balanceDueSummary) balanceDueSummary.textContent = `₱${remainingBal.toLocaleString()}`;

  updateSubmitButtonText();
}

async function openCheckoutModal() {
  if (!currentUser || currentUser.isAnonymous) {
    const authPromptModal = document.getElementById("auth-prompt-modal");
    if (authPromptModal) authPromptModal.classList.add("active");
    else document.getElementById("auth-modal")?.classList.add("active");
    return;
  }
  if (currentCartItems.length === 0) {
    showToast("Your shopping bag is empty.", "info");
    return;
  }

  const checkoutModal = document.getElementById("checkout-modal");
  updateCheckoutTotals();
  updateSubmitButtonText();
  updateProofOfPaymentBox();

  await loadUserAddresses();

  document.getElementById("cart-drawer-overlay")?.classList.remove("active");
  checkoutModal?.classList.add("active");
}

async function loadUserAddresses() {
  const container = document.getElementById("saved-addresses-list");
  if (!container || !currentUser) return;

  try {
    savedAddresses = await getUserAddresses(currentUser.uid);
    container.innerHTML = "";

    if (savedAddresses.length === 0) {
      container.innerHTML = `<p style="font-size: 0.85rem; color: #6b7280;">No saved addresses yet. Please add one below.</p>`;
      const addrForm = document.getElementById("address-form");
      if (addrForm) addrForm.style.display = "block";
      selectedAddressId = null;
      return;
    }

    if (!selectedAddressId && savedAddresses.length > 0) {
      selectedAddressId = savedAddresses[0].id;
    }

    savedAddresses.forEach((addr) => {
      const card = document.createElement("div");
      card.className = `address-card ${addr.id === selectedAddressId ? "selected" : ""}`;
      card.innerHTML = `
        <div class="address-card-info">
          <h5>${escapeHtml(addr.recipientName)} (${escapeHtml(addr.phoneNumber)})</h5>
          <p>${escapeHtml(addr.fullAddress)}</p>
        </div>
      `;
      card.addEventListener("click", () => {
        selectedAddressId = addr.id;
        document.querySelectorAll(".address-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Error loading addresses:", err);
  }
}

async function handlePlaceOrderSubmit() {
  const submitBtn = document.getElementById("place-order-submit-btn");
  if (!submitBtn) return;

  if (currentCartItems.length === 0) {
    showToast("Your shopping bag is empty.", "error");
    return;
  }

  const targetAddress = savedAddresses.find((a) => a.id === selectedAddressId);
  if (!targetAddress) {
    showToast("Please select or add a shipping address.", "error");
    return;
  }

  const subtotal = currentCartItems.reduce(
    (sum, item) => sum + parsePrice(item.price) * Number(item.quantity),
    0
  );
  const shippingFee = 0;
  const totalAmount = subtotal + shippingFee;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing Order...";

    let paymentSlipUrl = "";
    const slipInput = document.getElementById("checkout-payment-slip");
    if (slipInput && slipInput.files && slipInput.files[0]) {
      submitBtn.textContent = "Uploading Payment Slip...";
      paymentSlipUrl = await uploadChatAttachment(slipInput.files[0], currentUser.uid);
    }

    let customSketchUrl = "";
    const sketchInput = document.getElementById("checkout-custom-sketch");
    if (sketchInput && sketchInput.files && sketchInput.files[0]) {
      submitBtn.textContent = "Uploading AR Sketch / Screenshot...";
      customSketchUrl = await uploadChatAttachment(sketchInput.files[0], currentUser.uid);
    }

    const customComments = document.getElementById("checkout-custom-comments")?.value?.trim() || "";

    submitBtn.textContent = "Finalizing Order...";
    const nearestLandmarkVal =
      document.getElementById("checkout-nearest-landmark")?.value?.trim() || "";
    const addressWithLandmark = {
      ...targetAddress,
      nearestLandmark: nearestLandmarkVal,
    };

    const result = await placeOrderAtomic({
      userId: currentUser.uid,
      cartItems: currentCartItems,
      totalAmount: totalAmount,
      paymentMethod: selectedPaymentMethod,
      paymentOption: selectedPaymentTerm,
      address: addressWithLandmark,
      customNotes: customComments,
      paymentDetails: {
        paymentSlipUrl: paymentSlipUrl || null,
        customSketchUrl: customSketchUrl || null,
        customComments: customComments,
        selectedTerm: selectedPaymentTerm,
        accountName: targetAddress.recipientName,
        submittedAt: new Date().toISOString(),
      },
    });

    try {
      const termLabel = selectedPaymentTerm === "downpayment" ? "30% Downpayment" : "Full Payment";
      await sendChatMessage({
        orderId: result.orderId,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || targetAddress.recipientName || "Customer",
        senderRole: "customer",
        text: `Hello! I have placed Order #${result.orderId} (${termLabel} via ${selectedPaymentMethod}). Total: ₱${totalAmount.toLocaleString()}.${customComments ? ` Custom Notes: "${customComments}"` : ""}`,
        attachmentUrl: paymentSlipUrl || customSketchUrl || null,
      });
    } catch (chatErr) {
      console.warn("Could not post auto chat confirmation:", chatErr);
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order Now";
    document.getElementById("checkout-modal")?.classList.remove("active");

    showToast(
      `Order Placed Successfully! (ID: ${result.orderId}). Redirecting to order tracking...`,
      "success"
    );
    setTimeout(() => {
      window.location.href = "orders.html";
    }, 1500);
  } catch (err) {
    console.error("Place Order Error:", err);
    showToast(err.message || "Failed to place order.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order Now";
  }
}

// Global Event Listeners & Setup
document.addEventListener("DOMContentLoaded", () => {
  initAuthModalController();
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

  // Cart Overlay Toggle & Proceed to Checkout Button
  const cartToggleBtn = document.getElementById("cart-toggle-btn");
  const closeCartBtn = document.getElementById("close-cart-btn");
  const cartDrawerOverlay = document.getElementById("cart-drawer-overlay");
  const proceedCheckoutBtn = document.getElementById("proceed-checkout-btn");

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
  if (proceedCheckoutBtn) {
    proceedCheckoutBtn.addEventListener("click", openCheckoutModal);
  }

  // Checkout Modal Toggles & Payment Listeners
  const checkoutModal = document.getElementById("checkout-modal");
  const closeCheckoutBtn = document.getElementById("close-checkout-modal-btn");
  const cancelCheckoutBtn = document.getElementById("cancel-checkout-modal-btn");
  const toggleAddressBtn = document.getElementById("toggle-new-address-btn");
  const addressForm = document.getElementById("address-form");

  const closeCheckoutModal = () => {
    if (checkoutModal) checkoutModal.classList.remove("active");
  };

  if (closeCheckoutBtn) {
    closeCheckoutBtn.addEventListener("click", closeCheckoutModal);
  }
  if (cancelCheckoutBtn) {
    cancelCheckoutBtn.addEventListener("click", closeCheckoutModal);
  }

  if (toggleAddressBtn && addressForm) {
    toggleAddressBtn.addEventListener("click", () => {
      const isHidden = addressForm.style.display === "none";
      addressForm.style.display = isHidden ? "block" : "none";
    });
  }

  if (addressForm) {
    addressForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const addressData = {
          recipientName: document.getElementById("addr-name").value,
          phoneNumber: document.getElementById("addr-phone").value,
          fullAddress: document.getElementById("addr-full").value,
          latitude: document.getElementById("addr-lat").value || null,
          longitude: document.getElementById("addr-lng").value || null,
        };

        const newAddr = await saveUserAddress(currentUser.uid, addressData);
        showToast("Address saved successfully!");
        addressForm.reset();
        addressForm.style.display = "none";
        selectedAddressId = newAddr.id;
        await loadUserAddresses();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  document.querySelectorAll(".payment-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".payment-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedPaymentMethod = card.getAttribute("data-method") || "COD";
      updateSubmitButtonText();
      updateProofOfPaymentBox();
    });
  });

  document.querySelectorAll('input[name="checkoutPaymentTerm"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedPaymentTerm = e.target.value;
      document
        .querySelectorAll(".payment-term-card")
        .forEach((c) => c.classList.remove("selected"));
      e.target.closest(".payment-term-card")?.classList.add("selected");
      updateCheckoutTotals();
    });
  });

  const placeOrderBtn = document.getElementById("place-order-submit-btn");
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener("click", handlePlaceOrderSubmit);
  }

  const authPromptModal = document.getElementById("auth-prompt-modal");
  const closeAuthPromptBtn = document.getElementById("close-auth-prompt-btn");
  const promptSigninBtn = document.getElementById("prompt-signin-btn");
  const promptContinueBtn = document.getElementById("prompt-continue-btn");

  if (closeAuthPromptBtn && authPromptModal) {
    closeAuthPromptBtn.addEventListener("click", () => authPromptModal.classList.remove("active"));
  }
  if (promptContinueBtn && authPromptModal) {
    promptContinueBtn.addEventListener("click", () => authPromptModal.classList.remove("active"));
  }
  if (promptSigninBtn && authPromptModal) {
    promptSigninBtn.addEventListener("click", () => {
      authPromptModal.classList.remove("active");
      document.getElementById("auth-modal")?.classList.add("active");
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
  const qtyMinus = document.getElementById("pv-qty-minus") || document.getElementById("pdp-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus") || document.getElementById("pdp-qty-plus");

  if (qtyMinus) {
    qtyMinus.addEventListener("click", () => {
      if (pdpQuantity > 1) {
        pdpQuantity--;
        recalculatePdpTotals();
      }
    });
  }
  if (qtyPlus) {
    qtyPlus.addEventListener("click", () => {
      if (pdpQuantity < 20) {
        pdpQuantity++;
        recalculatePdpTotals();
      }
    });
  }

  // PDP Add to Cart Button
  const pdpAddCartBtn = document.getElementById("pv-add-to-cart-btn") || document.getElementById("pdp-add-cart-btn");
  if (pdpAddCartBtn) {
    pdpAddCartBtn.addEventListener("click", async () => {
      if (!currentModalProduct) return;
      const customNotesVal = document.getElementById("pv-custom-notes")?.value || "";
      const res = await addToCart(currentUser?.uid, currentModalProduct, "Fabric", pdpQuantity, customNotesVal);
      if (res && res.success) {
        showToast("Added to shopping bag!", "success");
        if (pdpModal) pdpModal.classList.remove("active");
        document.body.style.overflow = "";
        const cartDrawerOverlay = document.getElementById("cart-drawer-overlay");
        if (cartDrawerOverlay) cartDrawerOverlay.classList.add("active");
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
      const email = document.getElementById("login-email")?.value;
      const pass = document.getElementById("login-password")?.value;
      try {
        const res = await signInUser({ email, password: pass });
        showToast(res.message, "success");
        authModal?.classList.remove("active");
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
      const email = document.getElementById("reg-email")?.value;
      const pass = document.getElementById("reg-password")?.value;
      const nameEl = document.getElementById("reg-name");
      const displayName = nameEl ? nameEl.value : "";
      try {
        const res = await signUpUser({ email, password: pass, displayName });
        showToast(res.message, "info");
        authModal?.classList.remove("active");
        document.body.style.overflow = "";
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  // Google Sign-In
  const googleBtn = document.getElementById("google-signin-btn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      try {
        const res = await signInWithGoogle();
        showToast(res.message, "success");
        authModal?.classList.remove("active");
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
      currentUser = null;
      if (signedOutView) signedOutView.style.display = "block";
      if (signedInView) signedInView.style.display = "none";
      clearLocalWishlist();
      updateWishlistBadges([]);
      renderWishlistGrid();
    }

    subscribeToCart(user?.uid, (items) => {
      updateCartUI(items);
    });
  });

  // Load product catalog & wishlist items
  loadCatalogProducts();
});
