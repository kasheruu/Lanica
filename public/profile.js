/**
 * Lanica E-Commerce Profile & Account Hub Logic
 * Real-time Firestore sync, image upload for profile avatar, address CRUD, FAQs & Bug Reports
 */
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";

import { app, db, auth, storage } from "./firebaseConfig.js";
import { initAuthModalController } from "./authModalController.js";
import { fetchWishlist, updateCartItemQuantity, removeCartItem, renderCartDrawerComponent } from "./cartService.js";

let currentUser = null;
let addressesUnsubscribe = null;
let ordersUnsubscribe = null;
let pendingAvatarFile = null;

// Clean Single Toast Notification Helper
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  // Remove previous toasts to avoid stacking
  container.querySelectorAll(".toast").forEach((t) => t.remove());

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

// --------------------------------------------------------------------------
// 1. AUTH & PROFILE HEADER INITIALIZATION
// --------------------------------------------------------------------------
function initProfileApp() {
  initAuthModalController();
  setupFaqAccordions();
  setupSettingsAndPreferences();
  setupBugReportingModal();
  setupAddressModal();
  setupEditProfileModal();

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      renderProfileHeader(user);
      subscribeUserMetrics(user.uid);
      subscribeUserAddresses(user.uid);
    } else {
      showToast("Please sign in to view your profile", "warning");
      setTimeout(() => {
        window.location.href = "index.html?auth=required";
      }, 1000);
    }
  });
}

async function renderProfileHeader(user) {
  const nameEl = document.getElementById("profile-display-name");
  const emailEl = document.getElementById("profile-display-email");
  const avatarCircle = document.getElementById("profile-avatar-circle");

  let photoURL = user.photoURL;
  let displayName = user.displayName || user.email?.split("@")[0] || "Lanica User";

  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      if (data.displayName) displayName = data.displayName;
      if (data.photoURL) photoURL = data.photoURL;
    }
  } catch (e) {
    console.warn("Could not fetch user doc for profile header:", e);
  }

  if (nameEl) nameEl.textContent = displayName.toUpperCase();
  if (emailEl) emailEl.textContent = user.email || "";

  if (avatarCircle) {
    if (photoURL) {
      avatarCircle.innerHTML = `<img src="${escapeHtml(photoURL)}" alt="${escapeHtml(displayName)}" />`;
    } else {
      avatarCircle.textContent = displayName.charAt(0).toUpperCase();
    }
  }

  // Update verification badge in account security
  const verifyBadge = document.getElementById("security-email-verification-badge");
  if (verifyBadge) {
    if (user.emailVerified) {
      verifyBadge.textContent = "Verified";
      verifyBadge.style.background = "#d1fae5";
      verifyBadge.style.color = "#059669";
    } else {
      verifyBadge.textContent = "Unverified";
      verifyBadge.style.background = "#fef3c7";
      verifyBadge.style.color = "#d97706";
    }
  }
}

// --------------------------------------------------------------------------
// 2. METRIC OVERVIEW SNAPSHOTS
// --------------------------------------------------------------------------
function subscribeUserMetrics(uid) {
  if (ordersUnsubscribe) ordersUnsubscribe();

  const ordersRef = collection(db, "orders");
  const q = query(ordersRef, where("userId", "==", uid));

  ordersUnsubscribe = onSnapshot(q, (snapshot) => {
    let activeCount = 0;
    let completedCount = 0;
    let totalHistory = snapshot.size;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const status = (data.status || "").toLowerCase();
      if (status === "delivered" || status === "completed") {
        completedCount++;
      } else if (["pending", "confirmed", "processing", "manufacturing", "in_transit", "out_for_delivery"].includes(status)) {
        activeCount++;
      }
    });

    const activeEl = document.getElementById("metric-active-orders");
    const completedEl = document.getElementById("metric-completed-orders");
    const historyEl = document.getElementById("metric-history-count");

    if (activeEl) activeEl.textContent = String(activeCount).padStart(2, "0");
    if (completedEl) completedEl.textContent = String(completedCount).padStart(2, "0");
    if (historyEl) historyEl.textContent = String(totalHistory).padStart(2, "0");
  });

  fetchWishlist(uid).then((wl) => {
    const savedEl = document.getElementById("metric-saved-items");
    if (savedEl) savedEl.textContent = String(wl.length).padStart(2, "0");
  });
}

// --------------------------------------------------------------------------
// 3. SHIPPING ADDRESSES MANAGEMENT (Image 2 Parity)
// --------------------------------------------------------------------------
function subscribeUserAddresses(uid) {
  if (addressesUnsubscribe) addressesUnsubscribe();

  const addrsRef = collection(db, "users", uid, "addresses");
  addressesUnsubscribe = onSnapshot(addrsRef, (snapshot) => {
    const addresses = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAddressCards(addresses);
  }, (err) => {
    console.error("Addresses snapshot error:", err);
  });
}

function renderAddressCards(addresses) {
  const container = document.getElementById("shipping-addresses-list");
  if (!container) return;

  if (!addresses || addresses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; background: #ffffff; border-radius: 16px; border: 1px dashed #e5e7eb;">
        <p style="color: #6b7280; font-size: 0.95rem; margin-bottom: 12px;">No shipping addresses saved yet.</p>
        <button type="button" class="btn-add-address-header" onclick="document.getElementById('open-add-address-btn').click()">
          + Add New Address
        </button>
      </div>
    `;
    return;
  }

  // Sort default address first
  addresses.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));

  container.innerHTML = addresses
    .map((addr) => {
      const isDefault = !!addr.isDefault;
      const label = escapeHtml(addr.label || "HOME").toUpperCase();
      const recipientName = escapeHtml(addr.recipientName || currentUser?.displayName || "Valued Customer").toUpperCase();
      const phone = escapeHtml(addr.phoneNumber || "No phone provided");
      const street = escapeHtml(addr.streetAddress || addr.fullAddress || "");
      const city = escapeHtml(addr.city || "");
      const province = escapeHtml(addr.province || "");
      const zip = escapeHtml(addr.zipCode || "");

      const fullFormattedAddress = [street, city, province, zip].filter(Boolean).join(", ");

      return `
        <div class="shipping-address-card ${isDefault ? "is-default" : ""}" data-address-id="${addr.id}">
          <div class="address-card-top">
            <div class="address-badges-group">
              <span class="badge-label-home">${label}</span>
              ${isDefault ? `<span class="badge-label-default">DEFAULT</span>` : ""}
            </div>
            <div class="address-kebab-menu">
              <button type="button" class="btn-kebab-trigger" title="Options" aria-label="Address options">•••</button>
              <div class="kebab-dropdown-popover">
                ${!isDefault ? `<button type="button" class="set-default-opt" data-id="${addr.id}">★ Set as Default</button>` : ""}
                <button type="button" class="edit-address-opt" data-id="${addr.id}">✏ Edit Address</button>
                <button type="button" class="delete-address-opt delete-option" data-id="${addr.id}">🗑 Delete</button>
              </div>
            </div>
          </div>
          <div class="address-recipient-name">${recipientName}</div>
          <div class="address-phone-number">📞 ${phone}</div>
          <div class="address-full-text">📍 ${fullFormattedAddress}</div>
        </div>
      `;
    })
    .join("");

  // Kebab menu trigger logic
  container.querySelectorAll(".btn-kebab-trigger").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const popover = btn.nextElementSibling;
      container.querySelectorAll(".kebab-dropdown-popover").forEach((p) => {
        if (p !== popover) p.classList.remove("active");
      });
      if (popover) popover.classList.toggle("active");
    });
  });

  document.addEventListener("click", () => {
    container.querySelectorAll(".kebab-dropdown-popover").forEach((p) => p.classList.remove("active"));
  });

  // Action listeners
  container.querySelectorAll(".set-default-opt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const addressId = btn.getAttribute("data-id");
      if (addressId && currentUser) {
        await setDefaultAddress(currentUser.uid, addressId, addresses);
      }
    });
  });

  container.querySelectorAll(".edit-address-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const addressId = btn.getAttribute("data-id");
      const targetAddr = addresses.find((a) => a.id === addressId);
      if (targetAddr) openAddressModalForEdit(targetAddr);
    });
  });

  container.querySelectorAll(".delete-address-opt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const addressId = btn.getAttribute("data-id");
      if (addressId && currentUser) {
        if (confirm("Are you sure you want to delete this shipping address?")) {
          await deleteDoc(doc(db, "users", currentUser.uid, "addresses", addressId));
          showToast("Shipping address deleted", "info");
        }
      }
    });
  });
}

async function setDefaultAddress(uid, targetAddressId, allAddresses) {
  try {
    const batch = writeBatch(db);
    allAddresses.forEach((addr) => {
      const addrRef = doc(db, "users", uid, "addresses", addr.id);
      batch.update(addrRef, { isDefault: addr.id === targetAddressId });
    });
    await batch.commit();
    showToast("Default shipping address updated!", "success");
  } catch (err) {
    console.error("Error setting default address:", err);
    showToast("Failed to update default address", "error");
  }
}

function setupAddressModal() {
  const openBtn = document.getElementById("open-add-address-btn");
  const modal = document.getElementById("address-modal");
  const closeBtn = document.getElementById("close-address-modal-btn");
  const form = document.getElementById("address-form");

  if (openBtn && modal) {
    openBtn.addEventListener("click", () => {
      resetAddressForm();
      document.getElementById("address-modal-title").textContent = "Add New Shipping Address";
      modal.classList.add("active");
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => modal.classList.remove("active"));
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const id = document.getElementById("addr-id").value;
      const label = document.getElementById("addr-label").value || "HOME";
      const recipientName = document.getElementById("addr-recipient").value;
      const phoneNumber = document.getElementById("addr-phone").value;
      const streetAddress = document.getElementById("addr-street").value;
      const city = document.getElementById("addr-city").value;
      const province = document.getElementById("addr-province").value;
      const zipCode = document.getElementById("addr-zip").value;
      const isDefault = document.getElementById("addr-is-default").checked;

      const payload = {
        label: label.trim(),
        recipientName: recipientName.trim(),
        phoneNumber: phoneNumber.trim(),
        streetAddress: streetAddress.trim(),
        city: city.trim(),
        province: province.trim(),
        zipCode: zipCode.trim(),
        isDefault,
        createdAt: serverTimestamp(),
      };

      try {
        if (id) {
          await updateDoc(doc(db, "users", currentUser.uid, "addresses", id), payload);
          showToast("Address updated successfully!", "success");
        } else {
          const newDocRef = doc(collection(db, "users", currentUser.uid, "addresses"));
          await setDoc(newDocRef, payload);

          if (isDefault) {
            const snap = await getDocs(collection(db, "users", currentUser.uid, "addresses"));
            const batch = writeBatch(db);
            snap.forEach((dSnap) => {
              if (dSnap.id !== newDocRef.id) {
                batch.update(dSnap.ref, { isDefault: false });
              }
            });
            await batch.commit();
          }
          showToast("New address added successfully!", "success");
        }
        if (modal) modal.classList.remove("active");
      } catch (err) {
        console.error("Error saving address:", err);
        showToast("Failed to save address: " + err.message, "error");
      }
    });
  }
}

function resetAddressForm() {
  const form = document.getElementById("address-form");
  if (form) form.reset();
  document.getElementById("addr-id").value = "";
}

function openAddressModalForEdit(addr) {
  const modal = document.getElementById("address-modal");
  if (!modal) return;
  document.getElementById("address-modal-title").textContent = "Edit Shipping Address";
  document.getElementById("addr-id").value = addr.id || "";
  document.getElementById("addr-label").value = addr.label || "HOME";
  document.getElementById("addr-recipient").value = addr.recipientName || "";
  document.getElementById("addr-phone").value = addr.phoneNumber || "";
  document.getElementById("addr-street").value = addr.streetAddress || addr.fullAddress || "";
  document.getElementById("addr-city").value = addr.city || "";
  document.getElementById("addr-province").value = addr.province || "";
  document.getElementById("addr-zip").value = addr.zipCode || "";
  document.getElementById("addr-is-default").checked = !!addr.isDefault;
  modal.classList.add("active");
}

// --------------------------------------------------------------------------
// 4. EDIT PROFILE MODAL & AVATAR PHOTO UPLOAD (Mobile App Reference Parity)
// --------------------------------------------------------------------------
function setupEditProfileModal() {
  const openBtn = document.getElementById("open-edit-profile-btn");
  const avatarWrapper = document.getElementById("profile-avatar-wrapper");
  const modal = document.getElementById("edit-profile-modal");
  const closeBtn = document.getElementById("close-edit-profile-modal-btn");
  const form = document.getElementById("edit-profile-form");
  const avatarFileInput = document.getElementById("edit-avatar-file");
  const avatarPickerTrigger = document.getElementById("modal-avatar-picker-trigger");
  const avatarPreviewCircle = document.getElementById("modal-avatar-preview-circle");
  const quickLinkAddresses = document.getElementById("modal-quick-link-addresses");

  const openModal = async () => {
    if (currentUser) {
      document.getElementById("edit-full-name").value = currentUser.displayName || "";

      // Fetch user phone number from Firestore document
      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userDocRef);
        if (snap.exists() && snap.data().phoneNumber) {
          document.getElementById("edit-phone-number").value = snap.data().phoneNumber;
        } else {
          document.getElementById("edit-phone-number").value = currentUser.phoneNumber || "";
        }
      } catch (e) {
        document.getElementById("edit-phone-number").value = currentUser.phoneNumber || "";
      }

      if (avatarPreviewCircle) {
        if (currentUser.photoURL) {
          avatarPreviewCircle.innerHTML = `<img src="${escapeHtml(currentUser.photoURL)}" alt="Avatar preview" />`;
        } else {
          const initial = (currentUser.displayName || currentUser.email || "L").charAt(0).toUpperCase();
          avatarPreviewCircle.textContent = initial;
        }
      }
    }
    pendingAvatarFile = null;
    modal?.classList.add("active");
  };

  if (openBtn) openBtn.addEventListener("click", openModal);
  if (avatarWrapper) openBtn ? avatarWrapper.addEventListener("click", openModal) : null;
  if (closeBtn && modal) closeBtn.addEventListener("click", () => modal.classList.remove("active"));

  if (avatarPickerTrigger && avatarFileInput) {
    avatarPickerTrigger.addEventListener("click", () => avatarFileInput.click());
  }

  if (quickLinkAddresses && modal) {
    quickLinkAddresses.addEventListener("click", () => {
      modal.classList.remove("active");
      const addrSection = document.getElementById("shipping-addresses-list");
      if (addrSection) {
        addrSection.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  // File Picker & Live Thumbnail Preview
  if (avatarFileInput) {
    avatarFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        showToast("Please select a valid image file (JPG, PNG, WEBP)", "error");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showToast("Image size must be smaller than 5MB", "error");
        return;
      }

      pendingAvatarFile = file;

      const reader = new FileReader();
      reader.onload = (evt) => {
        if (avatarPreviewCircle) {
          avatarPreviewCircle.innerHTML = `<img src="${evt.target.result}" alt="Preview" />`;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Profile Form Submit Logic
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) return;

      const fullName = document.getElementById("edit-full-name").value.trim();
      const phoneNumber = document.getElementById("edit-phone-number").value.trim();

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "SAVING CHANGES...";
      }

      try {
        let newPhotoURL = currentUser.photoURL;

        if (pendingAvatarFile) {
          try {
            const fileRef = storageRef(storage, `user_profiles/${currentUser.uid}/${Date.now()}_${pendingAvatarFile.name}`);
            await uploadBytes(fileRef, pendingAvatarFile);
            newPhotoURL = await getDownloadURL(fileRef);
          } catch (storageErr) {
            console.warn("Firebase Storage upload failed, falling back to compressed base64 URL:", storageErr);
            newPhotoURL = await compressImageToBase64(pendingAvatarFile);
          }
        }

        // Firebase Auth updateProfile strictly enforces photoURL length < 2048 characters & HTTP/HTTPS scheme.
        // Base64 Data URLs trigger "auth/invalid-profile-attribute: Photo URL too long".
        const authPayload = { displayName: fullName };
        if (newPhotoURL && (newPhotoURL.startsWith("http://") || newPhotoURL.startsWith("https://")) && newPhotoURL.length < 2000) {
          authPayload.photoURL = newPhotoURL;
        }

        // Update Firebase Auth profile
        await updateProfile(auth.currentUser, authPayload);

        // Update Firestore user document (stores full photoURL whether Storage URL or compressed Base64 fallback)
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            displayName: fullName,
            phoneNumber: phoneNumber,
            photoURL: newPhotoURL || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        renderProfileHeader(auth.currentUser);
        showToast("Profile changes saved successfully!", "success");
        if (modal) modal.classList.remove("active");
      } catch (err) {
        console.error("Error updating profile:", err);
        showToast("Failed to save profile changes: " + err.message, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "SAVE CHANGES";
        }
      }
    });
  }
}

// Compress image to Base64 data URL fallback
function compressImageToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 300;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// --------------------------------------------------------------------------
// 5. SETTINGS & PREFERENCES
// --------------------------------------------------------------------------
function setupSettingsAndPreferences() {
  // Reset Password
  const resetPasswordBtn = document.getElementById("btn-security-reset-password");
  if (resetPasswordBtn) {
    resetPasswordBtn.addEventListener("click", async () => {
      if (!currentUser || !currentUser.email) return;
      try {
        await sendPasswordResetEmail(auth, currentUser.email);
        showToast(`Password reset link sent to ${currentUser.email}`, "success");
      } catch (err) {
        showToast("Error: " + err.message, "error");
      }
    });
  }

  // Sign Out Button
  const signOutBtn = document.getElementById("profile-sign-out-btn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      if (confirm("Are you sure you want to sign out?")) {
        await signOut(auth);
        showToast("Signed out successfully", "info");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 800);
      }
    });
  }
}

// --------------------------------------------------------------------------
// 6. HELP CENTER ACCORDIONS (Image 1 Parity)
// --------------------------------------------------------------------------
function setupFaqAccordions() {
  const headers = document.querySelectorAll(".faq-accordion-header");
  headers.forEach((header) => {
    header.addEventListener("click", () => {
      const item = header.parentElement;
      const isOpen = item.classList.contains("open");

      document.querySelectorAll(".faq-accordion-item").forEach((i) => i.classList.remove("open"));

      if (!isOpen) {
        item.classList.add("open");
      }
    });
  });
}

// --------------------------------------------------------------------------
// 7. BUG REPORTING MODAL (bug_reports/{bugId})
// --------------------------------------------------------------------------
function setupBugReportingModal() {
  const openBtn = document.getElementById("open-bug-report-btn");
  const modal = document.getElementById("bug-report-modal");
  const closeBtn = document.getElementById("close-bug-report-modal-btn");
  const form = document.getElementById("bug-report-form");

  if (openBtn && modal) {
    openBtn.addEventListener("click", () => modal.classList.add("active"));
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => modal.classList.remove("active"));
  }

  let selectedSeverity = "Medium";
  const severityPills = document.querySelectorAll(".severity-pill");
  severityPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      severityPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      selectedSeverity = pill.getAttribute("data-severity") || "Medium";
    });
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        showToast("Please sign in to submit a bug report", "error");
        return;
      }

      const title = document.getElementById("bug-title").value.trim();
      const category = document.getElementById("bug-category").value;
      const description = document.getElementById("bug-description").value.trim();
      const fileInput = document.getElementById("bug-screenshots");

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting Report...";
      }

      try {
        const screenshotUrls = [];
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          const files = Array.from(fileInput.files).slice(0, 3);
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
              const fileRef = storageRef(storage, `bug_reports/${currentUser.uid}/${Date.now()}_${i}_${file.name}`);
              await uploadBytes(fileRef, file);
              const url = await getDownloadURL(fileRef);
              screenshotUrls.push(url);
            } catch (sErr) {
              console.warn("Screenshot upload error, fallback to base64:", sErr);
              const b64 = await compressImageToBase64(file);
              screenshotUrls.push(b64);
            }
          }
        }

        const bugReportDoc = doc(collection(db, "bug_reports"));
        await setDoc(bugReportDoc, {
          userId: currentUser.uid,
          userEmail: currentUser.email,
          title,
          category,
          severity: selectedSeverity,
          description,
          screenshots: screenshotUrls,
          status: "Pending",
          timestamp: serverTimestamp(),
          deviceInfo: {
            platform: "Web",
            version: navigator.userAgent,
          },
        });

        showToast("Bug report submitted successfully! Thank you for helping us improve.", "success");
        form.reset();
        selectedSeverity = "Medium";
        severityPills.forEach((p) => p.classList.toggle("active", p.getAttribute("data-severity") === "Medium"));
        if (modal) modal.classList.remove("active");
      } catch (err) {
        console.error("Error submitting bug report:", err);
        showToast("Failed to submit bug report: " + err.message, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "SUBMIT BUG REPORT";
        }
      }
    });
  }
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", initProfileApp);
