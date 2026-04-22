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
      newBtn.innerHTML = `<div class="dot active"></div> Opening App...`;

      setTimeout(() => {
        alert(
          "This would typically launch the Lanica AR application or prompt a download if not installed."
        );
        newBtn.innerHTML = originalText;
      }, 1000);
    });
  });
}
