import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

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
                                    <button class="btn-ar-view">
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                                        View in Room
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
      }
    } catch (error) {
      console.error("Error loading products:", error);
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

    newBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const originalText = newBtn.innerHTML;
      newBtn.innerHTML = `<div class="dot active"></div> Loading 3D Model...`;

      // Get product information from the card
      const productCard = newBtn.closest(".product-card");
      const productName = productCard.querySelector("h3")?.textContent || "Product";
      const productImage = productCard.querySelector(".product-img")?.src || "";

      // Create and show 3D model viewer modal
      show3DModelViewer(productName, productImage, newBtn, originalText);
    });
  });
}

function show3DModelViewer(productName, productImage, button, originalButtonText) {
  // Create modal overlay
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "model-viewer-overlay";
  modalOverlay.innerHTML = `
    <div class="model-viewer-modal">
      <div class="model-viewer-header">
        <h3>${productName} - 3D View</h3>
        <button class="close-viewer" aria-label="Close 3D viewer">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="model-viewer-content">
        <div class="model-viewer-canvas">
          <div class="model-placeholder">
            <img src="${productImage}" alt="${productName}" class="model-image">
            <div class="model-controls">
              <div class="control-info">
                <p><strong>View-Only Mode</strong></p>
                <p>Use mouse to rotate • Scroll to zoom</p>
              </div>
              <div class="control-buttons">
                <button class="control-btn" id="reset-view">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                    <path d="M3 3v5h5"></path>
                  </svg>
                  Reset View
                </button>
                <button class="control-btn" id="toggle-rotation">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                    <path d="M21 3v5h-5"></path>
                  </svg>
                  Auto Rotate
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="model-viewer-info">
          <div class="product-details">
            <h4>${productName}</h4>
            <p>Experience this furniture piece in 3D. Rotate to view from different angles and zoom to see details.</p>
            <div class="viewing-tips">
              <h5>Viewing Tips:</h5>
              <ul>
                <li>Click and drag to rotate the model</li>
                <li>Use scroll wheel to zoom in/out</li>
                <li>Double-click to reset view</li>
                <li>This is a view-only experience</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add modal to page
  document.body.appendChild(modalOverlay);

  // Add CSS for the modal
  if (!document.querySelector("#model-viewer-styles")) {
    const style = document.createElement("style");
    style.id = "model-viewer-styles";
    style.textContent = `
      .model-viewer-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        opacity: 0;
        animation: fadeIn 0.3s ease forwards;
      }

      @keyframes fadeIn {
        to { opacity: 1; }
      }

      .model-viewer-modal {
        background: var(--clr-white);
        border-radius: var(--border-radius-lg);
        width: 90%;
        max-width: 1200px;
        height: 80vh;
        max-height: 800px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }

      .model-viewer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 30px;
        border-bottom: 1px solid var(--clr-gray-light);
        background: var(--clr-gray-light);
      }

      .model-viewer-header h3 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--clr-text-main);
      }

      .close-viewer {
        background: none;
        border: none;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
        color: var(--clr-text-muted);
        transition: all var(--transition-fast);
      }

      .close-viewer:hover {
        background: var(--clr-gray-light);
        color: var(--clr-text-main);
      }

      .model-viewer-content {
        display: grid;
        grid-template-columns: 2fr 1fr;
        height: 100%;
        overflow: hidden;
      }

      .model-viewer-canvas {
        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
      }

      .model-placeholder {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .model-image {
        max-width: 80%;
        max-height: 80%;
        object-fit: contain;
        border-radius: var(--border-radius);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
        transition: transform 0.3s ease;
      }

      .model-image:hover {
        transform: scale(1.02);
      }

      .model-controls {
        position: absolute;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--clr-white);
        padding: 20px 30px;
        border-radius: var(--border-radius);
        box-shadow: var(--shadow-md);
        text-align: center;
      }

      .control-info p {
        margin: 0 0 10px 0;
        font-size: 0.9rem;
        color: var(--clr-text-muted);
      }

      .control-info p strong {
        color: var(--clr-yellow);
        font-weight: 600;
      }

      .control-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 15px;
      }

      .control-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: var(--clr-yellow);
        border: none;
        border-radius: 8px;
        color: var(--clr-text-main);
        font-weight: 500;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all var(--transition-fast);
      }

      .control-btn:hover {
        background: var(--clr-yellow-hover);
        transform: translateY(-2px);
      }

      .model-viewer-info {
        padding: 30px;
        background: var(--clr-white);
        overflow-y: auto;
      }

      .product-details h4 {
        margin: 0 0 15px 0;
        font-size: 1.3rem;
        color: var(--clr-text-main);
      }

      .product-details p {
        margin: 0 0 20px 0;
        color: var(--clr-text-muted);
        line-height: 1.6;
      }

      .viewing-tips h5 {
        margin: 0 0 10px 0;
        font-size: 1rem;
        color: var(--clr-text-main);
      }

      .viewing-tips ul {
        margin: 0;
        padding-left: 20px;
        color: var(--clr-text-muted);
        font-size: 0.9rem;
        line-height: 1.6;
      }

      .viewing-tips li {
        margin-bottom: 5px;
      }

      @media (max-width: 768px) {
        .model-viewer-modal {
          width: 95%;
          height: 90vh;
        }

        .model-viewer-content {
          grid-template-columns: 1fr;
        }

        .model-viewer-info {
          padding: 20px;
        }

        .model-controls {
          bottom: 20px;
          padding: 15px 20px;
        }

        .control-buttons {
          flex-direction: column;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Close modal functionality
  const closeModal = () => {
    modalOverlay.remove();
    button.innerHTML = originalButtonText;
  };

  // Close on overlay click
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  // Close on X button click
  modalOverlay.querySelector(".close-viewer").addEventListener("click", closeModal);

  // Close on Escape key
  const escapeHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escapeHandler);
    }
  };
  document.addEventListener("keydown", escapeHandler);

  // Add interactive controls
  let isRotating = false;
  let rotationAngle = 0;
  const modelImage = modalOverlay.querySelector(".model-image");
  const rotateBtn = modalOverlay.querySelector("#toggle-rotation");
  const resetBtn = modalOverlay.querySelector("#reset-view");

  // Reset view
  resetBtn.addEventListener("click", () => {
    modelImage.style.transform = "scale(1) rotate(0deg)";
    rotationAngle = 0;
  });

  // Auto-rotate toggle
  rotateBtn.addEventListener("click", () => {
    isRotating = !isRotating;
    rotateBtn.innerHTML = isRotating
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg> Stop Rotation'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg> Auto Rotate';

    if (isRotating) {
      const rotateAnimation = setInterval(() => {
        if (!isRotating) {
          clearInterval(rotateAnimation);
          return;
        }
        rotationAngle += 1;
        modelImage.style.transform = `scale(1) rotate(${rotationAngle}deg)`;
      }, 50);
    }
  });

  // Mouse drag rotation
  let isDragging = false;
  let startX = 0;
  let startRotation = 0;

  modelImage.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX;
    startRotation = rotationAngle;
    modelImage.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const deltaX = e.clientX - startX;
    rotationAngle = startRotation + deltaX;
    modelImage.style.transform = `scale(1) rotate(${rotationAngle}deg)`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    modelImage.style.cursor = "grab";
  });

  // Double-click to reset
  modelImage.addEventListener("dblclick", () => {
    modelImage.style.transform = "scale(1) rotate(0deg)";
    rotationAngle = 0;
  });

  // Scroll to zoom
  modelImage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const currentScale = parseFloat(
      modelImage.style.transform.match(/scale\(([\d.]+)\)/)?.[1] || 1
    );
    const newScale = Math.max(0.5, Math.min(2, currentScale - e.deltaY * 0.001));
    modelImage.style.transform = `scale(${newScale}) rotate(${rotationAngle}deg)`;
  });

  // Reset button state after modal loads
  setTimeout(() => {
    button.innerHTML = originalButtonText;
  }, 500);
}
