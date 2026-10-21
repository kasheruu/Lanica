import { Validators, initGlobalInputGuards } from "./validator.js";
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
import { showToast, showConfirmModal, showAlertModal } from "./uiFeedback.js";

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
import { openPaymongoQrModal } from "./paymongoController.js";

import {
  getCustomerOrders,
  sendChatMessage,
  subscribeToMessages,
  subscribeToUserSupportMessages,
  markUserSupportMessagesAsRead,
  uploadChatAttachment,
  unsendChatMessage,
  showMessengerUnsendModal,
} from "./chatService.js";

// Global State
let currentUser = null;
let currentCartItems = [];
let selectedAddressId = null;
let savedAddresses = [];
let selectedPaymentMethod = "qr_code";
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

    const track = container.querySelector(".card-slideshow-track");
    const slides = container.querySelectorAll(".card-slideshow-slide");
    const dots = container.querySelectorAll(".card-slideshow-dot");
    const prevBtn = container.querySelector(".card-slideshow-btn.prev");
    const nextBtn = container.querySelector(".card-slideshow-btn.next");

    if (slides.length <= 1) return;

    let currentIndex = 0;

    function goToSlide(index) {
      currentIndex = (index + slides.length) % slides.length;
      if (track) {
        track.style.transform = `translateX(-${currentIndex * 100}%)`;
      }
      slides.forEach((s, i) => s.classList.toggle("active", i === currentIndex));
      dots.forEach((d, i) => d.classList.toggle("active", i === currentIndex));
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(currentIndex - 1);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(currentIndex + 1);
      });
    }

    dots.forEach((dot, idx) => {
      dot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        goToSlide(idx);
      });
    });

    // Touch swipe support - Strictly horizontal swipe only
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isTouchActive = false;

    container.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        isTouchActive = true;
      },
      { passive: true }
    );

    container.addEventListener(
      "touchend",
      (e) => {
        if (!isTouchActive) return;
        isTouchActive = false;
        if (!e.changedTouches || e.changedTouches.length === 0) return;

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        const elapsed = Date.now() - touchStartTime;

        // ONLY trigger slide change when swipe is predominantly horizontal:
        // diffX must be > 40px and at least 1.5x greater than vertical movement diffY,
        // completed within 800ms
        if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.5 && elapsed < 800) {
          const card = container.closest(".product-card");
          if (card) {
            card.dataset.wasSwiping = "true";
            setTimeout(() => {
              if (card) card.dataset.wasSwiping = "false";
            }, 300);
          }
          if (diffX < 0) {
            goToSlide(currentIndex + 1);
          } else {
            goToSlide(currentIndex - 1);
          }
        }
      },
      { passive: true }
    );
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
              <button class="btn-ar-view" data-product-id="${docSnap.id}" data-materials="${escapeHtml(JSON.stringify(extractProductMaterials(product)))}" title="View in 3D / AR">
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
              <button class="btn-ar-view" data-product-id="${docSnap.id}" data-materials="${escapeHtml(JSON.stringify(extractProductMaterials(product)))}" title="View in 3D / AR">
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
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
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
        card.dataset.wasSwiping === "true" ||
        e.target.closest(".btn-ar-view") ||
        e.target.closest(".card-slideshow-btn") ||
        e.target.closest(".card-slideshow-dots") ||
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
let currentSelectedColor = "";
let currentOrientation = "left";
let selectedBedSize = null;

const DEFAULT_BED_SIZES = [
  { name: "Single", dimensions: "36 × 75 in", priceDelta: 0 },
  { name: "Double / Full", dimensions: "54 × 75 in", priceDelta: 2500 },
  { name: "Queen", dimensions: "60 × 75 in", priceDelta: 4500 },
  { name: "King", dimensions: "72 × 78 in", priceDelta: 7000 },
];

function formatDimensionsDisplay(product, orientation = "left") {
  if (!product) return "";
  const isRight = orientation === "right";
  let html = "";
  const rightBadge = isRight
    ? ` <span class="pdp-badge-orientation" style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-left: 6px; vertical-align: 1px; display: inline-block;">RIGHT ORIENTATION</span>`
    : "";

  if (product.dimensions && typeof product.dimensions.height === "number") {
    const d = product.dimensions;
    const u = d.unit || "in";
    const len = d.length;
    const wid = d.width;
    const hgt = d.height;

    if (d.isLType && d.length2) {
      if (isRight) {
        html = `W: <strong>${wid} ${u}</strong> · L: <strong>${len} × ${d.length2} ${u}</strong> <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin: 0 4px; vertical-align: 1px; display: inline-block;">L-SHAPE</span> · H: <strong>${hgt} ${u}</strong>${rightBadge}`;
      } else {
        html = `L: <strong>${len} × ${d.length2} ${u}</strong> <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin: 0 4px; vertical-align: 1px; display: inline-block;">L-SHAPE</span> · W: <strong>${wid} ${u}</strong> · H: <strong>${hgt} ${u}</strong>`;
      }
    } else if (len && wid && hgt) {
      if (isRight) {
        html = `${wid} × ${len} × ${hgt} ${u}${rightBadge}`;
      } else {
        html = `${len} × ${wid} × ${hgt} ${u}`;
      }
    } else if (len && wid) {
      if (isRight) {
        html = `${wid} × ${len} ${u}${rightBadge}`;
      } else {
        html = `${len} × ${wid} ${u}`;
      }
    } else {
      html = `${wid} × ${hgt} ${u}${rightBadge}`;
    }
  } else if (product.size) {
    const s = String(product.size);
    const isLShape = s.includes("L-Type");
    const cleaned = s.replace("(L-Type)", "").replace(/\s+/g, " ").trim();
    const lShapeBadge = isLShape
      ? ` <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-left: 4px; vertical-align: 1px; display: inline-block;">L-SHAPE</span>`
      : "";

    if (isRight) {
      const parts = cleaned.split(/\s*[×x]\s*/);
      if (parts.length >= 2) {
        const temp = parts[0];
        parts[0] = parts[1];
        parts[1] = temp;
        html = `${escapeHtml(parts.join(" × "))}${lShapeBadge}${rightBadge}`;
      } else {
        html = `${escapeHtml(cleaned)}${lShapeBadge}${rightBadge}`;
      }
    } else {
      html = `${escapeHtml(cleaned)}${lShapeBadge}`;
    }
  }

  return html;
}

function updateModalDimensionsUI() {
  const dimsEl = document.getElementById("pv-dimensions-info");
  const dimsCard = document.getElementById("pv-dimensions-card");
  if (!dimsEl || !currentModalProduct) return;

  const isBed = (currentModalProduct.category || "").toLowerCase().includes("bed");
  if (isBed && selectedBedSize) {
    const dimsStr = selectedBedSize.dimensions || (selectedBedSize.width && selectedBedSize.length ? `${selectedBedSize.width} × ${selectedBedSize.length}` : "");
    dimsEl.innerHTML = `<strong>${escapeHtml(dimsStr)}</strong> <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-left: 6px; vertical-align: 1px; display: inline-block;">${escapeHtml((selectedBedSize.name || "").toUpperCase())}</span>`;
    if (dimsCard) dimsCard.style.display = "block";
    return;
  }

  const htmlContent = formatDimensionsDisplay(currentModalProduct, currentOrientation);
  if (htmlContent) {
    dimsEl.innerHTML = htmlContent;
    if (dimsCard) dimsCard.style.display = "block";
  } else {
    if (dimsCard) dimsCard.style.display = "none";
  }
}

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

  const isBed = (currentModalProduct.category || "").toLowerCase().includes("bed");
  const sizePriceDelta = isBed && selectedBedSize ? (parseFloat(selectedBedSize.priceDelta) || 0) : 0;

  const unitPrice = basePrice + sizePriceDelta + addonsTotal;
  const totalPrice = unitPrice * currentSelectedQty;

  const priceEl = document.getElementById("pv-price");
  if (priceEl) priceEl.textContent = `₱${(basePrice + sizePriceDelta).toLocaleString()}`;

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

    // Feature 1: Sofa Chaise Orientation Section
    const defaultOrient = (currentModalProduct.dimensions && currentModalProduct.dimensions.defaultOrientation)
      ? String(currentModalProduct.dimensions.defaultOrientation).toLowerCase()
      : "left";
    currentOrientation = defaultOrient === "right" ? "right" : "left";
    const orientSection = document.getElementById("pv-orientation-section");
    const orientLeftBtn = document.getElementById("pv-orient-left-btn");
    const orientRightBtn = document.getElementById("pv-orient-right-btn");
    const orientBadge = document.getElementById("pv-selected-orientation-badge");
    const mainImgEl = document.getElementById("pv-image");

    if (mainImgEl) mainImgEl.style.transform = currentOrientation === "right" ? "scaleX(-1)" : "none";
    if (orientLeftBtn) {
      if (currentOrientation === "left") orientLeftBtn.classList.add("active");
      else orientLeftBtn.classList.remove("active");
    }
    if (orientRightBtn) {
      if (currentOrientation === "right") orientRightBtn.classList.add("active");
      else orientRightBtn.classList.remove("active");
    }
    if (orientBadge) orientBadge.textContent = currentOrientation === "right" ? "Facing Right" : "Facing Left (Standard)";

    const isSofa = (currentModalProduct.category || "").toLowerCase().includes("sofa");
    const isLType = (currentModalProduct.dimensions && currentModalProduct.dimensions.isLType === true) || isSofa;
    if (orientSection) {
      orientSection.style.display = isLType ? "block" : "none";
    }

    // Feature 2: Bed Sizes Section
    selectedBedSize = null;
    const bedSection = document.getElementById("pv-bed-size-section");
    const bedSelect = document.getElementById("pv-bed-size-select");
    const bedBadge = document.getElementById("pv-selected-bed-size-badge");
    const isBed = (currentModalProduct.category || "").toLowerCase().includes("bed");
    const hasConfiguredBedSizes = Array.isArray(currentModalProduct.bedSizes) && currentModalProduct.bedSizes.length > 0;

    if (bedSection) {
      if (isBed && hasConfiguredBedSizes) {
        bedSection.style.display = "block";
        const bedSizesToUse = currentModalProduct.bedSizes;

        if (bedSelect) {
          bedSelect.innerHTML = bedSizesToUse
            .map((s, idx) => {
              const delta = parseFloat(s.priceDelta) || 0;
              const deltaText = delta > 0 ? ` (+₱${delta.toLocaleString()})` : (delta < 0 ? ` (-₱${Math.abs(delta).toLocaleString()})` : "");
              const dimsStr = s.dimensions || (s.width && s.length ? `${s.width} × ${s.length}` : "");
              return `<option value="${idx}">${escapeHtml(s.name)}${dimsStr ? ` — ${escapeHtml(dimsStr)}` : ""}${deltaText}</option>`;
            })
            .join("");
          bedSelect.value = "0";
          selectedBedSize = bedSizesToUse[0];
          if (bedBadge) bedBadge.textContent = `Selected: ${selectedBedSize.name}`;
        }
      } else {
        bedSection.style.display = "none";
      }
    }

    updateModalDimensionsUI();

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

    // Interactive Color Selection Picker
    let availableColors = [];
    if (Array.isArray(currentModalProduct.colors) && currentModalProduct.colors.length > 0) {
      availableColors = currentModalProduct.colors
        .map((c) => String(c).trim())
        .filter(Boolean);
    } else {
      const rawColorStr = currentModalProduct.color || currentModalProduct.fabricColor || "";
      if (rawColorStr) {
        availableColors = String(rawColorStr)
          .split(/[\n,]+/)
          .map((c) => c.trim())
          .filter(Boolean);
      }
    }

    const colorSection = document.getElementById("pv-color-section");
    const colorsList = document.getElementById("pv-colors-list");
    const selectedColorBadge = document.getElementById("pv-selected-color-badge");

    if (availableColors.length > 0) {
      currentSelectedColor = availableColors[0];
      if (selectedColorBadge) {
        selectedColorBadge.textContent = `Selected: ${currentSelectedColor}`;
      }
      if (colorsList) {
        colorsList.innerHTML = availableColors
          .map(
            (color, idx) => `
          <button type="button" class="pdp-color-chip ${idx === 0 ? "selected" : ""}" data-color="${escapeHtml(color)}">
            <span class="pdp-color-chip-check">✓</span>
            <span class="pdp-color-chip-text">${escapeHtml(color)}</span>
          </button>
        `
          )
          .join("");

        colorsList.querySelectorAll(".pdp-color-chip").forEach((chip) => {
          chip.addEventListener("click", () => {
            colorsList
              .querySelectorAll(".pdp-color-chip")
              .forEach((c) => c.classList.remove("selected"));
            chip.classList.add("selected");
            currentSelectedColor = chip.getAttribute("data-color");
            if (selectedColorBadge) {
              selectedColorBadge.textContent = `Selected: ${currentSelectedColor}`;
            }
          });
        });
      }
      if (colorSection) colorSection.style.display = "block";
    } else {
      currentSelectedColor = "";
      if (colorSection) colorSection.style.display = "none";
      if (colorsList) colorsList.innerHTML = "";
    }

    // Render Freebies & Inclusions Card
    const freebiesCard = document.getElementById("pv-freebies-card");
    const freebiesList = document.getElementById("pv-freebies-list");
    const rawFreebies = currentModalProduct.freebies;
    if (freebiesList) {
      const freebiesArr = (Array.isArray(rawFreebies) ? rawFreebies : String(rawFreebies || "").split(/[\n,]+/))
        .map((f) => String(f).trim())
        .filter(Boolean);
      if (freebiesArr.length > 0) {
        freebiesList.innerHTML = freebiesArr
          .map(
            (f) => `
          <div class="pdp-check-item">
            <span class="pdp-check-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <span style="font-weight: 600;">${escapeHtml(f)}</span>
          </div>
        `
          )
          .join("");
        if (freebiesCard) freebiesCard.style.display = "block";
      } else {
        if (freebiesCard) freebiesCard.style.display = "none";
        freebiesList.innerHTML = "";
      }
    }

    // Dynamic Materials Checklist
    const materialsChecklist = document.getElementById("pv-materials-checklist");
    const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    if (materialsChecklist && prodMaterials.length > 0 && prodMaterials[0] !== "Standard") {
      materialsChecklist.innerHTML = [
        ...prodMaterials.map((m) => `
          <div class="pdp-check-item">
            <span class="pdp-check-icon">${checkSvg}</span>
            <span>${escapeHtml(m)}</span>
          </div>
        `),
        `
          <div class="pdp-check-item">
            <span class="pdp-check-icon">${checkSvg}</span>
            <span>Anti Anay at Bukbok Treated</span>
          </div>
          <div class="pdp-check-item">
            <span class="pdp-check-icon">${checkSvg}</span>
            <span>Plush Premium Upholstery Fabric</span>
          </div>
        `
      ].join("");
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
      if (ctaSpan) ctaSpan.textContent = "PLACE ORDER";
    }

    if (currentSelectedQty < 1) currentSelectedQty = 1;
    if (currentSelectedQty > available) currentSelectedQty = available;
  } else {
    const lead = (currentModalProduct.leadTime || currentModalProduct.estimated_lead_time || "14-21 Days").trim();
    if (statusEl) {
      statusEl.innerHTML = `Made to Order (Lead Time: ${escapeHtml(lead)})`;
      statusEl.className = "pdp-stock-chip mto";
    }
    if (leadBadge) {
      leadBadge.textContent = `MTO (~${escapeHtml(lead)})`;
      leadBadge.style.background = "#e0f2fe";
      leadBadge.style.color = "#0369a1";
    }
    if (addBtn) {
      addBtn.disabled = false;
      const ctaSpan = addBtn.querySelector("span:first-child");
      if (ctaSpan) ctaSpan.textContent = "PLACE ORDER";
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
    closePvBtn.addEventListener("click", () => {
      pvModal.classList.remove("active");
      const pvImg = document.getElementById("pv-image");
      if (pvImg) pvImg.style.transform = "none";
    });
  }

  // Feature 1: Chaise Orientation Toggle listeners
  const orientLeftBtn = document.getElementById("pv-orient-left-btn");
  const orientRightBtn = document.getElementById("pv-orient-right-btn");
  const orientBadge = document.getElementById("pv-selected-orientation-badge");
  const pvMainImage = document.getElementById("pv-image");

  if (orientLeftBtn) {
    orientLeftBtn.addEventListener("click", () => {
      currentOrientation = "left";
      if (pvMainImage) pvMainImage.style.transform = "none";
      orientLeftBtn.classList.add("active");
      if (orientRightBtn) orientRightBtn.classList.remove("active");
      if (orientBadge) orientBadge.textContent = "Facing Left (Standard)";
      updateModalDimensionsUI();
    });
  }

  if (orientRightBtn) {
    orientRightBtn.addEventListener("click", () => {
      currentOrientation = "right";
      if (pvMainImage) pvMainImage.style.transform = "scaleX(-1)";
      orientRightBtn.classList.add("active");
      if (orientLeftBtn) orientLeftBtn.classList.remove("active");
      if (orientBadge) orientBadge.textContent = "Facing Right (Flipped)";
      updateModalDimensionsUI();
    });
  }

  // Feature 2: Bed Size Selection dropdown listener
  const bedSelect = document.getElementById("pv-bed-size-select");
  const bedBadge = document.getElementById("pv-selected-bed-size-badge");
  if (bedSelect) {
    bedSelect.addEventListener("change", (e) => {
      if (!currentModalProduct) return;
      const bedSizesToUse = Array.isArray(currentModalProduct.bedSizes) && currentModalProduct.bedSizes.length > 0
        ? currentModalProduct.bedSizes
        : [];
      const idx = parseInt(e.target.value, 10);
      selectedBedSize = bedSizesToUse[idx] || bedSizesToUse[0] || null;
      if (bedBadge && selectedBedSize) bedBadge.textContent = `Selected: ${selectedBedSize.name}`;
      updateModalDimensionsUI();
      recalculatePdpTotals();
    });
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
      const isBed = (currentModalProduct.category || "").toLowerCase().includes("bed");
      const sizePriceDelta = isBed && selectedBedSize ? (parseFloat(selectedBedSize.priceDelta) || 0) : 0;
      const addonsTotal = selectedModalAddons.reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
      const unitPriceWithAddons = basePrice + sizePriceDelta + addonsTotal;

      requireAuth(async () => {
        try {
          currentModalProduct.selectedColor = currentSelectedColor || "";
          if (isBed && selectedBedSize) {
            currentModalProduct.selectedBedSize = selectedBedSize.name;
          }
          if (currentOrientation === "right") {
            currentModalProduct.selectedOrientation = "Facing Right";
          }
          await addToCart(
            currentUser.uid,
            currentModalProduct,
            currentSelectedMaterial,
            currentSelectedQty,
            customNotes,
            selectedModalAddons,
            unitPriceWithAddons,
            currentSelectedColor
          );
          const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
          const modeLabel = available > 0 ? "Ready Stock" : "Made-to-Order";
          const colorText = currentSelectedColor ? ` [${currentSelectedColor}]` : "";
          const addonText = selectedModalAddons.length > 0 ? ` (+ ${selectedModalAddons.length} upgrades)` : "";
          showToast(
            `Added ${currentSelectedQty} x ${currentModalProduct.name}${colorText} (${currentSelectedMaterial}${addonText} - ${modeLabel}) to bag!`
          );
          const notesBox = document.getElementById("pv-custom-notes");
          if (notesBox) notesBox.value = "";
          pvModal.classList.remove("active");
          const pvImg = document.getElementById("pv-image");
          if (pvImg) pvImg.style.transform = "none";
          cartOverlay?.classList.add("active");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  }

  // Payment Term Selection (30% Downpayment vs Full Payment)
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

  // Payment Method Selection (PayMongo QR Ph vs Walk-in Counter Cash)
  document.querySelectorAll(".payment-card").forEach((card) => {
    card.addEventListener("click", () => {
      const method = card.getAttribute("data-method");
      if (!method) return;
      selectedPaymentMethod = method;
      document.querySelectorAll(".payment-card").forEach((c) => {
        c.classList.remove("selected");
        c.style.borderColor = "#e5e7eb";
        c.style.background = "#f9fafb";
        const circle = c.querySelector(".payment-card-check circle");
        if (circle) circle.setAttribute("fill", "#e2e8f0");
      });
      card.classList.add("selected");
      card.style.borderColor = "var(--clr-yellow, #fcd535)";
      card.style.background = "#fffdf0";
      const activeCircle = card.querySelector(".payment-card-check circle");
      if (activeCircle) activeCircle.setAttribute("fill", "#fcd535");

      const submitBtn = document.getElementById("place-order-submit-btn");
      if (submitBtn) {
        if (selectedPaymentMethod === "walk_in_cash") {
          submitBtn.textContent = "Reserve Slot (Pay at Workshop Counter)";
        } else {
          submitBtn.textContent = "Place Order & Pay 30% via QR Ph";
        }
      }
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

  // Customer Auth Modal is handled centrally by initAuthModalController()
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
    const nearestLandmarkVal =
      document.getElementById("checkout-nearest-landmark")?.value?.trim() || "";
    const addressWithLandmark = {
      ...targetAddress,
      nearestLandmark: nearestLandmarkVal,
    };

    // Step 1: Draft Order ID & Payment Gate initialization
    const draftOrderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (selectedPaymentMethod === "walk_in_cash") {
      // WALK-IN WORKSHOP CASH DOWNPAYMENT PIPELINE:
      // Direct reservation without PayMongo modal. Settle within 48 hours at counter.
      const downpaymentRequired = Math.round(totalAmount * 0.30);
      const remainingBalance = totalAmount - downpaymentRequired;

      const orderResult = await placeOrderAtomic({
        orderId: draftOrderId,
        userId: currentUser.uid,
        cartItems: currentCartItems,
        totalAmount: totalAmount,
        paymentMethod: "walk_in_cash",
        paymentOption: "downpayment",
        address: addressWithLandmark,
        customNotes: customComments,
        paymentDetails: {
          customSketchUrl: customSketchUrl || null,
          customComments: customComments,
          selectedTerm: "downpayment",
          accountName: targetAddress.recipientName,
          submittedAt: new Date().toISOString(),
          downpaymentPaid: false,
          paymentStatus: "awaiting_counter_downpayment",
          downpaymentRequired: downpaymentRequired,
        },
      });

      // Post confirmation to live chat
      try {
        await sendChatMessage({
          orderId: draftOrderId,
          senderId: currentUser.uid,
          senderName: currentUser.displayName || targetAddress.recipientName || "Customer",
          senderRole: "customer",
          text: `Hello! I have reserved Order #${draftOrderId} (Walk-in Workshop Cash). 30% Downpayment: ₱${downpaymentRequired.toLocaleString()}. Reservation valid for 48 hours.${customComments ? ` Custom Notes: "${customComments}"` : ""}`,
          attachmentUrl: customSketchUrl || null,
        });
      } catch (chatErr) {
        console.warn("Could not post auto chat confirmation:", chatErr);
      }

      document.getElementById("checkout-modal")?.classList.remove("active");
      submitBtn.disabled = false;
      submitBtn.textContent = "Place Order Now";

      showToast(`Slot Reserved! Order #${draftOrderId} created. Settle 30% downpayment at our workshop within 48 hours.`, "success");
      setTimeout(() => {
        window.location.href = `orders.html?orderId=${encodeURIComponent(draftOrderId)}&reservation=success`;
      }, 1200);
      return;
    }

    // Step 2 & 3: PayMongo QR Ph Modal & Await Verification Gate
    document.getElementById("checkout-modal")?.classList.remove("active");
    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order Now";

    const isDownpayment = selectedPaymentTerm === "downpayment";
    const chargeAmount = isDownpayment ? Math.round(totalAmount * 0.30) : Math.round(totalAmount);

    await openPaymongoQrModal({
      orderId: draftOrderId,
      totalAmount: totalAmount,
      exactAmount: chargeAmount,
      onConfirmPayment: async ({ paymentIntentId }) => {
        // POST-VERIFICATION PLACEMENT GATE:
        // Strictly execute atomic order creation only AFTER PayMongo confirms payment is succeeded!
        const orderResult = await placeOrderAtomic({
          orderId: draftOrderId,
          userId: currentUser.uid,
          cartItems: currentCartItems,
          totalAmount: totalAmount,
          paymentMethod: "QR Ph (PayMongo)",
          paymentOption: selectedPaymentTerm,
          address: addressWithLandmark,
          customNotes: customComments,
          paymentDetails: {
            customSketchUrl: customSketchUrl || null,
            customComments: customComments,
            selectedTerm: selectedPaymentTerm,
            accountName: targetAddress.recipientName,
            submittedAt: new Date().toISOString(),
            downpaymentPaid: true,
            paymentStatus: isDownpayment ? "downpayment_paid" : "Paid",
            paymentIntentId: paymentIntentId,
            downpaymentCentavos: Math.round(chargeAmount * 100),
            downpaymentAmount: chargeAmount,
            verifiedAt: new Date().toISOString(),
          },
        });

        // Post confirmation to live chat
        try {
          const termLabel = selectedPaymentTerm === "downpayment" ? "30% Downpayment" : "Full Payment";
          await sendChatMessage({
            orderId: draftOrderId,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || targetAddress.recipientName || "Customer",
            senderRole: "customer",
            text: `Hello! I have placed Order #${draftOrderId} (${termLabel} Verified via PayMongo QR Ph). Total: ₱${totalAmount.toLocaleString()}.${customComments ? ` Custom Notes: "${customComments}"` : ""}`,
            attachmentUrl: customSketchUrl || null,
          });
        } catch (chatErr) {
          console.warn("Could not post auto chat confirmation:", chatErr);
        }

        return orderResult;
      },
      onSuccess: (confirmedOrderId) => {
        showToast(`Payment Verified! Order #${confirmedOrderId} Placed Successfully.`, "success");
        setTimeout(() => {
          window.location.href = `orders.html?orderId=${encodeURIComponent(confirmedOrderId)}&payment=success`;
        }, 1200);
      },
      onClose: ({ wasPaid }) => {
        if (!wasPaid) {
          showToast("Payment was not completed. Your order has not been placed.", "warning");
        }
      },
    });
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

// Extract product materials helper
function extractProductMaterials(data) {
  if (!data) return [];
  let mats = [];
  if (Array.isArray(data.materials) && data.materials.length > 0) {
    mats = data.materials.map((m) => String(m).trim()).filter(Boolean);
  } else if (typeof data.material === "string" && data.material.trim()) {
    mats = data.material.split(/[\n,]+/).map((m) => m.trim()).filter(Boolean);
  }
  return mats;
}

function render3DMaterialsListHTML(materials) {
  const checkSvg = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const items = Array.isArray(materials) && materials.length > 0
    ? materials
    : [
        "Pure Goodlumber Wood Frame (Kiln-Dried)",
        "Pure 4-Inch High-Density Uratex Foam",
        "Anti-Anay at Bukbok Treated",
        "Plush Heavy-Duty Premium Fabric"
      ];

  return items.map((m) => `
    <div class="pdp-check-item" style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.84rem; color: #334155; line-height: 1.4;">
      <span class="pdp-check-icon" style="width: 18px; height: 18px; min-width: 18px; border-radius: 50%; background: #dcfce7; color: #15803d; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;">
        ${checkSvg}
      </span>
      <span style="font-weight: 500;">${escapeHtml(m)}</span>
    </div>
  `).join("");
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

      let initialMaterials = [];
      const matAttr = newBtn.getAttribute("data-materials");
      if (matAttr) {
        try { initialMaterials = JSON.parse(matAttr); } catch (_) {}
      }

      await show3DModelViewer(productName, productImage, productId, newBtn, originalText, initialMaterials);
    });
  });
}

// Show 3D Model Viewer Modal with Admin Parity (Progress & Meshy Polling)
async function show3DModelViewer(productName, productImage, productId, button, originalButtonText, initialMaterials = []) {
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
              alt="${escapeHtml(productName)} 3D Model">
            </model-viewer>
          </div>
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${escapeHtml(productName)}</h4>
            <p id="pv-3d-desc">Experience this furniture piece in 3D. Rotate to view from different angles and zoom to inspect details.</p>

            <div class="model-viewer-materials-section" style="margin-top: 18px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                <span style="width: 24px; height: 24px; border-radius: 6px; background: #fef3c7; color: #b45309; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2l9 4.9V17L12 22l-9-4.9V7z"/>
                    <path d="M12 12L3 7"/>
                    <path d="M12 12l9-5"/>
                    <path d="M12 12v10"/>
                  </svg>
                </span>
                <h5 style="margin: 0; font-size: 0.88rem; font-weight: 700; color: #1e293b; letter-spacing: 0.02em; text-transform: uppercase;">Materials &amp; Quality</h5>
              </div>
              <div id="pv-3d-materials-list" style="display: flex; flex-direction: column; gap: 8px;">
                ${render3DMaterialsListHTML(initialMaterials)}
              </div>
            </div>
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
    const fetchedMaterials = extractProductMaterials(pData);
    if (fetchedMaterials.length > 0) {
      const matListEl = modalOverlay.querySelector("#pv-3d-materials-list");
      if (matListEl) {
        matListEl.innerHTML = render3DMaterialsListHTML(fetchedMaterials);
      }
    }
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
        if (!chatScreen?.classList.contains("active")) {
          showScreen("menu");
        } else {
          if (unreadBadge) unreadBadge.style.display = "none";
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
      if (unreadBadge) unreadBadge.style.display = "none";
      const menuBadge = openLiveChatBtn.querySelector(".method-unread-badge");
      if (menuBadge) menuBadge.style.display = "none";
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
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Live Support
      </button>
    `;

    userOrdersList.forEach((o) => {
      const oId = o.id;
      const orderNum = o.orderId || o.id;
      const isSel = currentChannel === "order" && activeChatOrderId === oId;
      barHtml += `
        <button type="button" class="chat-channel-pill ${isSel ? "active" : ""}" data-channel="order" data-order-id="${oId}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-2px; margin-right:4px;"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>#${orderNum}
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

    let displayText = rawText;
    if (mediaUrl && (displayText === mediaUrl || isImageTarget)) {
      displayText = "";
    }

    return { mediaUrl, displayText };
  }

  let activeCustomerReplyingMessage = null;
  let currentCustomerLoadedMessages = [];

  function setCustomerReplyingMessage(msg) {
    activeCustomerReplyingMessage = msg;
    let previewEl = document.getElementById("customer-chat-reply-preview");
    if (!previewEl && form) {
      previewEl = document.createElement("div");
      previewEl.id = "customer-chat-reply-preview";
      previewEl.className = "customer-chat-reply-preview";
      previewEl.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #f8fafc; border-top: 1px solid #e2e8f0; border-left: 3px solid #6b4423; font-size: 0.78rem;";
      form.parentNode.insertBefore(previewEl, form);
    }
    if (!previewEl) return;
    if (!msg) {
      previewEl.style.display = "none";
      return;
    }
    const sender = msg.senderName || (msg.senderRole === "admin" || msg.senderRole === "staff" ? "Lanica Support" : "You");
    const snippet = msg.text || msg.content || (msg.attachmentUrl ? "[Photo]" : "");
    previewEl.innerHTML = `
      <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #6b4423;">Replying to ${escapeHtml(sender)}:</strong>
        <span style="font-style: italic; color: #64748b; margin-left: 4px;">${escapeHtml(snippet)}</span>
      </div>
      <button type="button" style="background: none; border: none; cursor: pointer; color: #94a3b8; font-weight: bold; font-size: 0.85rem;" title="Cancel reply">✕</button>
    `;
    previewEl.style.display = "flex";
    previewEl.querySelector("button").onclick = () => setCustomerReplyingMessage(null);
    if (textInput) textInput.focus();
  }

  function renderCustomerChatAvatarHtml(isSystem, isMe, senderLabel, photoURL, currentUser) {
    if (isSystem) {
      return `<div class="chat-msg-avatar chat-msg-avatar-system" style="width: 32px; height: 32px; border-radius: 50%; background: #fef3c7; color: #b45309; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 700; flex-shrink: 0; border: 1.5px solid #fde68a;" title="Lanica System Notification">🤖</div>`;
    }

    if (isMe) {
      const userPhoto = currentUser?.photoURL || photoURL || "";
      const name = currentUser?.displayName || currentUser?.name || "You";
      const nameParts = name.trim().split(/\s+/);
      const initials = nameParts.length > 1
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : (name.slice(0, 2)).toUpperCase() || "ME";

      if (userPhoto && (userPhoto.startsWith("http://") || userPhoto.startsWith("https://") || userPhoto.startsWith("data:"))) {
        return `
          <div class="chat-msg-avatar chat-msg-avatar-customer" style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #fef08a; border: 1.5px solid #fcd535; position: relative; display: flex; align-items: center; justify-content: center;" title="You">
            <img src="${escapeHtml(userPhoto)}" alt="You" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <span style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: #854d0e; user-select: none;">${escapeHtml(initials)}</span>
          </div>
        `;
      }

      return `
        <div class="chat-msg-avatar chat-msg-avatar-customer" style="width: 32px; height: 32px; border-radius: 50%; background: #fef08a; border: 1.5px solid #fcd535; display: flex; align-items: center; justify-content: center; flex-shrink: 0;" title="You">
          <span style="font-size: 0.72rem; font-weight: 700; color: #854d0e; user-select: none;">${escapeHtml(initials)}</span>
        </div>
      `;
    }

    // Staff / Workshop / Support avatar
    const staffPhoto = photoURL || "assets/lanicalogo.jpg";
    return `
      <div class="chat-msg-avatar chat-msg-avatar-staff" style="width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: #6b4423; border: 1.5px solid #d97706; display: flex; align-items: center; justify-content: center;" title="${escapeHtml(senderLabel)}">
        <img src="${escapeHtml(staffPhoto)}" alt="${escapeHtml(senderLabel)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.src='assets/logo.png';" />
      </div>
    `;
  }

  function renderMessagesList(messages, channelType, orderNum = "") {
    if (!messagesArea) return;
    currentCustomerLoadedMessages = messages || [];

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
        const isSystem =
          Boolean(m.isSystem) ||
          m.senderRole === "system" ||
          m.senderRole === "bot" ||
          m.sender === "system" ||
          m.senderId === "system" ||
          (typeof m.senderName === "string" && (m.senderName.toLowerCase().includes("system") || m.senderName.toLowerCase().includes("bot")));

        const isMe = !isSystem && currentUser && m.senderId === currentUser.uid;
        const roleClass = isSystem ? "system" : isMe ? "customer" : (m.senderRole || "staff");
        const senderLabel = isSystem
          ? (m.senderName || "Lanica System")
          : isMe
            ? "You"
            : (m.senderName || (channelType === "support" ? "Lanica Support" : "Workshop Support"));

        const timeDate = m.timestamp?.toDate
          ? m.timestamp.toDate()
          : (m.createdAt?.toDate ? m.createdAt.toDate() : (m.timestamp || m.createdAt ? new Date(m.timestamp || m.createdAt) : null));
        const timeStr = timeDate ? timeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

        const avatarCol = renderCustomerChatAvatarHtml(isSystem, isMe, senderLabel, m.photoURL || m.senderPhoto || m.senderPhotoURL, currentUser);

        if (m.isUnsent) {
          html += `
            <div class="chat-msg-row ${roleClass}">
              ${avatarCol}
              <div class="chat-msg-content-wrap">
                <span class="chat-msg-sender">${escapeHtml(senderLabel)} ${timeStr ? `• ${timeStr}` : ""}</span>
                <div class="chat-bubble-unsent">
                  ${isMe ? "You unsent a message" : `${escapeHtml(senderLabel)} unsent a message`}
                </div>
              </div>
            </div>
          `;
          return;
        }

        const { mediaUrl, displayText } = parseChatMessageContent(m);

        const quotedHtml = m.replyTo && m.replyTo.text
          ? `
            <div class="chat-quoted-box">
              <span class="chat-quoted-box-sender">Replying to ${escapeHtml(m.replyTo.senderName || "User")}</span>
              <span class="chat-quoted-box-text">${escapeHtml(m.replyTo.text)}</span>
            </div>
          `
          : "";

        html += `
          <div class="chat-msg-row ${roleClass}" data-msg-id="${m.id}">
            ${avatarCol}
            <div class="chat-msg-content-wrap">
              <span class="chat-msg-sender">${escapeHtml(senderLabel)} ${timeStr ? `• ${timeStr}` : ""}</span>
              <div class="chat-bubble-with-actions">
                <div class="chat-msg-bubble ${isSystem ? 'chat-bubble-system' : ''}">
                  ${quotedHtml}
                  ${displayText ? `<p style="margin: 0 0 ${mediaUrl ? '8px' : '0'} 0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(displayText)}</p>` : ""}
                  ${
                    mediaUrl
                      ? `<a href="${mediaUrl}" target="_blank" rel="noopener"><img src="${mediaUrl}" class="chat-msg-img" alt="Attachment" /></a>`
                      : ""
                  }
                </div>
                <div class="chat-msg-actions">
                  <button type="button" class="chat-msg-action-btn reply-btn" data-msg-id="${m.id}" title="Reply">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 9V5L3 12l7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                  </button>
                  ${
                    isMe
                      ? `<button type="button" class="chat-msg-action-btn unsend unsend-btn" data-msg-id="${m.id}" title="More options / Unsend"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    messagesArea.innerHTML = html;

    messagesArea.onclick = async (e) => {
      const replyBtn = e.target.closest(".reply-btn");
      if (replyBtn) {
        const msgId = replyBtn.getAttribute("data-msg-id");
        const msg = currentCustomerLoadedMessages.find((x) => x.id === msgId);
        if (msg) setCustomerReplyingMessage(msg);
        return;
      }
      const unsendBtn = e.target.closest(".unsend-btn");
      if (unsendBtn) {
        const msgId = unsendBtn.getAttribute("data-msg-id");
        const res = await showMessengerUnsendModal({ canUnsendForEveryone: true });
        if (!res) return;
        try {
          const target = channelType === "support" ? currentUser.uid : activeChatOrderId;
          await unsendChatMessage({
            targetId: target,
            messageId: msgId,
            isUserSupport: channelType === "support",
            unsendFor: res.unsendFor,
            currentUserId: currentUser ? currentUser.uid : null,
          });
          showToast(res.unsendFor === "everyone" ? "You unsent a message." : "Message removed for you.", "info");
        } catch (err) {
          console.error("Unsend error:", err);
          showToast(err.message || "Failed to unsend message.", "error");
        }
      }
    };

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

  let customerDisplayName = "";
  async function initUserChat(user) {
    if (!user) return;
    try {
      customerDisplayName = user.displayName || "";
      try {
        const uSnap = await getDoc(doc(db, "users", user.uid));
        if (uSnap.exists()) {
          const ud = uSnap.data();
          customerDisplayName =
            ud.displayName ||
            ud.name ||
            ud.fullName ||
            (ud.firstName ? `${ud.firstName} ${ud.lastName || ""}`.trim() : "") ||
            customerDisplayName;
        }
      } catch (_) {}

      userOrdersList = await getCustomerOrders(user.uid);
      renderChannelBar();

      // Listen in background for unread support messages
      if (supportUnreadUnsubscribe) supportUnreadUnsubscribe();
      supportUnreadUnsubscribe = subscribeToUserSupportMessages(user.uid, (messages) => {
        const unreadCount = messages.filter((m) => {
          const isFromStaff =
            m.senderRole === "admin" || m.senderRole === "staff" || m.senderId === "support_admin";
          return isFromStaff && m.isRead !== true && m.read !== true;
        }).length;

        const isChatOpen = drawer?.classList.contains("active") && chatScreen?.classList.contains("active");
        if (unreadBadge) {
          if (unreadCount > 0 && !isChatOpen) {
            unreadBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
            unreadBadge.style.display = "block";
          } else if (isChatOpen) {
            unreadBadge.style.display = "none";
          }
        }

        if (openLiveChatBtn) {
          let menuBadge = openLiveChatBtn.querySelector(".method-unread-badge");
          if (unreadCount > 0 && !isChatOpen) {
            if (!menuBadge) {
              menuBadge = document.createElement("span");
              menuBadge.className = "method-unread-badge";
              menuBadge.style.cssText = "margin-left: auto; margin-right: 8px; background: #ef4444; color: #fff; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; line-height: 1.2; box-shadow: 0 1px 3px rgba(239,68,68,0.4);";
              const chevron = openLiveChatBtn.querySelector(".method-chevron");
              if (chevron) openLiveChatBtn.insertBefore(menuBadge, chevron);
              else openLiveChatBtn.appendChild(menuBadge);
            }
            menuBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
            menuBadge.style.display = "inline-block";
          } else if (menuBadge) {
            menuBadge.style.display = "none";
          }
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

        const replyPayload = activeCustomerReplyingMessage
          ? {
              id: activeCustomerReplyingMessage.id,
              senderName:
                activeCustomerReplyingMessage.senderName ||
                (activeCustomerReplyingMessage.senderRole === "admin" || activeCustomerReplyingMessage.senderRole === "staff"
                  ? "Lanica Support"
                  : "You"),
              text: activeCustomerReplyingMessage.text || activeCustomerReplyingMessage.content || "[Photo]",
            }
          : null;

        const senderNameVal =
          customerDisplayName ||
          currentUser.displayName ||
          (currentUser.email ? currentUser.email.split("@")[0] : "Customer");

        if (currentChannel === "support") {
          await sendChatMessage({
            userId: currentUser.uid,
            sessionType: "support",
            isUserSupport: true,
            senderId: currentUser.uid,
            senderName: senderNameVal,
            senderRole: "customer",
            receiverId: "support_admin",
            text: text,
            attachmentUrl: attachmentUrl,
            replyTo: replyPayload,
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
            senderName: senderNameVal,
            senderRole: "customer",
            receiverId: "staff",
            text: text,
            attachmentUrl: attachmentUrl,
            replyTo: replyPayload,
          });
        }

        if (textInput) textInput.value = "";
        setCustomerReplyingMessage(null);
        scrollChatToBottom();
      } catch (err) {
        console.error("Chat error:", err);
        showToast(err.message || "Failed to send message.", "error");
      }
    });
  }

  return { initUserChat, openOrderChat, openSupportChat };
}
