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
  getLocalWishlist,
  renderCartDrawerComponent,
} from "./cartService.js";

import { getCachedModelUrl, attachModelToViewer, loadCachedModel } from "./modelCacheService.js";

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
let selectedAddressId = null;
let savedAddresses = [];
let selectedPaymentMethod = "COD";
let selectedPaymentTerm = "downpayment"; // "downpayment" (30%) or "full" (100%)
let currentModalProduct = null;
let currentSelectedMaterial = "Fabric";
let currentSelectedQty = 1;
let cartUnsubscribe = null;
let chatUnsubscribe = null;
let liveChatController = null;

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
}

function updateWishlistBadges(wishlist) {
  const list = (auth?.currentUser && wishlist) ? wishlist : (auth?.currentUser ? getLocalWishlist() : []);
  const count = list.length;
  const badge = document.getElementById("wishlist-badge");
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
  }
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

// Helper: Toast Notifications
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === "success" ? "✓" : "⚠️"}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastIn 0.3s reverse forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

document.addEventListener("DOMContentLoaded", async () => {
  initAuthModalController();
  // 1. Navbar Scroll Effect & Mobile Drawer Menu
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

  // 2. Initialize Authentication & Real-time Cart
  liveChatController = setupLiveChatWidget();

  try {
    currentUser = await ensureAuth();
    setupCartSubscription(currentUser.uid);
    updateAuthUi(currentUser);
    liveChatController?.initUserChat(currentUser);
    fetchWishlist(currentUser.uid).then((wl) => updateWishlistBadges(wl));
  } catch (err) {
    console.error("Failed to initialize auth:", err);
  }

  onAuthStateChanged(auth, (user) => {
    updateAuthNavVisibility(user);
    if (user) {
      currentUser = user;
      setupCartSubscription(user.uid);
      updateAuthUi(user);
      liveChatController?.initUserChat(user);
      fetchWishlist(user.uid).then((wl) => updateWishlistBadges(wl));
    } else {
      currentUser = null;
      clearLocalWishlist();
      updateWishlistBadges([]);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("auth") === "required") {
    const authModal = document.getElementById("auth-modal");
    if (authModal) {
      authModal.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  // 3. Load Products from Firebase
  await loadProductsCatalog();

  // 4. Initialize Regular Animations & AR View Buttons
  initAnimations();

  // 5. Setup Storefront Event Listeners & Modals
  setupStorefrontUI();

  // 6. Handle PayMongo Return Payment Redirect if applicable
  await handlePaymentRedirect();

  // 7. Hidden Admin Trigger (Triple click Logo)
  setupAdminLogoTrigger();
});

// Auth Guard Interceptor
function isRealUserLoggedIn() {
  return currentUser && !currentUser.isAnonymous;
}

function requireAuth(actionCallback) {
  if (isRealUserLoggedIn()) {
    actionCallback();
  } else {
    // Intercept unauthenticated guest action and open Sign-In Prompt Modal
    const promptModal = document.getElementById("auth-prompt-modal");
    if (promptModal) {
      promptModal.classList.add("active");
    } else {
      document.getElementById("auth-modal")?.classList.add("active");
    }
  }
}

// Setup Real-time Cart Listener
function setupCartSubscription(userId) {
  if (cartUnsubscribe) cartUnsubscribe();

  // ONLY subscribe to Firestore cart subcollection if user is properly authenticated
  if (isRealUserLoggedIn()) {
    cartUnsubscribe = subscribeToCart(userId, (items) => {
      currentCartItems = items;
      renderCartDrawer(items);
    });
  } else {
    currentCartItems = [];
    renderCartDrawer([]);
  }
}

// Helper to get all thumbnails for a product with fallback
function getProductThumbnails(product) {
  if (Array.isArray(product.thumbnails) && product.thumbnails.length > 0) {
    return product.thumbnails;
  }
  if (Array.isArray(product.images?.thumbnails) && product.images.thumbnails.length > 0) {
    return product.images.thumbnails;
  }
  const fallback =
    product.thumbnail ||
    (product.images && (product.images.isoImage || product.images.frontBg)) ||
    product.image ||
    "assets/product_sofa.png";
  return [fallback];
}

// Interactive multi-thumbnail slideshow for product cards
function initCardSlideshows(root = document) {
  const slideshows = root.querySelectorAll(".card-slideshow");
  slideshows.forEach((container) => {
    if (container.dataset.slideshowInitialized === "true") return;
    container.dataset.slideshowInitialized = "true";

    const slides = container.querySelectorAll(".card-slideshow-slide");
    const dots = container.querySelectorAll(".card-slideshow-dot");
    const prevBtn = container.querySelector(".card-slideshow-btn.prev");
    const nextBtn = container.querySelector(".card-slideshow-btn.next");

    if (slides.length <= 1) return;

    let currentIndex = 0;
    let autoSlideInterval = null;

    function goToSlide(index) {
      slides[currentIndex]?.classList.remove("active");
      dots[currentIndex]?.classList.remove("active");

      currentIndex = (index + slides.length) % slides.length;

      slides[currentIndex]?.classList.add("active");
      dots[currentIndex]?.classList.add("active");
    }

    function startAutoSlide() {
      stopAutoSlide();
      autoSlideInterval = setInterval(() => {
        goToSlide(currentIndex + 1);
      }, 3500);
    }

    function stopAutoSlide() {
      if (autoSlideInterval) {
        clearInterval(autoSlideInterval);
        autoSlideInterval = null;
      }
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(currentIndex - 1);
        startAutoSlide();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(currentIndex + 1);
        startAutoSlide();
      });
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(idx);
        startAutoSlide();
      });
    });

    // Touch swipe support
    let touchStartX = 0;
    container.addEventListener(
      "touchstart",
      (e) => {
        stopAutoSlide();
        touchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );

    container.addEventListener(
      "touchend",
      (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 30) {
          if (diff < 0) {
            goToSlide(currentIndex + 1);
          } else {
            goToSlide(currentIndex - 1);
          }
        }
        startAutoSlide();
      },
      { passive: true }
    );

    container.addEventListener("mouseenter", stopAutoSlide);
    container.addEventListener("mouseleave", startAutoSlide);

    startAutoSlide();
  });
}

// Load Products Catalog & Render Cards in Interactive Carousel
async function loadProductsCatalog() {
  const carouselTrack =
    document.getElementById("carousel-track") || document.querySelector(".products-grid");
  if (!carouselTrack) return;

  try {
    const querySnapshot = await getDocs(collection(db, "products"));

    if (!querySnapshot.empty) {
      carouselTrack.innerHTML = ""; // Clear static placeholders

      let delay = 0.1;
      querySnapshot.forEach((docSnap) => {
        const product = docSnap.data();
        const thumbnails = getProductThumbnails(product);
        const hasMultipleThumbs = thumbnails.length >= 2;
        const priceFormatted = parseFloat(product.price || 0).toLocaleString();

        const imageSectionHTML = hasMultipleThumbs
          ? `
            <div class="product-image-container card-slideshow" data-product-id="${docSnap.id}">
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
              <button class="btn-ar-view" data-product-id="${docSnap.id}" title="View in 3D / AR">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                <span>3D</span>
              </button>
              <button type="button" class="btn-wishlist-heart" data-product-id="${docSnap.id}" title="Wishlist">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              </button>
            </div>
          `
          : `
            <div class="product-image-container">
              <img src="${thumbnails[0]}" alt="${escapeHtml(product.name)}" class="product-img" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
              <button class="btn-ar-view" data-product-id="${docSnap.id}" title="View in 3D / AR">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                <span>3D</span>
              </button>
              <button type="button" class="btn-wishlist-heart" data-product-id="${docSnap.id}" title="Wishlist">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              </button>
            </div>
          `;

        const productHTML = `
          <div class="product-card-slide">
            <div class="product-card reveal" data-product-id="${docSnap.id}" style="--delay: ${delay}s">
              ${imageSectionHTML}
              <div class="product-info">
                <h3>${escapeHtml(product.name)}</h3>
                <div class="price-row">
                  <span class="price">₱${priceFormatted}</span>
                  <span class="price-badge-tag">${escapeHtml((product.category || 'SOFA').toUpperCase())}</span>
                </div>
              </div>
            </div>
          </div>
        `;
        carouselTrack.insertAdjacentHTML("beforeend", productHTML);
        delay += 0.1;
      });

      // Bind AR & Quick Order buttons
      bindProductCardButtons();
      initCardSlideshows(carouselTrack);
      setupCarouselControls();
    } else {
      carouselTrack.innerHTML = `
        <div class="empty-state-container" style="width: 100%; grid-column: 1 / -1;">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h3 class="empty-state-title">No Products Available</h3>
          <p class="empty-state-subtitle">We couldn't find any products matching your selection. Please check back later or refresh.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error loading catalog products:", error);
    if (carouselTrack) {
      carouselTrack.innerHTML = `
        <div class="empty-state-container" style="width: 100%; grid-column: 1 / -1;">
          <h3 class="empty-state-title">Unable to Load Catalog</h3>
          <p class="empty-state-subtitle">There was an issue fetching products. Please check your connection and try again.</p>
        </div>
      `;
    }
  }
}

// Carousel Controls (Touch Swipe, Drag & Navigation Arrows)
function setupCarouselControls() {
  const container = document.getElementById("carousel-track-container");
  const track = document.getElementById("carousel-track");
  const prevBtn = document.getElementById("carousel-prev-btn");
  const nextBtn = document.getElementById("carousel-next-btn");
  const pagination = document.getElementById("carousel-pagination");

  if (!container || !track) return;

  const slides = track.querySelectorAll(".product-card-slide");
  if (slides.length === 0) return;

  // Build pagination dots
  if (pagination) {
    pagination.innerHTML = "";
    slides.forEach((_, idx) => {
      const dot = document.createElement("div");
      dot.className = `carousel-dot ${idx === 0 ? "active" : ""}`;
      dot.addEventListener("click", () => {
        const slideWidth = slides[0].offsetWidth + 20;
        container.scrollTo({ left: slideWidth * idx, behavior: "smooth" });
      });
      pagination.appendChild(dot);
    });
  }

  // Update dots on scroll
  const updatePagination = () => {
    const slideWidth = slides[0].offsetWidth + 20;
    const scrollPos = container.scrollLeft;
    const activeIndex = Math.round(scrollPos / slideWidth);

    if (pagination) {
      const dots = pagination.querySelectorAll(".carousel-dot");
      dots.forEach((dot, idx) => {
        dot.classList.toggle("active", idx === activeIndex);
      });
    }
  };

  container.addEventListener("scroll", updatePagination, { passive: true });

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      const slideWidth = slides[0].offsetWidth + 20;
      container.scrollBy({ left: -slideWidth, behavior: "smooth" });
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      const slideWidth = slides[0].offsetWidth + 20;
      container.scrollBy({ left: slideWidth, behavior: "smooth" });
    });
  }

  // Mouse drag support for desktop
  let isDragging = false;
  let startX = 0;
  let scrollLeft = 0;

  container.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  container.addEventListener("mouseleave", () => {
    isDragging = false;
  });

  container.addEventListener("mouseup", () => {
    isDragging = false;
  });

  container.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1.5;
    container.scrollLeft = scrollLeft - walk;
  });
}

// Bind buttons on product cards
function bindProductCardButtons() {
  bindARButtons();

  document.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (
        e.target.closest(".btn-ar-view") ||
        e.target.closest(".card-slideshow-btn") ||
        e.target.closest(".btn-wishlist-heart")
      ) {
        return;
      }
      const productId = card.getAttribute("data-product-id");
      if (productId) {
        openProductQuickViewModal(productId);
      }
    });
  });

  document.querySelectorAll(".btn-wishlist-heart").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.classList.toggle("active");
      const isFav = btn.classList.contains("active");
      showToast(isFav ? "Saved to wishlist!" : "Removed from wishlist", "success");
    });
  });
}

// Phase 1: Open Product Quick View Modal with Variant Selection & Stock Validation
let selectedModalAddons = [];

function recalculatePdpTotals() {
  if (!currentModalProduct) return;
  const basePrice = parseFloat(currentModalProduct.price || 0);
  let addonsTotal = 0;
  selectedModalAddons = [];

  document.querySelectorAll(".pdp-addon-checkbox:checked").forEach((cb) => {
    const name = cb.getAttribute("data-addon-name");
    const price = parseFloat(cb.getAttribute("data-addon-price") || 0);
    selectedModalAddons.push({ name, price });
    addonsTotal += price;
  });

  const unitPrice = basePrice + addonsTotal;
  const totalPrice = unitPrice * currentSelectedQty;

  const priceEl = document.getElementById("pv-price");
  if (priceEl) priceEl.textContent = `₱${basePrice.toLocaleString()}`;

  const totalDisplay = document.getElementById("pv-total-price-display");
  if (totalDisplay) totalDisplay.textContent = `₱${totalPrice.toLocaleString()}`;
}

async function openProductQuickViewModal(productId) {
  const modal = document.getElementById("product-detail-modal");
  if (!modal) return;

  try {
    let productData = null;
    try {
      const productDoc = await getDoc(doc(db, "products", productId));
      if (productDoc.exists()) {
        productData = { id: productDoc.id, ...productDoc.data() };
      }
    } catch (e) {
      console.warn("Could not fetch product from Firestore, checking catalog list:", e);
    }

    if (!productData && Array.isArray(featuredProducts)) {
      productData = featuredProducts.find((p) => String(p.id) === String(productId));
    }

    if (!productData) {
      showToast("Product not found.", "error");
      return;
    }

    currentModalProduct = productData;
    currentSelectedQty = 1;
    selectedModalAddons = [];

    // Header Badges
    const catBadge = document.getElementById("pv-category-badge");
    if (catBadge) catBadge.textContent = (currentModalProduct.category || "SOFA").toUpperCase();

    const modalThumbs = getProductThumbnails(currentModalProduct);
    document.getElementById("pv-name").textContent = currentModalProduct.name || "Product";
    document.getElementById("pv-image").src = modalThumbs[0] || "assets/product_sofa.png";

    const paginationEl = document.getElementById("pv-pagination-indicator");
    if (paginationEl) {
      paginationEl.textContent = `1/${modalThumbs.length}`;
    }

    // Dimensions display card
    const dimsEl = document.getElementById("pv-dimensions-info");
    const dimsCard = document.getElementById("pv-dimensions-card");
    if (dimsEl) {
      let htmlContent = "";
      if (
        currentModalProduct.dimensions &&
        typeof currentModalProduct.dimensions.height === "number"
      ) {
        const d = currentModalProduct.dimensions;
        const u = d.unit || "in";
        if (d.isLType && d.length2) {
          htmlContent = `L: <strong>${d.length} × ${d.length2} ${u}</strong> <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin: 0 4px; vertical-align: 1px; display: inline-block;">L-SHAPE</span> · W: <strong>${d.width} ${u}</strong> · H: <strong>${d.height} ${u}</strong>`;
        } else if (d.length) {
          htmlContent = `${d.length} × ${d.width} × ${d.height} ${u}`;
        } else {
          htmlContent = `${d.width} × ${d.height} ${u}`;
        }
      } else if (currentModalProduct.size) {
        const s = currentModalProduct.size;
        if (s.includes("L-Type")) {
          const cleaned = s.replace("(L-Type)", "").replace(/\s+/g, " ").trim();
          htmlContent = `${escapeHtml(cleaned)} <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-left: 4px; vertical-align: 1px; display: inline-block;">L-SHAPE</span>`;
        } else {
          htmlContent = escapeHtml(s);
        }
      }
      if (htmlContent) {
        dimsEl.innerHTML = htmlContent;
        if (dimsCard) dimsCard.style.display = "block";
      } else {
        if (dimsCard) dimsCard.style.display = "none";
      }
    }

    // Modal multi-thumbnail selector strip
    const thumbStrip = document.getElementById("pv-thumbnails");
    if (thumbStrip) {
      if (modalThumbs.length >= 2) {
        thumbStrip.innerHTML = modalThumbs
          .map(
            (url, i) => `
          <button type="button" class="modal-thumb-btn ${i === 0 ? "active" : ""}" data-index="${i}" title="View image ${i + 1}">
            <img src="${url}" alt="Thumbnail ${i + 1}" onerror="this.src='assets/product_sofa.png'" />
          </button>
        `
          )
          .join("");
        thumbStrip.style.display = "flex";
        thumbStrip.querySelectorAll(".modal-thumb-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            thumbStrip
              .querySelectorAll(".modal-thumb-btn")
              .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const idx = parseInt(btn.dataset.index, 10);
            document.getElementById("pv-image").src = modalThumbs[idx];
            if (paginationEl) paginationEl.textContent = `${idx + 1}/${modalThumbs.length}`;
          });
        });
      } else {
        thumbStrip.style.display = "none";
        thumbStrip.innerHTML = "";
      }
    }

    // Dynamic materials input / options
    const prodMaterials =
      Array.isArray(currentModalProduct.materials) && currentModalProduct.materials.length > 0
        ? currentModalProduct.materials
        : currentModalProduct.material
          ? currentModalProduct.material
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : ["Standard"];

    currentSelectedMaterial = "Standard";

    const matOptionsContainer =
      document.getElementById("pv-material-options") || modal.querySelector(".material-options");
    if (matOptionsContainer) {
      matOptionsContainer.style.display = "none";
      const parentVarSection = matOptionsContainer.closest(".variant-section");
      if (parentVarSection) parentVarSection.style.display = "none";
    }

    // Populate Add-ons Section
    const addonsListContainer = document.getElementById("pv-addons-list");
    const addonsSec = document.getElementById("pv-addons-section");
    const availableAddons =
      Array.isArray(currentModalProduct.addons)
        ? currentModalProduct.addons.filter(
            (a) => a && a.active !== false && (a.name || "").trim() !== ""
          )
        : [];

    if (addonsListContainer) {
      if (availableAddons.length > 0) {
        if (addonsSec) addonsSec.style.display = "block";
        addonsListContainer.innerHTML = availableAddons
          .map(
            (addon) => `
          <label class="pdp-addon-item">
            <div class="pdp-addon-left">
              <input type="checkbox" class="pdp-addon-checkbox" data-addon-name="${escapeHtml(addon.name)}" data-addon-price="${addon.price || 0}" />
              <span class="pdp-addon-name">${escapeHtml(addon.name)}</span>
            </div>
            <span class="pdp-addon-price">+₱${parseFloat(addon.price || 0).toLocaleString()}</span>
          </label>
        `
          )
          .join("");

        addonsListContainer.querySelectorAll(".pdp-addon-item").forEach((item) => {
          const cb = item.querySelector(".pdp-addon-checkbox");
          cb.addEventListener("change", () => {
            item.classList.toggle("selected", cb.checked);
            recalculatePdpTotals();
          });
        });
      } else {
        if (addonsSec) addonsSec.style.display = "none";
        addonsListContainer.innerHTML = "";
      }
    }

    updateVariantStockUI();
    recalculatePdpTotals();

    // Show modal
    modal.classList.add("active");
  } catch (err) {
    console.error("Error opening product modal:", err);
    showToast("Failed to load product details.", "error");
  }
}

function updateVariantStockUI() {
  if (!currentModalProduct) return;

  const matButtons = document.querySelectorAll(".material-btn");
  matButtons.forEach((btn) => {
    const mat = btn.getAttribute("data-material");
    btn.classList.toggle("selected", mat === currentSelectedMaterial);
  });

  const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
  const statusEl = document.getElementById("pv-stock-status");
  const leadBadge = document.getElementById("pv-leadtime-badge");
  const addBtn = document.getElementById("pv-add-to-cart-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");

  if (available > 0) {
    if (statusEl) {
      statusEl.innerHTML = `Ready to Ship (${available} left in showroom)`;
      statusEl.className = "pdp-stock-chip ready";
    }
    if (leadBadge) {
      leadBadge.textContent = "Ready to Ship";
      leadBadge.style.background = "#ecfdf5";
      leadBadge.style.color = "#059669";
    }
    if (addBtn) {
      addBtn.disabled = false;
      const ctaSpan = addBtn.querySelector("span:first-child");
      if (ctaSpan) ctaSpan.textContent = "ADD READY STOCK TO BAG";
    }

    if (currentSelectedQty < 1) currentSelectedQty = 1;
    if (currentSelectedQty > available) currentSelectedQty = available;
  } else {
    if (statusEl) {
      statusEl.innerHTML = `Made to Order (Lead Time: 14–21 Days)`;
      statusEl.className = "pdp-stock-chip mto";
    }
    if (leadBadge) {
      leadBadge.textContent = "MTO (~21-28 days)";
      leadBadge.style.background = "#e0f2fe";
      leadBadge.style.color = "#0369a1";
    }
    if (addBtn) {
      addBtn.disabled = false;
      const ctaSpan = addBtn.querySelector("span:first-child");
      if (ctaSpan) ctaSpan.textContent = "PLACE MADE-TO-ORDER";
    }

    if (currentSelectedQty < 1) currentSelectedQty = 1;
  }

  const qtyValEl = document.getElementById("pv-qty-val");
  if (qtyValEl) qtyValEl.textContent = currentSelectedQty;

  if (qtyMinus) qtyMinus.disabled = currentSelectedQty <= 1;
  if (qtyPlus)
    qtyPlus.disabled = available > 0 ? currentSelectedQty >= available : currentSelectedQty >= 20;

  recalculatePdpTotals();
}

// Phase 2: Render Cart Drawer
function renderCartDrawer(items) {
  renderCartDrawerComponent({
    items: items,
    onUpdateQty: async (id, newQty) => {
      if (newQty > 0) {
        try {
          await updateCartItemQuantity(currentUser?.uid, id, newQty);
        } catch (err) {
          showToast(err.message, "error");
        }
      } else {
        await removeCartItem(currentUser?.uid, id);
        showToast("Item removed from bag.");
      }
    },
    onRemoveItem: async (id) => {
      await removeCartItem(currentUser?.uid, id);
      showToast("Item removed from bag.");
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
            <div style="font-weight: 600; font-size: 0.88rem; color: #111827;">${escapeHtml(item.name || "")}</div>
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

// Phase 3 & 4: Setup Checkout Modal & Addresses
async function openCheckoutModal() {
  if (!currentUser || currentCartItems.length === 0) return;

  const checkoutModal = document.getElementById("checkout-modal");
  updateCheckoutTotals();
  updateSubmitButtonText();
  updateProofOfPaymentBox();

  // Load saved addresses
  await loadUserAddresses();

  // Close cart drawer & open checkout modal
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
      container.innerHTML = `<p style="font-size: 0.85rem; color: var(--clr-text-muted);">No saved addresses yet. Please add one below.</p>`;
      document.getElementById("address-form").style.display = "block";
      selectedAddressId = null;
      return;
    }

    // Default select first address
    if (!selectedAddressId && savedAddresses.length > 0) {
      selectedAddressId = savedAddresses[0].id;
    }

    savedAddresses.forEach((addr) => {
      const card = document.createElement("div");
      card.className = `address-card ${addr.id === selectedAddressId ? "selected" : ""}`;
      card.innerHTML = `
        <div class="address-card-info">
          <h5>${addr.recipientName} (${addr.phoneNumber})</h5>
          <p>${addr.fullAddress}</p>
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

// Storefront UI Wireup
function setupStorefrontUI() {
  // Cart Drawer toggles
  const cartBtn = document.getElementById("cart-toggle-btn");
  const cartOverlay = document.getElementById("cart-drawer-overlay");
  const closeCartBtn = document.getElementById("close-cart-btn");
  const proceedCheckoutBtn = document.getElementById("proceed-checkout-btn");

  if (cartBtn && cartOverlay) {
    cartBtn.addEventListener("click", () => cartOverlay.classList.add("active"));
  }
  if (closeCartBtn && cartOverlay) {
    closeCartBtn.addEventListener("click", () => cartOverlay.classList.remove("active"));
  }
  if (proceedCheckoutBtn) {
    proceedCheckoutBtn.addEventListener("click", openCheckoutModal);
  }

  // Product Detail Quick View Modal Toggles
  const pvModal = document.getElementById("product-detail-modal");
  const closePvBtn = document.getElementById("close-product-modal-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");
  const addToCartBtn = document.getElementById("pv-add-to-cart-btn");

  if (closePvBtn && pvModal) {
    closePvBtn.addEventListener("click", () => pvModal.classList.remove("active"));
  }

  // Material variant buttons
  document.querySelectorAll(".material-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mat = btn.getAttribute("data-material");
      if (mat) {
        currentSelectedMaterial = mat;
        updateVariantStockUI();
      }
    });
  });

  if (qtyMinus) {
    qtyMinus.addEventListener("click", () => {
      if (currentSelectedQty > 1) {
        currentSelectedQty--;
        updateVariantStockUI();
      }
    });
  }

  if (qtyPlus) {
    qtyPlus.addEventListener("click", () => {
      const maxStock = getAvailableStock(currentModalProduct, currentSelectedMaterial);
      if (maxStock > 0 && currentSelectedQty >= maxStock) {
        showToast(
          `Selected quantity exceeds available showroom stock (${maxStock}). Additional units will be Made-to-Order.`
        );
      }
      if (currentSelectedQty < 20) {
        currentSelectedQty++;
        updateVariantStockUI();
      }
    });
  }

  if (addToCartBtn) {
    addToCartBtn.addEventListener("click", () => {
      if (!currentModalProduct) return;
      const customNotes = document.getElementById("pv-custom-notes")?.value || "";
      const basePrice = parseFloat(currentModalProduct.price || 0);
      const addonsTotal = selectedModalAddons.reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
      const unitPriceWithAddons = basePrice + addonsTotal;

      requireAuth(async () => {
        try {
          await addToCart(
            currentUser.uid,
            currentModalProduct,
            currentSelectedMaterial,
            currentSelectedQty,
            customNotes,
            selectedModalAddons,
            unitPriceWithAddons
          );
          const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
          const modeLabel = available > 0 ? "Ready Stock" : "Made-to-Order";
          const addonText = selectedModalAddons.length > 0 ? ` (+ ${selectedModalAddons.length} upgrades)` : "";
          showToast(
            `Added ${currentSelectedQty} x ${currentModalProduct.name} (${currentSelectedMaterial}${addonText} - ${modeLabel}) to bag!`
          );
          const notesBox = document.getElementById("pv-custom-notes");
          if (notesBox) notesBox.value = "";
          pvModal.classList.remove("active");
          cartOverlay?.classList.add("active");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }

  // Payment Term Selection (50% Downpayment vs Full Payment)
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

  // Unauthenticated Sign-In Prompt Modal Toggles
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

  // Checkout Modal Toggles & Backdrop Click Lock
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

  // Backdrop Click Lock: Prevent dismissing modal on backdrop click to protect data
  if (checkoutModal) {
    checkoutModal.addEventListener("click", (e) => {
      if (e.target === checkoutModal) {
        const card = checkoutModal.querySelector(".modal-card");
        if (card) {
          card.classList.remove("modal-shake");
          void card.offsetWidth;
          card.classList.add("modal-shake");
        }
      }
    });
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

  // Payment Method Radio Cards Selection
  document.querySelectorAll(".payment-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".payment-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedPaymentMethod = card.getAttribute("data-method") || "COD";
      updateSubmitButtonText();
      updateProofOfPaymentBox();
    });
  });
  updateSubmitButtonText();
  updateProofOfPaymentBox();

  // Place Order Submit Handler
  const placeOrderBtn = document.getElementById("place-order-submit-btn");
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener("click", handlePlaceOrderSubmit);
  }

  // Customer Auth Modal Wireup
  const authModalBtn = document.getElementById("auth-modal-btn");
  const authModal = document.getElementById("auth-modal");
  const closeAuthBtn = document.getElementById("close-auth-modal-btn");
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const loginForm = document.getElementById("customer-login-form");
  const registerForm = document.getElementById("customer-register-form");
  const signOutBtn = document.getElementById("customer-signout-btn");

  const googleBtn = document.getElementById("google-signin-btn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      try {
        const res = await signInWithGoogle();
        showToast(res.message, "success");
        authModal?.classList.remove("active");
      } catch (err) {
        console.error("Google Auth error:", err);
        showToast(err.message || "Failed to sign in with Google.", "error");
      }
    });
  }

  if (authModalBtn && authModal) {
    authModalBtn.addEventListener("click", () => authModal.classList.add("active"));
  }
  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener("click", () => authModal.classList.remove("active"));
  }

  if (tabLogin && tabRegister && loginForm && registerForm) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      loginForm.style.display = "flex";
      registerForm.style.display = "none";
    });

    tabRegister.addEventListener("click", () => {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      registerForm.style.display = "flex";
      loginForm.style.display = "none";
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-login-email").value;
      const pwd = document.getElementById("cust-login-pwd").value;
      const errEl = document.getElementById("cust-auth-error");

      try {
        if (errEl) errEl.textContent = "";
        const res = await signInUser({ email, password: pwd });
        showToast(res.message, "success");
        authModal?.classList.remove("active");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Failed to sign in.";
        showToast(err.message, "error");
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-reg-email").value;
      const pwd = document.getElementById("cust-reg-pwd").value;
      const nameEl = document.getElementById("cust-reg-name");
      const displayName = nameEl ? nameEl.value : "";
      const errEl = document.getElementById("cust-reg-error");

      try {
        if (errEl) errEl.textContent = "";
        const res = await signUpUser({ email, password: pwd, displayName });
        showToast(res.message, "info");
        authModal?.classList.remove("active");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Failed to create account.";
        showToast(err.message, "error");
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      await signOut(auth);
      showToast("Signed out.");
      authModal.classList.remove("active");
      window.location.reload();
    });
  }
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

// Phase 4 & Phase 5: Place Order Submit Handler
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

    // 1. Check if customer uploaded proof of payment slip
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

    // 2. Atomic Order Placement with Made-to-Order & Downpayment Support
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

    // 3. Post notification to customer's live chat session with the workshop
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

// Handle Return from PayMongo Checkout Redirect
async function handlePaymentRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  const isSuccess = urlParams.get("payment") === "success";

  if (!isSuccess) return;

  const rawPending = sessionStorage.getItem("pending_order_data");
  if (!rawPending) return;

  try {
    const pendingOrder = JSON.parse(rawPending);
    sessionStorage.removeItem("pending_order_data");

    // Execute Atomic Order Placement upon successful payment authorization
    const result = await placeOrderAtomic({
      userId: pendingOrder.userId || currentUser.uid,
      cartItems: pendingOrder.cartItems,
      totalAmount: pendingOrder.totalAmount,
      paymentMethod: pendingOrder.paymentMethod || "GCash",
      address: pendingOrder.address,
      paymentDetails: {
        paymongoSuccess: true,
        sessionId: urlParams.get("session_id") || "completed",
      },
    });

    showToast(`Payment Authorized! Order Placed Successfully (ID: ${result.orderId})`, "success");
    setTimeout(() => {
      window.location.href = "orders.html";
    }, 1500);

    // Clean up query string from address bar
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error("Payment Return Order Error:", err);
    showToast(`Payment Authorized, but order finalization had an issue: ${err.message}`, "error");
  }
}

// Animations helper
function initAnimations() {
  const observerOptions = {
    root: null,
    rootMargin: "0px",
    threshold: 0.15,
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll(".slide-up, .reveal").forEach((el) => observer.observe(el));

  setTimeout(() => {
    document
      .querySelectorAll(".hero .slide-up, .hero .reveal")
      .forEach((el) => el.classList.add("active"));
  }, 100);

  bindARButtons();
}

// AR Buttons 3D Viewer binding
function bindARButtons() {
  const arButtons = document.querySelectorAll(".btn-ar-view");
  arButtons.forEach((btn) => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const originalText = newBtn.innerHTML;
      newBtn.innerHTML = `<div class="dot active"></div> Loading 3D...`;

      const productCard = newBtn.closest(".product-card");
      const productName = productCard?.querySelector("h3")?.textContent || "Product";
      const productImage = productCard?.querySelector(".product-img")?.src || "";
      const productId = newBtn.getAttribute("data-product-id");

      await show3DModelViewer(productName, productImage, productId, newBtn, originalText);
    });
  });
}

// Show 3D Model Viewer Modal with Admin Parity (Progress & Meshy Polling)
async function show3DModelViewer(productName, productImage, productId, button, originalButtonText) {
  let pollTimer = null;

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "model-viewer-overlay";

  const getGlbViewerUrl = (url) => {
    if (!url) return "";
    return `/api/meshy-glb?url=${encodeURIComponent(url)}`;
  };

  modalOverlay.innerHTML = `
    <div class="model-viewer-modal">
      <div class="model-viewer-header">
        <h3>3D Model Viewer</h3>
        <button class="close-viewer" aria-label="Close 3D viewer">&times;</button>
      </div>
      <div class="model-viewer-content">
        <div class="model-viewer-canvas" style="flex-direction: column; padding: 20px;">
          <div id="pv-3d-status" class="viewer-status" style="visibility: visible;">Downloading and Opening 3D Model...</div>
          <div id="pv-3d-loading" class="viewer-loading active">
            <div class="viewer-spinner"></div>
            <div class="viewer-loading-text">Calibrating 3D object...</div>
          </div>
          <div id="pv-3d-wrapper" style="width: 100%; height: 100%; position: relative; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 320px;">
            <model-viewer
              id="pv-model-viewer-element"
              style="width: 100%; height: 100%; min-height: 320px; border-radius: 8px; background-color: #f5f5f5; display: block;"
              camera-controls
              touch-action="pan-y"
              auto-rotate
              shadow-intensity="1"
              reveal="auto"
              loading="eager"
              ar
              ar-modes="webxr scene-viewer quick-look"
              alt="${productName} 3D Model">
            </model-viewer>
          </div>
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${productName}</h4>
            <p id="pv-3d-desc">Experience this furniture piece in 3D. Rotate to view from different angles and zoom to inspect details.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalOverlay);
  modalOverlay.classList.add("active");

  const statusEl = modalOverlay.querySelector("#pv-3d-status");
  const loadingEl = modalOverlay.querySelector("#pv-3d-loading");
  const modelViewerEl = modalOverlay.querySelector("#pv-model-viewer-element");
  const wrapperEl = modalOverlay.querySelector("#pv-3d-wrapper");
  const descEl = modalOverlay.querySelector("#pv-3d-desc");

  let currentRawModelUrl = null;
  let triedDirectUrl = false;

  const hideLoading = () => {
    if (loadingEl) loadingEl.classList.remove("active");
    if (statusEl) statusEl.style.visibility = "hidden";
  };

  const showFallback2D = (message) => {
    if (loadingEl) loadingEl.classList.remove("active");
    if (statusEl) {
      statusEl.style.visibility = "visible";
      statusEl.textContent = message || "3D model not available for this product yet.";
    }
    if (descEl) {
      descEl.textContent =
        "This product doesn't have an active 3D model yet. You are viewing a 2D preview.";
    }
    if (wrapperEl) {
      wrapperEl.innerHTML = `
        <div class="model-placeholder">
          <img src="${productImage}" alt="${productName}" class="model-image" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div class="no-3d-message">
            <p>${message || "3D model not available"}</p>
            <p class="fallback-text">Showing 2D preview</p>
          </div>
        </div>
      `;
    }
  };

  if (modelViewerEl) {
    modelViewerEl.addEventListener("load", () => hideLoading());

    modelViewerEl.addEventListener("progress", (ev) => {
      const detail = ev.detail;
      if (detail && typeof detail.totalProgress === "number") {
        const pct = Math.round(detail.totalProgress * 100);
        if (statusEl) {
          statusEl.style.visibility = "visible";
          statusEl.textContent = `Downloading 3D Model... ${pct}%`;
        }
        if (pct >= 100) {
          setTimeout(hideLoading, 350);
        }
      }
    });

    modelViewerEl.addEventListener("error", (ev) => {
      console.warn("Model viewer load error:", ev);
      // Fallback: If proxy endpoint failed on static mobile server, retry directly from raw storage URL
      if (
        !triedDirectUrl &&
        currentRawModelUrl &&
        (currentRawModelUrl.startsWith("http://") || currentRawModelUrl.startsWith("https://"))
      ) {
        triedDirectUrl = true;
        console.log("Retrying 3D model directly from raw storage URL:", currentRawModelUrl);
        statusEl.style.visibility = "visible";
        statusEl.textContent = "Retrying direct 3D model stream...";
        modelViewerEl.src = currentRawModelUrl;
        return;
      }
      showFallback2D("Failed to load 3D model");
    });
  }

  // Periodic safety check to ensure spinner hides once model is rendered
  const loadCheckInterval = setInterval(() => {
    if (modelViewerEl && modelViewerEl.loaded) {
      hideLoading();
      clearInterval(loadCheckInterval);
    }
  }, 500);

  const closeModal = () => {
    if (pollTimer) clearTimeout(pollTimer);
    clearInterval(loadCheckInterval);
    modalOverlay.remove();
    button.innerHTML = originalButtonText;
  };

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  modalOverlay.querySelector(".close-viewer")?.addEventListener("click", closeModal);

  setTimeout(() => {
    button.innerHTML = originalButtonText;
  }, 400);

  // Fetch product and poll Meshy if needed
  if (!productId) {
    showFallback2D("No product specified.");
    return;
  }

  try {
    const productDoc = await getDoc(doc(db, "products", productId));
    if (!productDoc.exists()) {
      showFallback2D("Product not found.");
      return;
    }

    const pData = productDoc.data();
    const modelUrl =
      pData.modelUrl || pData.glbUrl || pData.model_url || pData.arModelUrl || pData.usdzUrl;
    currentRawModelUrl = modelUrl;

    if (modelUrl) {
      statusEl.textContent = "Loading 3D model...";
      const targetViewerUrl = getGlbViewerUrl(modelUrl);
      const usdzUrl = pData.usdzUrl || "";
      await attachModelToViewer(modelViewerEl, targetViewerUrl, {
        usdzUrl,
        onProgress: (pct) => {
          if (statusEl) {
            statusEl.style.visibility = "visible";
            statusEl.textContent = pct >= 100 ? "Rendering 3D Model..." : `Downloading 3D Model... ${pct}%`;
          }
        }
      });
      return;
    }

    // Check if Meshy task is generating 3D model
    const taskId = pData.meshyTaskId;
    if (!taskId) {
      showFallback2D("No 3D model available for this product yet.");
      return;
    }

    // Poll Meshy status
    const pollMeshy = async (attempt = 0) => {
      try {
        const response = await fetch(`/api/meshy-image-to-3d/${encodeURIComponent(taskId)}`);
        if (!response.ok) throw new Error("Failed to fetch 3D model generation status.");

        const data = await response.json();
        const status = String(data.status || "").toUpperCase();
        const progress = Number(data.progress || 0);

        if (status === "SUCCEEDED" && data.model_urls && data.model_urls.glb) {
          const targetUrl = getGlbViewerUrl(data.model_urls.glb);
          statusEl.textContent = "Downloading and Opening 3D Model... 100%";
          await attachModelToViewer(modelViewerEl, targetUrl, {
            onProgress: (pct) => {
              if (statusEl) {
                statusEl.style.visibility = "visible";
                statusEl.textContent = pct >= 100 ? "Rendering 3D Model..." : `Downloading 3D Model... ${pct}%`;
              }
            }
          });
          setTimeout(() => {
            if (modelViewerEl.loaded) hideLoading();
          }, 400);

          // Update product document in background with modelUrl for fast future loads
          try {
            await updateDoc(doc(db, "products", productId), { modelUrl: data.model_urls.glb });
          } catch (e) {
            console.warn("Could not save modelUrl back to product doc:", e);
          }
          return;
        }

        if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") {
          showFallback2D(`Model generation ${status.toLowerCase()}.`);
          return;
        }

        if (attempt >= 30) {
          showFallback2D("3D model generation timed out. Please try again later.");
          return;
        }

        statusEl.textContent = `Downloading and Opening 3D Model... ${progress}%`;
        pollTimer = setTimeout(() => pollMeshy(attempt + 1), 2500);
      } catch (err) {
        console.error("Meshy polling error:", err);
        showFallback2D("Network error while loading 3D model.");
      }
    };

    await pollMeshy(0);
  } catch (err) {
    console.error("Error opening 3D viewer:", err);
    showFallback2D("Failed to load product details.");
  }
}

// Hidden Admin Trigger
function setupAdminLogoTrigger() {
  const logoArea = document.querySelector(".logo");
  if (!logoArea) return;

  const clickWindowMs = 1100;
  let clickTimes = [];
  let redirecting = false;

  logoArea.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (redirecting) return;

    const now = Date.now();
    clickTimes.push(now);
    clickTimes = clickTimes.filter((t) => now - t <= clickWindowMs);

    if (clickTimes.length >= 3) {
      redirecting = true;
      clickTimes = [];
      window.location.href = "/login.html";
    }
  });

  logoArea.setAttribute("title", "Lanica Furniture (Triple click for CMS)");
  logoArea.style.cursor = "pointer";
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

// Live Workshop & Support Chat Widget
function setupLiveChatWidget() {
  const launcher = document.getElementById("lanica-chat-launcher");
  const drawer = document.getElementById("lanica-chat-drawer");
  const menuScreen = document.getElementById("support-menu-screen");
  const chatScreen = document.getElementById("live-chat-screen");
  const openLiveChatBtn = document.getElementById("open-live-chat-btn");
  const backToMenuBtn = document.getElementById("back-to-support-menu-btn");
  const closeButtons = drawer ? drawer.querySelectorAll(".close-support-drawer") : [];
  const channelBar = document.getElementById("customer-chat-channel-bar");
  const form = document.getElementById("chat-input-form");
  const textInput = document.getElementById("chat-text-input");
  const fileInput = document.getElementById("chat-file-input");
  const previewBox = document.getElementById("chat-attachment-preview");
  const previewName = document.getElementById("chat-attachment-name");
  const cancelAttachBtn = document.getElementById("chat-cancel-attachment");
  const messagesArea = document.getElementById("chat-messages-area");
  const unreadBadge = document.getElementById("chat-unread-badge");
  const headerTitle = document.getElementById("chat-header-title");
  const headerStatus = document.getElementById("chat-header-status");

  let attachedFile = null;
  let currentChannel = "support"; // "support" | "order"
  let activeChatOrderId = null;
  let userOrdersList = [];
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
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showToast("Attachment must be less than 5MB.", "error");
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
    if (!userOrdersList || userOrdersList.length === 0) {
      channelBar.style.display = "none";
      return;
    }

    channelBar.style.display = "flex";
    let barHtml = `
      <button type="button" class="chat-channel-pill ${currentChannel === "support" ? "active" : ""}" data-channel="support">
        💬 Live Support
      </button>
    `;

    userOrdersList.forEach((o) => {
      const oId = o.id;
      const orderNum = o.orderId || o.id;
      const isSel = currentChannel === "order" && activeChatOrderId === oId;
      barHtml += `
        <button type="button" class="chat-channel-pill ${isSel ? "active" : ""}" data-channel="order" data-order-id="${oId}">
          🧵 #${orderNum}
        </button>
      `;
    });

    channelBar.innerHTML = barHtml;

    channelBar.querySelectorAll(".chat-channel-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ch = btn.getAttribute("data-channel");
        const oId = btn.getAttribute("data-order-id");
        if (ch === "support") {
          switchChannel("support");
        } else {
          switchChannel("order", oId);
        }
      });
    });
  }

  function renderMessagesList(messages, channelType, orderNum = "") {
    if (!messagesArea) return;

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
        const isMe = currentUser && m.senderId === currentUser.uid;
        const roleClass = isMe ? "customer" : m.senderRole || "staff";
        const senderLabel = isMe
          ? "You"
          : m.senderName || (channelType === "support" ? "Lanica Support" : "Workshop Support");

        const timeDate = m.timestamp?.toDate
          ? m.timestamp.toDate()
          : m.createdAt?.toDate
            ? m.createdAt.toDate()
            : m.timestamp || m.createdAt
              ? new Date(m.timestamp || m.createdAt)
              : null;
        const timeStr = timeDate
          ? timeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        if (m.isUnsent) {
          html += `
            <div class="chat-msg-row ${roleClass}">
              <span class="chat-msg-sender">${escapeHtml(senderLabel)}</span>
              <div class="chat-msg-bubble unsent">
                This message was unsent
              </div>
              ${timeStr ? `<span class="chat-msg-time">${timeStr}</span>` : ""}
            </div>
          `;
          return;
        }

        html += `
          <div class="chat-msg-row ${roleClass}">
            <span class="chat-msg-sender">${escapeHtml(senderLabel)}</span>
            <div class="chat-msg-bubble">
              ${m.text || m.message || m.content ? `<p style="margin: 0;">${escapeHtml(m.text || m.message || m.content)}</p>` : ""}
              ${
                m.attachmentUrl || m.imageUrl
                  ? `<a href="${m.attachmentUrl || m.imageUrl}" target="_blank" rel="noopener"><img src="${m.attachmentUrl || m.imageUrl}" class="chat-msg-img" alt="Attachment" /></a>`
                  : ""
              }
            </div>
            ${timeStr ? `<span class="chat-msg-time">${timeStr}</span>` : ""}
          </div>
        `;
      });
    }

    messagesArea.innerHTML = html;
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
              <button type="button" id="main-chat-signin-btn" style="padding: 7px 16px; background: #6b4423; color: #fff; border: none; border-radius: 6px; font-size: 0.82rem; cursor: pointer; font-weight: 600;">Sign In Now</button>
            </div>
          `;
          document.getElementById("main-chat-signin-btn")?.addEventListener("click", () => {
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
      const matched = userOrdersList.find((o) => o.id === orderId);
      const orderNum = matched ? matched.orderId || matched.id : orderId;
      const statusText = matched
        ? matched.orderStatus || matched.status || "In Production"
        : "Active";

      if (headerTitle) headerTitle.textContent = `ORDER #${orderNum}`;
      if (headerStatus) headerStatus.textContent = `Workshop Thread · ${statusText}`;

      chatUnsubscribe = subscribeToMessages(orderId, (messages) => {
        renderMessagesList(messages, "order", orderNum);
      });
    }
  }

  async function initUserChat(user) {
    if (!user) return;
    try {
      userOrdersList = await getCustomerOrders(user.uid);
      renderChannelBar();

      // Listen in background for unread support messages
      if (supportUnreadUnsubscribe) supportUnreadUnsubscribe();
      supportUnreadUnsubscribe = subscribeToUserSupportMessages(user.uid, (messages) => {
        const hasUnread = messages.some((m) => {
          const isFromStaff =
            m.senderRole === "admin" || m.senderRole === "staff" || m.senderId === "support_admin";
          return isFromStaff && m.isRead === false;
        });

        if (hasUnread && unreadBadge && !drawer?.classList.contains("active")) {
          unreadBadge.style.display = "block";
        }
      });
    } catch (err) {
      console.warn("Could not load user chat orders:", err);
    }
  }

  function openOrderChat(orderId) {
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
          });
        }

        if (textInput) textInput.value = "";
        scrollChatToBottom();
      } catch (err) {
        console.error("Chat error:", err);
        showToast(err.message || "Failed to send message.", "error");
      }
    });
  }

  return { initUserChat, openOrderChat, openSupportChat };
}
