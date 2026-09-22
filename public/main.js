import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { LanicaWebAR } from "./arCore.js";


const firebaseConfig = {
  apiKey: "AIzaSyAb2kDAVp9N_afxgOw5hSzDIvQ3UAIZVNU",
  authDomain: "jobsync-745a6.firebaseapp.com",
  projectId: "jobsync-745a6",
  storageBucket: "jobsync-745a6.firebasestorage.app",
  messagingSenderId: "845585113791",
  appId: "1:845585113791:web:921482be545bb9604ddc0a",
  measurementId: "G-LQ41PCS4HD",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Navbar Scroll Effect
  const navbar = document.querySelector(".navbar");

  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      navbar.classList.add("scrolled");
    } else {
      navbar.classList.remove("scrolled");
    }
  });

  // 2. Load Products from Firebase
  const productsGrid = document.querySelector(".products-grid");
  if (productsGrid) {
    try {
      const querySnapshot = await getDocs(collection(db, "products"));

      // Only overwrite if we have products in the DB, otherwise keep static mockups
      if (!querySnapshot.empty) {
        productsGrid.innerHTML = ""; // Clear static defaults

        let delay = 0.1;
        querySnapshot.forEach((doc) => {
          const product = doc.data();

          // Prefer thumbnail-style images first, then legacy fields.
          const displayImage =
            product.thumbnail ||
            (product.images && (product.images.isoImage || product.images.frontBg)) ||
            product.image ||
            "assets/product_sofa.png";

          // Only display if in stock
          // if (product.stock > 0) {
          const productHTML = `
                            <div class="product-card reveal" style="--delay: ${delay}s">
                                <div class="product-image-container">
                                    <img src="${displayImage}" alt="${product.name}" class="product-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
                                    <button class="btn-ar-view" data-product-id="${doc.id}">
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                                        View Model
                                    </button>
                                </div>
                                <div class="product-info">
                                    <h3>${product.name}</h3>
                                    <p class="price">₱${parseFloat(product.price).toLocaleString()}</p>
                                </div>
                            </div>
                        `;
          productsGrid.insertAdjacentHTML("beforeend", productHTML);
          delay += 0.1;
          // }
        });
        // Re-bind AR Buttons to new DOM elements
        bindARButtons();
      } else {
        productsGrid.innerHTML = `
          <div class="empty-state-container" style="grid-column: 1 / -1;">
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
      if (productsGrid) {
        productsGrid.innerHTML = `
          <div class="empty-state-container" style="grid-column: 1 / -1;">
            <h3 class="empty-state-title">Unable to Load Catalog</h3>
            <p class="empty-state-subtitle">There was an issue fetching products. Please check your connection and try again.</p>
          </div>
        `;
      }
    }
  }

  // Initialize regular animations
  initAnimations();

  // 4. Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const targetId = this.getAttribute("href");
      if (targetId === "#download") {
        const target = document.querySelector(targetId);
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (targetId !== "#") {
        const target = document.querySelector(targetId);
        if (target) {
          target.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  });

  // 5. Hidden Admin Trigger (Triple click Logo)
  const logoArea = document.querySelector(".logo");
  if (logoArea) {
    // Make the hidden trigger more reliable by allowing a short overall window
    // rather than requiring each click to land within 500ms of the previous one.
    const clickWindowMs = 1100;
    let clickTimes = [];
    let redirecting = false;

    logoArea.addEventListener("pointerdown", (e) => {
      // Ignore non-left mouse clicks.
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
});

function initAnimations() {
  const observerOptions = {
    root: null,
    rootMargin: "0px",
    threshold: 0.15,
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  const animatedElements = document.querySelectorAll(".slide-up, .reveal");
  animatedElements.forEach((el) => observer.observe(el));

  setTimeout(() => {
    const heroElements = document.querySelectorAll(".hero .slide-up, .hero .reveal");
    heroElements.forEach((el) => el.classList.add("active"));
  }, 100);

  // Bind initial AR buttons
  bindARButtons();
}

function bindARButtons() {
  const arButtons = document.querySelectorAll(".btn-ar-view");

  // Remove old listeners to prevent duplicates if called multiple times
  arButtons.forEach((btn) => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    newBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const originalText = newBtn.innerHTML;
      newBtn.innerHTML = `<div class="dot active"></div> Loading 3D Model...`;

      // Get product information from the card
      const productCard = newBtn.closest(".product-card");
      const productName = productCard.querySelector("h3")?.textContent || "Product";
      const productImage = productCard.querySelector(".product-img")?.src || "";
      const productId = newBtn.getAttribute("data-product-id");

      // Create and show 3D model viewer modal
      await show3DModelViewer(productName, productImage, productId, newBtn, originalText);
    });
  });
}

// Show High-End Custom Web AR Experience via LanicaWebAR module
async function show3DModelViewer(productName, productImage, productId, button, originalButtonText) {
  let catalogList = [];
  let currentProduct = {
    id: productId || "prod_" + Date.now(),
    name: productName,
    image: productImage,
    price: 499,
  };

  try {
    // Fetch product details from Firestore
    if (productId) {
      const productDoc = await getDoc(doc(db, "products", productId));
      if (productDoc.exists()) {
        const pData = productDoc.data();
        currentProduct = {
          id: productDoc.id,
          name: pData.name || productName,
          image: pData.imageUrl || pData.image || productImage,
          price: pData.price || 499,
          modelUrl: pData.modelUrl || pData.glbUrl || pData.model_url || pData.arModelUrl || pData.usdzUrl,
        };
      }
    }

    // Fetch catalog products to populate AR room bottom carousel
    try {
      const catalogSnap = await getDocs(collection(db, "products"));
      catalogSnap.forEach((docSnap) => {
        const d = docSnap.data();
        catalogList.push({
          id: docSnap.id,
          name: d.name || "Furniture",
          image: d.imageUrl || d.image || "assets/product_sofa.png",
          price: d.price || 499,
          modelUrl: d.modelUrl || d.glbUrl || d.model_url || d.arModelUrl || d.usdzUrl,
        });
      });
    } catch (e) {
      console.warn("Could not load full catalog for AR carousel, using active product:", e);
      catalogList = [currentProduct];
    }

    // Pre-flight HTTP HEAD check on active product asset URL
    if (currentProduct.modelUrl) {
      const isValid = await LanicaWebAR.validateModelAsset(currentProduct.modelUrl);
      if (!isValid) {
        console.warn("Asset validation warning: model URL returned non-200 HEAD status:", currentProduct.modelUrl);
      }
    }

    // Launch Web AR Module
    const webAr = new LanicaWebAR({
      product: currentProduct,
      catalog: catalogList,
      onClose: () => {
        if (button) button.innerHTML = originalButtonText;
      },
    });

    await webAr.start();
  } catch (err) {
    console.error("Error opening Web AR experience:", err);
    if (button) button.innerHTML = originalButtonText;
  }
}

