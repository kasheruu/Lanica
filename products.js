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
} from "./cartService.js";

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
let liveChatController = null;

let allProductsList = [];
let activeCategory = "all";
let searchQuery = "";
let currentSort = "default";

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
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

// Standalone Fallback Catalog when Firestore returns empty or errors
function getFallbackProductsList() {
  return [
    {
      id: "prod-aura-cloud-sofa",
      name: "Aura Cloud Sofa",
      category: "sofa",
      price: 1299,
      description: "Sink-in comfort with high-resilience memory foam & stain-resistant boucle linen upholstery.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 12,
      LeatherStocks: 5,
    },
    {
      id: "prod-lumina-accent-chair",
      name: "Lumina Accent Chair",
      category: "chair",
      price: 549,
      description: "Ergonomic curved silhouette with solid mahogany wood base & Italian leather cushion.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 8,
      LeatherStocks: 4,
    },
    {
      id: "prod-minimalist-oak-table",
      name: "Minimalist Oak Coffee Table",
      category: "table",
      price: 899,
      description: "Sustainably sourced white oak table with soft rounded edges & water-resistant matte finish.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 15,
      LeatherStocks: 10,
    },
    {
      id: "prod-velvet-swivel-armchair",
      name: "Velvet Swivel Armchair",
      category: "chair",
      price: 699,
      description: "360-degree silent brass swivel base wrapped in plush jewel-toned velvet fabric.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 6,
      LeatherStocks: 2,
    },
    {
      id: "prod-golden-arch-floor-lamp",
      name: "Golden Arch Floor Lamp",
      category: "lamp",
      price: 299,
      description: "Brushed brass arching arm with heavy marble base & warm ambient LED bulb included.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 20,
      LeatherStocks: 20,
    },
    {
      id: "prod-modular-sectional-sofa",
      name: "Modular Sectional Sofa",
      category: "sofa",
      price: 1899,
      description: "Customizable 4-piece sectional arrangement with deep seats & removable machine-washable covers.",
      image: "assets/product_sofa.png",
      thumbnail: "assets/product_sofa.png",
      FabricStocks: 4,
      LeatherStocks: 2,
    },
  ];
}

function getProductsContainer() {
  return (
    document.getElementById("products-catalog-container") ||
    document.getElementById("products-grid") ||
    document.getElementById("product-list") ||
    document.querySelector(".products-catalog-grid") ||
    document.querySelector(".products-grid")
  );
}

async function initProductsApp() {
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
  } catch (err) {
    console.error("Failed to initialize auth:", err);
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      setupCartSubscription(user.uid);
      updateAuthUi(user);
      liveChatController?.initUserChat(user);
    }
  });

  // 3. Load & Setup Catalog Filtering
  await fetchProductsList();
  setupCatalogFilters();

  // 4. Setup Storefront Event Listeners & Modals
  setupStorefrontUI();

  // 5. Initialize Animations & Reveal Triggers
  initAnimations();
}

// Animations & Reveal Triggers Helper
function initAnimations() {
  const observerOptions = {
    root: null,
    rootMargin: "0px",
    threshold: 0.05,
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        obs.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll(".slide-up, .reveal").forEach((el) => {
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom >= 0) {
      el.classList.add("active");
    }
  });

  // Fallback to guarantee visibility even if IntersectionObserver is delayed
  setTimeout(() => {
    document.querySelectorAll(".slide-up, .reveal").forEach((el) => {
      el.classList.add("active");
    });
  }, 100);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProductsApp);
} else {
  initProductsApp();
}

// Auth Guard Interceptor
function isRealUserLoggedIn() {
  return currentUser && !currentUser.isAnonymous;
}

function requireAuth(actionCallback) {
  if (isRealUserLoggedIn()) {
    actionCallback();
  } else {
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

// Fetch products from Firestore with Fallback Catalog
async function fetchProductsList() {
  const container = getProductsContainer();
  if (!container) return;

  try {
    const querySnapshot = await getDocs(collection(db, "products"));
    allProductsList = [];

    if (querySnapshot && !querySnapshot.empty) {
      querySnapshot.forEach((docSnap) => {
        allProductsList.push({ id: docSnap.id, ...docSnap.data() });
      });
    }

    // Fallback if Firestore query returns empty set
    if (allProductsList.length === 0) {
      allProductsList = getFallbackProductsList();
    }

    renderFilteredProducts();
  } catch (error) {
    console.warn("Firestore fetch error, falling back to local product catalogue:", error);
    allProductsList = getFallbackProductsList();
    renderFilteredProducts();
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

// Filter and Sort Products
function renderFilteredProducts() {
  const container = getProductsContainer();
  if (!container) return;

  let filtered = allProductsList.filter((product) => {
    const nameStr = (product.name || "").toLowerCase();
    const descStr = (product.description || "").toLowerCase();
    const matchesSearch = !searchQuery || nameStr.includes(searchQuery) || descStr.includes(searchQuery);

    let matchesCat = true;
    if (activeCategory !== "all") {
      const catStr = (product.category || "").toLowerCase();
      matchesCat = catStr.includes(activeCategory) || nameStr.includes(activeCategory);
    }

    return matchesSearch && matchesCat;
  });

  // Sorting logic
  if (currentSort === "price-low") {
    filtered.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  } else if (currentSort === "price-high") {
    filtered.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
  } else if (currentSort === "name-asc") {
    filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-container" style="grid-column: 1 / -1; width: 100%; text-align: center; padding: 40px 20px;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <h3 class="empty-state-title" style="margin-top: 12px; font-size: 1.2rem;">No Products Found</h3>
        <p class="empty-state-subtitle" style="color: #6b7280; font-size: 0.9rem;">Try adjusting your search query or category filters.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";
  let delay = 0.05;

  filtered.forEach((product) => {
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
                <img src="${src}" alt="${escapeHtml(product.name)} - View ${i + 1}" class="product-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
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
          <button class="btn-ar-view" data-product-id="${product.id}" title="View in 3D">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>3D</span>
          </button>
          <button class="btn-quick-order" data-product-id="${product.id}">
            Order Now
          </button>
        </div>
      `
      : `
        <div class="product-image-container">
          <img src="${thumbnails[0]}" alt="${escapeHtml(product.name)}" class="product-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <button class="btn-ar-view" data-product-id="${product.id}" title="View in 3D">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>3D</span>
          </button>
          <button class="btn-quick-order" data-product-id="${product.id}">
            Order Now
          </button>
        </div>
      `;

    const productHTML = `
      <div class="product-card reveal" style="--delay: ${delay}s">
        ${imageSectionHTML}
        <div class="product-info">
          <h3>${escapeHtml(product.name)}</h3>
          <p class="price">₱${priceFormatted}</p>
        </div>
      </div>
    `;

    container.insertAdjacentHTML("beforeend", productHTML);
    delay += 0.05;
  });

  bindProductCardButtons();
  initCardSlideshows(container);
  initAnimations();
}

// Bind search, category pills & sort dropdown
function setupCatalogFilters() {
  const searchInput = document.getElementById("catalog-search-input");
  const sortSelect = document.getElementById("catalog-sort-select");
  const categoryButtons = document.querySelectorAll(".category-pill");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderFilteredProducts();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      currentSort = e.target.value;
      renderFilteredProducts();
    });
  }

  categoryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      categoryButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCategory = btn.getAttribute("data-category") || "all";
      renderFilteredProducts();
    });
  });
}

// Bind product card AR and Quick Order buttons
function bindProductCardButtons() {
  bindARButtons();

  document.querySelectorAll(".btn-quick-order").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const productId = btn.getAttribute("data-product-id");
      if (productId) {
        await openProductQuickViewModal(productId);
      }
    });
  });
}

// Open Product Quick View Modal
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
    } catch (fetchErr) {
      console.warn("Could not fetch product from Firestore, checking catalog list:", fetchErr);
    }

    if (!productData && Array.isArray(allProductsList)) {
      productData = allProductsList.find((p) => String(p.id) === String(productId));
    }

    if (!productData) {
      showToast("Product not found.", "error");
      return;
    }

    currentModalProduct = productData;
    currentSelectedQty = 1;

    const modalThumbs = getProductThumbnails(currentModalProduct);
    document.getElementById("pv-name").textContent = currentModalProduct.name || "Product";
    document.getElementById("pv-image").src = modalThumbs[0] || "assets/product_sofa.png";
    document.getElementById("pv-price").textContent = `₱${parseFloat(currentModalProduct.price || 0).toLocaleString()}`;

    // Dimensions display
    const dimsEl = document.getElementById("pv-dimensions-info");
    if (dimsEl) {
      let dimsText = "";
      if (currentModalProduct.dimensions && typeof currentModalProduct.dimensions.height === "number") {
        dimsText = currentModalProduct.dimensions.length
          ? `${currentModalProduct.dimensions.length} × ${currentModalProduct.dimensions.width} × ${currentModalProduct.dimensions.height} ${currentModalProduct.dimensions.unit || "in"}`
          : `${currentModalProduct.dimensions.width} × ${currentModalProduct.dimensions.height} ${currentModalProduct.dimensions.unit || "in"}`;
      } else if (currentModalProduct.size) {
        dimsText = currentModalProduct.size;
      }
      if (dimsText) {
        dimsEl.textContent = `📐 Dimensions: ${dimsText}`;
        dimsEl.style.display = "block";
      } else {
        dimsEl.style.display = "none";
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
            thumbStrip.querySelectorAll(".modal-thumb-btn").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const idx = parseInt(btn.dataset.index, 10);
            document.getElementById("pv-image").src = modalThumbs[idx];
          });
        });
      } else {
        thumbStrip.style.display = "none";
        thumbStrip.innerHTML = "";
      }
    }

    // Dynamic materials input / options
    const prodMaterials = Array.isArray(currentModalProduct.materials) && currentModalProduct.materials.length > 0
      ? currentModalProduct.materials
      : currentModalProduct.material
        ? currentModalProduct.material.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Standard"];

    currentSelectedMaterial = prodMaterials[0] || "Standard";

    const matOptionsContainer = document.getElementById("pv-material-options") || modal.querySelector(".material-options");
    if (matOptionsContainer) {
      matOptionsContainer.innerHTML = prodMaterials
        .map((mat) => {
          const matStock = getAvailableStock(currentModalProduct, mat);
          return `
            <button type="button" class="material-btn ${mat === currentSelectedMaterial ? "selected" : ""}" data-material="${escapeHtml(mat)}">
              <span class="mat-title">${escapeHtml(mat)}</span>
              <span class="mat-stock">${matStock} left</span>
            </button>
          `;
        })
        .join("");

      matOptionsContainer.querySelectorAll(".material-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          currentSelectedMaterial = btn.getAttribute("data-material");
          updateVariantStockUI();
        });
      });
    }

    updateVariantStockUI();
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
  const addBtn = document.getElementById("pv-add-to-cart-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");

  if (available > 0) {
    statusEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#059669; display:inline-block;"></span> Ready to Ship (${available} left in showroom)</span>`;
    statusEl.style.color = "#059669";
    addBtn.disabled = false;
    addBtn.textContent = "Add Ready Stock to Bag";

    if (currentSelectedQty < 1) currentSelectedQty = 1;
    if (currentSelectedQty > available) currentSelectedQty = available;
  } else {
    statusEl.innerHTML = `<span style="display:inline-flex; align-items:center; gap:5px;"><span style="width:7px; height:7px; border-radius:50%; background:#2563eb; display:inline-block;"></span> Made-to-Order (Lead Time: 14–21 Days)</span>`;
    statusEl.style.color = "#2563eb";
    addBtn.disabled = false;
    addBtn.textContent = "Place Made-to-Order";

    if (currentSelectedQty < 1) currentSelectedQty = 1;
  }

  document.getElementById("pv-qty-val").textContent = currentSelectedQty;

  if (qtyMinus) qtyMinus.disabled = currentSelectedQty <= 1;
  if (qtyPlus) qtyPlus.disabled = available > 0 ? currentSelectedQty >= available : currentSelectedQty >= 10;
}

// Render Cart Drawer
function renderCartDrawer(items) {
  const container = document.getElementById("cart-items-container");
  const badge = document.getElementById("cart-badge");
  const subtotalEl = document.getElementById("cart-subtotal-display");
  const checkoutBtn = document.getElementById("proceed-checkout-btn");

  const totalItemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  if (badge) {
    badge.textContent = totalItemCount;
    badge.style.display = totalItemCount > 0 ? "flex" : "none";
  }

  let subtotal = 0;

  if (!items || items.length === 0) {
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

  container.innerHTML = "";

  items.forEach((item) => {
    const itemTotal = parsePrice(item.price) * Number(item.quantity);
    subtotal += itemTotal;

    const itemCard = document.createElement("div");
    itemCard.className = "cart-item-card";
    const isMTO = item.orderType === "Made-to-Order";
    itemCard.innerHTML = `
      <img src="${item.url}" alt="${escapeHtml(item.name)}" class="cart-item-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
      <div class="cart-item-details">
        <div class="cart-item-title">${escapeHtml(item.name)}</div>
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
          <span class="cart-item-material">${escapeHtml(item.material || "Fabric")}</span>
          ${
            isMTO
              ? '<span style="font-size: 0.72rem; color: #2563eb; background: #eff6ff; padding: 1px 6px; border-radius: 4px; font-weight: 500;">Made-to-Order (14-21d)</span>'
              : '<span style="font-size: 0.72rem; color: #059669; background: #ecfdf5; padding: 1px 6px; border-radius: 4px; font-weight: 500;">Ready Stock</span>'
          }
        </div>
        ${
          item.customNotes
            ? `<p style="font-size: 0.74rem; color: #64748b; margin: 3px 0 0 0; font-style: italic;">Custom: ${escapeHtml(item.customNotes)}</p>`
            : ""
        }
        <div class="cart-item-price" style="margin-top: 4px;">₱${itemTotal.toLocaleString()}</div>
        <div class="quantity-control" style="margin-top: 8px;">
          <button type="button" class="qty-btn cart-qty-minus" data-id="${item.id}">-</button>
          <span class="qty-value">${item.quantity}</span>
          <button type="button" class="qty-btn cart-qty-plus" data-id="${item.id}">+</button>
        </div>
      </div>
      <button class="cart-item-remove" data-id="${item.id}" aria-label="Remove item">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    container.appendChild(itemCard);
  });

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (checkoutBtn) checkoutBtn.disabled = false;

  container.querySelectorAll(".cart-qty-minus").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => i.id === id);
      if (item) {
        await updateCartItemQuantity(currentUser.uid, id, item.quantity - 1);
      }
    });
  });

  container.querySelectorAll(".cart-qty-plus").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const item = currentCartItems.find((i) => i.id === id);
      if (item) {
        try {
          await updateCartItemQuantity(currentUser.uid, id, item.quantity + 1);
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });
  });

  container.querySelectorAll(".cart-item-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await removeCartItem(currentUser.uid, id);
      showToast("Item removed from bag.");
    });
  });
}

function updateSubmitButtonText() {
  const grandTotal = currentCartItems.reduce(
    (sum, item) => sum + parsePrice(item.price) * Number(item.quantity),
    0
  );
  const downAmt = Math.round(grandTotal * 0.30);
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
          <img src="${item.url || 'assets/product_sofa.png'}" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover;" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
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

  const downAmt = Math.round(grandTotal * 0.30);
  const balAmt = grandTotal - downAmt;

  if (termFullAmt) termFullAmt.textContent = `₱${grandTotal.toLocaleString()}`;
  if (termDownAmt) termDownAmt.textContent = `₱${downAmt.toLocaleString()}`;

  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toLocaleString()}`;
  if (shippingEl) shippingEl.textContent = shippingFee === 0 ? "FREE" : `₱${shippingFee.toLocaleString()}`;
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
  if (!currentUser || currentCartItems.length === 0) return;

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
      container.innerHTML = `<p style="font-size: 0.85rem; color: var(--clr-text-muted);">No saved addresses yet. Please add one below.</p>`;
      document.getElementById("address-form").style.display = "block";
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

function setupStorefrontUI() {
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

  const pvModal = document.getElementById("product-detail-modal");
  const closePvBtn = document.getElementById("close-product-modal-btn");
  const qtyMinus = document.getElementById("pv-qty-minus");
  const qtyPlus = document.getElementById("pv-qty-plus");
  const addToCartBtn = document.getElementById("pv-add-to-cart-btn");

  if (closePvBtn && pvModal) {
    closePvBtn.addEventListener("click", () => pvModal.classList.remove("active"));
  }

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
        showToast(`Selected quantity exceeds available showroom stock (${maxStock}). Additional units will be Made-to-Order.`);
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

      requireAuth(async () => {
        try {
          await addToCart(
            currentUser.uid,
            currentModalProduct,
            currentSelectedMaterial,
            currentSelectedQty,
            customNotes
          );
          const available = getAvailableStock(currentModalProduct, currentSelectedMaterial);
          const modeLabel = available > 0 ? "Ready Stock" : "Made-to-Order";
          showToast(`Added ${currentSelectedQty} x ${currentModalProduct.name} (${currentSelectedMaterial} - ${modeLabel}) to bag!`);
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

  document.querySelectorAll('input[name="checkoutPaymentTerm"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      selectedPaymentTerm = e.target.value;
      document.querySelectorAll(".payment-term-card").forEach((c) => c.classList.remove("selected"));
      e.target.closest(".payment-term-card")?.classList.add("selected");
      updateCheckoutTotals();
    });
  });

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

  const placeOrderBtn = document.getElementById("place-order-submit-btn");
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener("click", handlePlaceOrderSubmit);
  }

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
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        showToast("Signed in with Google!");
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
        errEl.textContent = "";
        await signInWithEmailAndPassword(auth, email, pwd);
        showToast("Signed in successfully!");
        authModal.classList.remove("active");
      } catch (err) {
        errEl.textContent = err.message || "Failed to sign in.";
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("cust-reg-email").value;
      const pwd = document.getElementById("cust-reg-pwd").value;
      const errEl = document.getElementById("cust-reg-error");

      try {
        errEl.textContent = "";
        await createUserWithEmailAndPassword(auth, email, pwd);
        showToast("Account created successfully!");
        authModal.classList.remove("active");
      } catch (err) {
        errEl.textContent = err.message || "Failed to create account.";
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
    const nearestLandmarkVal = document.getElementById("checkout-nearest-landmark")?.value?.trim() || "";
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

    showToast(`Order Placed Successfully! (ID: ${result.orderId}). Redirecting to order tracking...`, "success");
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

// Show 3D Model Viewer Modal
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
              alt="${escapeHtml(productName)} 3D Model">
            </model-viewer>
          </div>
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${escapeHtml(productName)}</h4>
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
      descEl.textContent = "This product doesn't have an active 3D model yet. You are viewing a 2D preview.";
    }
    if (wrapperEl) {
      wrapperEl.innerHTML = `
        <div class="model-placeholder">
          <img src="${productImage}" alt="${escapeHtml(productName)}" class="model-image" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          <div class="no-3d-message">
            <p>${escapeHtml(message || "3D model not available")}</p>
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
      if (!triedDirectUrl && currentRawModelUrl && (currentRawModelUrl.startsWith("http://") || currentRawModelUrl.startsWith("https://"))) {
        triedDirectUrl = true;
        statusEl.style.visibility = "visible";
        statusEl.textContent = "Retrying direct 3D model stream...";
        modelViewerEl.src = currentRawModelUrl;
        return;
      }
      showFallback2D("Failed to load 3D model");
    });
  }

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
    const modelUrl = pData.modelUrl || pData.glbUrl || pData.model_url || pData.arModelUrl || pData.usdzUrl;
    currentRawModelUrl = modelUrl;

    if (modelUrl) {
      statusEl.textContent = "Loading 3D model...";
      modelViewerEl.src = getGlbViewerUrl(modelUrl);
      return;
    }

    const taskId = pData.meshyTaskId;
    if (!taskId) {
      showFallback2D("No 3D model available for this product yet.");
      return;
    }

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
          modelViewerEl.src = targetUrl;
          setTimeout(() => {
            if (modelViewerEl.loaded) hideLoading();
          }, 400);

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
  let currentChannel = "support";
  let activeChatOrderId = null;
  let userOrdersList = [];
  let supportUnreadUnsubscribe = null;
  let chatUnsubscribe = null;

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
      <button type="button" class="chat-channel-pill ${currentChannel === 'support' ? 'active' : ''}" data-channel="support">
        💬 Live Support
      </button>
    `;

    userOrdersList.forEach((o) => {
      const oId = o.id;
      const orderNum = o.orderId || o.id;
      const isSel = currentChannel === "order" && activeChatOrderId === oId;
      barHtml += `
        <button type="button" class="chat-channel-pill ${isSel ? 'active' : ''}" data-channel="order" data-order-id="${oId}">
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
        const roleClass = isMe ? "customer" : (m.senderRole || "staff");
        const senderLabel = isMe ? "You" : (m.senderName || (channelType === "support" ? "Lanica Support" : "Workshop Support"));

        const timeDate = m.timestamp?.toDate
          ? m.timestamp.toDate()
          : (m.createdAt?.toDate ? m.createdAt.toDate() : (m.timestamp || m.createdAt ? new Date(m.timestamp || m.createdAt) : null));
        const timeStr = timeDate ? timeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

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
              ${(m.text || m.message || m.content) ? `<p style="margin: 0;">${escapeHtml(m.text || m.message || m.content)}</p>` : ""}
              ${
                (m.attachmentUrl || m.imageUrl)
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
      const orderNum = matched ? (matched.orderId || matched.id) : orderId;
      const statusText = matched ? (matched.orderStatus || matched.status || "In Production") : "Active";

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

      if (supportUnreadUnsubscribe) supportUnreadUnsubscribe();
      supportUnreadUnsubscribe = subscribeToUserSupportMessages(user.uid, (messages) => {
        const hasUnread = messages.some((m) => {
          const isFromStaff = m.senderRole === "admin" || m.senderRole === "staff" || m.senderId === "support_admin";
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

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        document.getElementById("auth-modal")?.classList.add("active");
        return;
      }

      const text = textInput?.value?.trim() || "";
      if (!text && !attachedFile) return;

      try {
        let attachmentUrl = null;
        if (attachedFile) {
          attachmentUrl = await uploadChatAttachment(attachedFile, currentUser.uid);
          attachedFile = null;
          if (fileInput) fileInput.value = "";
          if (previewBox) previewBox.style.display = "none";
        }

        if (currentChannel === "support") {
          await sendChatMessage({
            userId: currentUser.uid,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || "Customer",
            senderRole: "customer",
            text: text,
            attachmentUrl: attachmentUrl,
            channel: "support",
          });
        } else if (activeChatOrderId) {
          await sendChatMessage({
            orderId: activeChatOrderId,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email || "Customer",
            senderRole: "customer",
            text: text,
            attachmentUrl: attachmentUrl,
            channel: "order",
          });
        }

        if (textInput) textInput.value = "";
        scrollChatToBottom();
      } catch (err) {
        console.error("Error sending chat message:", err);
        showToast(err.message || "Failed to send message.", "error");
      }
    });
  }

  return { initUserChat };
}
