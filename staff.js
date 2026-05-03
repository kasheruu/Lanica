import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  Timestamp,
  setDoc,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  updatePassword,
  updateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendEmailVerification,
  reload,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

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
const auth = getAuth(app);
const db = getFirestore(app);

const ordersListEl = document.getElementById("staff-orders-list");
const historyListEl = document.getElementById("staff-history-list");
const logoutBtn = document.getElementById("logout-btn");

const acceptedStatEl = document.getElementById("staff-accepted");
const processingStatEl = document.getElementById("staff-processing");
const shippedStatEl = document.getElementById("staff-shipped");
const deliveredStatEl = document.getElementById("staff-delivered");

const profileForm = document.getElementById("staff-profile-form");
const displayNameInput = document.getElementById("staff-display-name");
const displayNameEditInput = document.getElementById("staff-display-name-edit");
const saveProfileBtn = document.getElementById("staff-save-profile");
const profileHintEl = document.getElementById("staff-profile-hint");
const profileHintEditEl = document.getElementById("staff-profile-hint-edit");

// Profile Verification Elements
const editProfileBtn = document.getElementById("edit-profile-btn");
const profileVerificationSection = document.getElementById("profile-verification-section");
const profileEditSection = document.getElementById("profile-edit-section");
const profileSaveSection = document.getElementById("profile-save-section");
const sendProfileVerificationBtn = document.getElementById("send-profile-verification-btn");
const cancelProfileEditBtn = document.getElementById("cancel-profile-edit-btn");
const profileVerificationFeedbackEl = document.getElementById("profile-verification-feedback");
const profileCodeInputSection = document.getElementById("profile-code-input-section");
const profileVerificationCodeInput = document.getElementById("profile-verification-code");
const verifyProfileCodeBtn = document.getElementById("verify-profile-code-btn");

// Profile verification state
let profileEditVerified = false;
let profileVerificationCode = null;

// Profile Photo Elements
const profilePhotoPreview = document.getElementById("profile-photo-preview");
const photoUploadSection = document.getElementById("photo-upload-section");
const photoVerificationSection = document.getElementById("photo-verification-section");
const profilePhotoInput = document.getElementById("profile-photo-input");
const selectPhotoBtn = document.getElementById("select-photo-btn");
const cancelPhotoBtn = document.getElementById("cancel-photo-btn");
const changePhotoBtn = document.getElementById("change-photo-btn");
const sendPhotoVerificationBtn = document.getElementById("send-photo-verification-btn");
const cancelPhotoChangeBtn = document.getElementById("cancel-photo-change-btn");
const photoUploadFeedbackEl = document.getElementById("photo-upload-feedback");
const photoVerificationFeedbackEl = document.getElementById("photo-verification-feedback");
const photoCodeInputSection = document.getElementById("photo-code-input-section");
const photoVerificationCodeInput = document.getElementById("photo-verification-code");
const verifyPhotoCodeBtn = document.getElementById("verify-photo-code-btn");

// Profile photo state
let selectedPhotoFile = null;
let photoChangeVerified = false;
let photoVerificationCode = null;

// Photo Preview Elements
const photoPreviewSection = document.getElementById("photo-preview-section");
const selectedPhotoPreview = document.getElementById("selected-photo-preview");
const selectedPhotoInfo = document.getElementById("selected-photo-info");
const uploadPhotoBtn = document.getElementById("upload-photo-btn");
const cancelPhotoUploadBtn = document.getElementById("cancel-photo-upload-btn");
const photoPreviewFeedbackEl = document.getElementById("photo-preview-feedback");

// Email Change Elements
const currentEmailDisplay = document.getElementById("current-email-display");
const emailChangeSection = document.getElementById("email-change-section");
const emailVerificationSection = document.getElementById("email-verification-section");
const newEmailInput = document.getElementById("new-email-input");
const confirmEmailInput = document.getElementById("confirm-email-input");
const changeEmailBtn = document.getElementById("change-email-btn");
const sendEmailChangeBtn = document.getElementById("send-email-change-btn");
const cancelEmailChangeBtn = document.getElementById("cancel-email-change-btn");
const sendCurrentEmailVerificationBtn = document.getElementById(
  "send-current-email-verification-btn"
);
const cancelEmailVerificationBtn = document.getElementById("cancel-email-verification-btn");
const emailChangeFeedbackEl = document.getElementById("email-change-feedback");
const emailVerificationFeedbackEl = document.getElementById("email-verification-feedback");

// Email change state
let emailChangeVerified = false;
let pendingEmailChange = null;

// Profile verification state
let profileVerificationRequested = false;
let profileVerificationTimestamp = null;
let profileInitialVerificationStatus = null;

// Photo verification state
let photoVerificationRequested = false;
let photoVerificationTimestamp = null;
let photoInitialVerificationStatus = null;

// Profile verification functions
async function sendProfileVerificationEmail() {
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }

  try {
    // Generate and store verification code
    const code = await generateVerificationCode();
    await storeVerificationCode(currentUser.uid, code, "profile");

    // Send verification email with code
    await sendVerificationEmail(currentUser.email, code, "profile");

    // Mark that verification was requested and track timestamp
    profileVerificationRequested = true;
    profileVerificationTimestamp = Date.now();

    // Only log if verification was sent successfully
    try {
      await logStaffAction(
        "profile_verification_sent",
        `Profile verification code sent to ${currentUser.email}`,
        true
      );
    } catch (logError) {
      console.warn("Failed to log action:", logError);
    }

    return true;
  } catch (error) {
    console.error("Profile verification error:", error);

    // Handle specific Firebase errors
    if (error.code === "auth/too-many-requests") {
      throw new Error(
        "Too many verification requests. Please wait a few minutes before trying again."
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.");
    } else {
      throw new Error(error.message || "Failed to send verification code. Please try again.");
    }
  }
}

async function checkProfileEmailVerification(code) {
  if (!currentUser) return false;

  try {
    // Only allow verification if it was requested in this session
    if (!profileVerificationRequested) {
      return false;
    }

    // Verify the code
    const isValid = await verifyCode(currentUser.uid, code, "profile");

    if (isValid) {
      await logStaffAction(
        "profile_verification_success",
        "Profile verification code verified successfully",
        true
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking profile email verification:", error);
    await logStaffAction(
      "profile_verification_failed",
      `Failed to check profile verification: ${error.message}`,
      false
    );
    return false;
  }
}

// Profile Photo Security Functions
function validateImageFile(file) {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const maxSize = 2 * 1024 * 1024; // 2MB

  if (!allowedTypes.includes(file.type)) {
    return { isValid: false, error: "Only JPEG, PNG, and WebP images are allowed" };
  }

  if (file.size > maxSize) {
    return { isValid: false, error: "Image must be smaller than 2MB" };
  }

  return { isValid: true, error: null };
}

function sanitizeImageURL(url) {
  if (!url) return "";

  // Only allow trusted domains and data URLs
  const trustedDomains = [
    "ui-avatars.com",
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
  ];
  const urlObj = new URL(url, window.location.origin);

  if (urlObj.protocol === "data:") {
    // Allow data URLs for uploaded images
    return url;
  }

  if (trustedDomains.includes(urlObj.hostname)) {
    return url;
  }

  return ""; // Revoke untrusted URLs
}

async function uploadProfilePhoto(file) {
  if (!currentUser || !file) {
    throw new Error("No authenticated user or file provided");
  }

  // Validate file
  const validation = validateImageFile(file);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  try {
    // Create a data URL for the image (in production, use Firebase Storage)
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async (e) => {
        const dataURL = e.target.result;

        // Store in Firestore (in production, store in Firebase Storage)
        await setDoc(
          doc(db, "users", currentUser.uid),
          {
            profilePhoto: dataURL,
            photoURL: dataURL, // Maintain compatibility
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        );

        await logStaffAction("profile_photo_uploaded", "Profile photo uploaded successfully", true);
        resolve(dataURL);
      };

      reader.onerror = () => {
        reject(new Error("Failed to read image file"));
      };

      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error("Photo upload error:", error);
    await logStaffAction(
      "profile_photo_upload_failed",
      `Failed to upload photo: ${error.message}`,
      false
    );
    throw new Error("Failed to upload profile photo");
  }
}

async function sendPhotoVerificationEmail() {
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }

  try {
    // Generate and store verification code
    const code = await generateVerificationCode();
    await storeVerificationCode(currentUser.uid, code, "photo");

    // Send verification email with code
    await sendVerificationEmail(currentUser.email, code, "photo");

    // Mark that verification was requested and track timestamp
    photoVerificationRequested = true;
    photoVerificationTimestamp = Date.now();

    // Only log if verification was sent successfully
    try {
      await logStaffAction(
        "photo_verification_sent",
        `Photo verification code sent to ${currentUser.email}`,
        true
      );
    } catch (logError) {
      console.warn("Failed to log action:", logError);
    }

    return true;
  } catch (error) {
    console.error("Photo verification error:", error);

    // Handle specific Firebase errors
    if (error.code === "auth/too-many-requests") {
      throw new Error(
        "Too many verification requests. Please wait a few minutes before trying again."
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.");
    } else {
      // Try to log the error (but don't fail if logging fails)
      try {
        await logStaffAction(
          "photo_verification_sent",
          `Failed to send photo verification: ${error.message}`,
          false
        );
      } catch (logError) {
        console.warn("Failed to log error:", logError);
      }
      throw new Error("Failed to send verification email. Please try again later.");
    }
  }
}

async function checkPhotoEmailVerification(code) {
  if (!currentUser) return false;

  try {
    // Only allow verification if it was requested in this session
    if (!photoVerificationRequested) {
      return false;
    }

    // Verify the code
    const isValid = await verifyCode(currentUser.uid, code, "photo");

    if (isValid) {
      photoChangeVerified = true;
      await logStaffAction(
        "photo_verification_success",
        "Photo email verified automatically",
        true
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking photo email verification:", error);
    await logStaffAction(
      "photo_verification_failed",
      `Failed to check photo verification: ${error.message}`,
      false
    );
    return false;
  }
}

// Email Change Functions
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function sendCurrentEmailVerification() {
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }

  try {
    // Send Firebase email verification to current email
    await sendEmailVerification(currentUser);

    // Only log if verification was sent successfully
    try {
      await logStaffAction(
        "email_change_verification_sent",
        `Email change verification sent to ${currentUser.email}`,
        true
      );
    } catch (logError) {
      console.warn("Failed to log action:", logError);
    }

    return true;
  } catch (error) {
    console.error("Email change verification error:", error);

    // Handle specific Firebase errors
    if (error.code === "auth/too-many-requests") {
      throw new Error(
        "Too many verification requests. Please wait a few minutes before trying again."
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.");
    } else {
      // Try to log the error (but don't fail if logging fails)
      try {
        await logStaffAction(
          "email_change_verification_sent",
          `Failed to send email change verification: ${error.message}`,
          false
        );
      } catch (logError) {
        console.warn("Failed to log error:", logError);
      }
      throw new Error("Failed to send verification email. Please try again later.");
    }
  }
}

async function checkCurrentEmailVerification() {
  if (!currentUser) return false;

  try {
    // Reload user to get latest verification status
    await reload(currentUser);

    const isVerified = currentUser.emailVerified;

    if (isVerified) {
      emailChangeVerified = true;
      await logStaffAction(
        "email_change_verification_success",
        "Current email verified for email change",
        true
      );
    }

    return isVerified;
  } catch (error) {
    console.error("Error checking current email verification:", error);
    await logStaffAction(
      "email_change_verification_failed",
      `Failed to check email change verification: ${error.message}`,
      false
    );
    return false;
  }
}

async function updateEmailAddress(newEmail) {
  if (!currentUser || !newEmail) {
    throw new Error("No authenticated user or new email provided");
  }

  try {
    // Update Firebase Auth email
    await updateEmail(currentUser, newEmail);

    // Update Firestore user document
    await setDoc(
      doc(db, "users", currentUser.uid),
      {
        email: newEmail,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );

    await logStaffAction(
      "email_changed",
      `Email changed from ${currentUser.email} to ${newEmail}`,
      true
    );

    return true;
  } catch (error) {
    console.error("Email update error:", error);
    await logStaffAction("email_change_failed", `Failed to change email: ${error.message}`, false);
    throw new Error("Failed to update email address. Please try again.");
  }
}

const staffAccountChip = document.getElementById("staff-account-chip");
const staffAvatarEl = document.getElementById("staff-avatar");
const staffAccountNameEl = document.getElementById("staff-account-name");
const navOrders = document.getElementById("nav-orders");
const navMyAccount = document.getElementById("nav-my-account");
const staffOrdersSection = document.getElementById("staff-orders-section");
const staffAccountSection = document.getElementById("staff-account-section");

let currentUser = null;
let allAssignedOrders = [];
const customerNameByUid = new Map();
const customerNameByEmail = new Map();
let customerHydrationInFlight = false;

// Session timeout for security
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let lastActivity = Date.now();
let sessionTimeoutTimer = null;

function resetSessionTimer() {
  lastActivity = Date.now();
  if (sessionTimeoutTimer) {
    clearTimeout(sessionTimeoutTimer);
  }
  sessionTimeoutTimer = setTimeout(checkSessionTimeout, SESSION_TIMEOUT);
}

function checkSessionTimeout() {
  if (Date.now() - lastActivity > SESSION_TIMEOUT) {
    console.log("Session expired due to inactivity");
    signOut(auth)
      .then(() => {
        window.location.replace("/login.html?reason=session_expired");
      })
      .catch((error) => {
        console.error("Error signing out:", error);
        window.location.replace("/login.html?reason=session_expired");
      });
  }
}

// Periodic verification status checking
let verificationCheckInterval = null;

function startVerificationStatusCheck() {
  // Clear any existing interval
  if (verificationCheckInterval) {
    clearInterval(verificationCheckInterval);
  }

  let checkCount = 0;
  const maxChecks = 20; // Check for up to 10 minutes (20 * 30 seconds)

  verificationCheckInterval = setInterval(async () => {
    checkCount++;

    try {
      await updateEmailVerificationStatus();

      // Stop checking if verified or max checks reached
      if (currentUser.emailVerified || checkCount >= maxChecks) {
        clearInterval(verificationCheckInterval);
        verificationCheckInterval = null;

        if (currentUser.emailVerified) {
          console.log("✅ Email verification detected!");
          // Show success notification
          alert("Email verified successfully! Your verification status has been updated.");
        }
      }
    } catch (error) {
      console.error("Error during verification status check:", error);
    }
  }, 30000); // Check every 30 seconds
}

// Rate limiting helper form submissions
const rateLimiter = {
  attempts: new Map(),

  isAllowed(action, limit = 5, windowMs = 60000) {
    const key = `${action}_${currentUser?.uid || "anonymous"}`;
    const now = Date.now();
    const attempts = this.attempts.get(key) || [];

    // Remove old attempts outside the window
    const recent = attempts.filter((time) => now - time < windowMs);

    if (recent.length >= limit) {
      return { allowed: false, remainingTime: windowMs - (now - recent[0]) };
    }

    recent.push(now);
    this.attempts.set(key, recent);
    return { allowed: true, remainingTime: 0 };
  },

  clearAttempts(action) {
    const key = `${action}_${currentUser?.uid || "anonymous"}`;
    this.attempts.delete(key);
  },
};

// Audit logging for staff actions
async function logStaffAction(action, details, success = true) {
  if (!currentUser || !auth.currentUser) return;

  try {
    await addDoc(collection(db, "audit_logs"), {
      userId: currentUser.uid,
      userEmail: currentUser.email,
      action: action,
      details: details,
      success: success,
      timestamp: Timestamp.now(),
      userAgent: navigator.userAgent,
      sessionId: currentUser.uid + "_" + Date.now(),
    });
    console.log(`Audit log: ${action} - ${success ? "SUCCESS" : "FAILED"}`);
  } catch (error) {
    console.error("Failed to log action:", error);
    console.error("Auth state:", {
      hasCurrentUser: !!currentUser,
      hasAuthUser: !!auth.currentUser,
      currentUserUid: currentUser?.uid,
      authUserUid: auth.currentUser?.uid,
    });
    // Don't block the main functionality if logging fails
  }
}

function showStaffSection(name) {
  const showOrders = name === "orders";
  const showAccount = name === "my-account";
  if (staffOrdersSection) staffOrdersSection.classList.toggle("is-hidden", !showOrders);
  if (staffAccountSection) staffAccountSection.classList.toggle("is-hidden", !showAccount);
  if (navOrders) navOrders.classList.toggle("active", showOrders);
  if (navMyAccount) navMyAccount.classList.toggle("active", showAccount);
}

if (navOrders) {
  navOrders.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("orders");
  });
}

if (navMyAccount) {
  navMyAccount.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("my-account");
  });
}

function escapeHtml(str) {
  if (str == null || str === undefined) return "";
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}

// Enhanced input sanitization for security
function sanitizeInput(input, type = "text") {
  const value = String(input || "").trim();

  switch (type) {
    case "name":
      // Only allow letters, spaces, hyphens, apostrophes, max 50 chars
      return value.replace(/[^a-zA-Z\s\-']/g, "").substring(0, 50);
    case "email":
      // Basic email sanitization, max 254 chars
      return value
        .toLowerCase()
        .replace(/[^a-z0-9@._-]/g, "")
        .substring(0, 254);
    case "password":
      // Don't sanitize passwords, just validate
      return value;
    case "orderId":
      // Only allow alphanumeric and dashes, max 50 chars
      return value.replace(/[^a-zA-Z0-9\-_]/g, "").substring(0, 50);
    case "message":
      // Allow more characters but limit length and remove scripts
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .substring(0, 1000);
    default:
      // General text sanitization, max 1000 chars
      return value.replace(/[<>]/g, "").substring(0, 1000);
  }
}

function validateInput(input, type = "text") {
  const sanitized = sanitizeInput(input, type);
  const original = String(input || "").trim();

  // Check if sanitization removed significant content
  if (sanitized.length === 0 && original.length > 0) {
    return { isValid: false, error: "Invalid characters detected", sanitized: "" };
  }

  if (type === "name" && sanitized.length < 2) {
    return { isValid: false, error: "Name must be at least 2 characters", sanitized: "" };
  }

  if (type === "email" && !sanitized.includes("@")) {
    return { isValid: false, error: "Invalid email format", sanitized: "" };
  }

  return { isValid: true, error: null, sanitized };
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
    (order.shippingAddress &&
      pickFirstNonEmpty(order.shippingAddress.fullName, order.shippingAddress.name)) ||
    (order.deliveryAddress &&
      pickFirstNonEmpty(order.deliveryAddress.fullName, order.deliveryAddress.name)) ||
    (order.address && pickFirstNonEmpty(order.address.fullName, order.address.name)) ||
    (order.shippingInfo &&
      pickFirstNonEmpty(order.shippingInfo.fullName, order.shippingInfo.name)) ||
    (order.customer && pickFirstNonEmpty(order.customer.fullName, order.customer.name)) ||
    "";

  return (
    pickFirstNonEmpty(
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
    ) || "—"
  );
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

  if (customerId && customerNameByUid.has(customerId))
    return customerNameByUid.get(customerId) || "";
  if (customerEmail && customerNameByEmail.has(customerEmail))
    return customerNameByEmail.get(customerEmail) || "";

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

    if (changed) {
      renderOrders();
      renderCompletedHistory();
    }
  } finally {
    customerHydrationInFlight = false;
  }
}

function normalizeOrderStatus(raw) {
  if (raw == null) return "pending";
  const s = String(raw).toLowerCase().trim();
  if (
    [
      "pending",
      "accepted",
      "processing",
      "shipped",
      "delivered",
      "declined",
      "completed",
      "received",
    ].includes(s)
  )
    return s;
  return "pending";
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

function formatOrderItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return "—";
  return items
    .map((it) => {
      const q = it.quantity != null ? it.quantity : 1;
      const nm = it.name || it.productName || "Item";
      return `${nm} x ${q}`;
    })
    .join(", ");
}

function updateStats() {
  const counts = { accepted: 0, processing: 0, shipped: 0, delivered: 0 };
  allAssignedOrders.forEach((o) => {
    const st = normalizeOrderStatus(o.status);
    if (counts[st] !== undefined) counts[st] += 1;
  });

  acceptedStatEl.textContent = String(counts.accepted);
  processingStatEl.textContent = String(counts.processing);
  shippedStatEl.textContent = String(counts.shipped);
  if (deliveredStatEl) deliveredStatEl.textContent = String(counts.delivered);
}

function renderOrders() {
  if (!ordersListEl) return;
  ordersListEl.innerHTML = "";

  const visibleOrders = allAssignedOrders.filter(
    (o) =>
      !isOrderCompleted(o) &&
      ["accepted", "processing", "shipped", "delivered"].includes(normalizeOrderStatus(o.status))
  );

  if (visibleOrders.length === 0) {
    ordersListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#6b7280;">No assigned accepted/processing orders found.</td></tr>`;
    return;
  }

  visibleOrders.forEach((order) => {
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

    const updateOptions = [];
    if (st === "accepted") updateOptions.push("processing");
    if (st === "processing") updateOptions.push("shipped");
    if (st === "shipped") updateOptions.push("delivered");

    // Calculate delivery estimate for current order
    const deliveryEstimate = calculateEstimatedDeliveryTime(order);

    // Handle display for manual overrides vs automatic estimates
    let daysDisplay;
    if (deliveryEstimate.isManual || deliveryEstimate.daysRange === "Custom") {
      daysDisplay = `<span style="color: #dc2626;">📅 Manual</span>`;
    } else {
      daysDisplay = `(${deliveryEstimate.daysRange})`;
    }

    const deliveryDisplay =
      st === "delivered"
        ? '<span style="color: #059669; font-size: 0.85rem;">✅ Delivered</span>'
        : `<div style="font-size: 0.82rem;">
          <div style="color: #1f2937; font-weight: 500;">${deliveryEstimate.minDate}</div>
          <div style="color: #6b7280; font-size: 0.75rem;">to ${deliveryEstimate.maxDate}</div>
          <div style="color: #f59e0b; font-size: 0.7rem; margin-top: 2px;">${daysDisplay}</div>
        </div>`;

    // Create manual override input
    const manualOverrideInput =
      st !== "delivered"
        ? `
      <div style="display: flex; gap: 5px; align-items: center;">
        <input
          type="date"
          class="manual-delivery-date"
          data-order-id="${escapeHtml(order.id)}"
          style="font-size: 0.75rem; padding: 4px; border: 1px solid #d1d5db; border-radius: 4px;"
          min="${new Date().toISOString().split("T")[0]}"
        />
        <button
          class="apply-manual-date-btn"
          data-order-id="${escapeHtml(order.id)}"
          style="font-size: 0.7rem; padding: 4px 8px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer;"
        >
          Apply
        </button>
      </div>
    `
        : '<span style="font-size:0.82rem;color:#6b7280;">N/A</span>';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong style="font-size:0.9rem;">${escapeHtml(order.id.slice(0, 8))}...</strong>
        <div style="font-size:0.75rem;color:#9ca3af;margin-top:4px;">${escapeHtml(dateStr)}</div>
      </td>
      <td>${escapeHtml(String(customer))}</td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td>${totalStr}</td>
      <td>
        <span class="order-status-badge order-status-${escapeHtml(st)}">${escapeHtml(
          st.charAt(0).toUpperCase() + st.slice(1)
        )}</span>
      </td>
      <td>${deliveryDisplay}</td>
      <td>${manualOverrideInput}</td>
      <td>
        ${
          updateOptions.length > 0
            ? `<select class="staff-status-select" data-order-id="${escapeHtml(order.id)}" aria-label="Update order status">
                <option value="">Select update</option>
                ${updateOptions
                  .map(
                    (opt) =>
                      `<option value="${opt}">${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`
                  )
                  .join("")}
              </select>`
            : `<span style="font-size:0.82rem;color:#6b7280;">No actions</span>`
        }
      </td>
    `;
    ordersListEl.appendChild(tr);
  });
}

function renderCompletedHistory() {
  if (!historyListEl) return;
  historyListEl.innerHTML = "";

  const completed = allAssignedOrders.filter((o) => isOrderCompleted(o));
  if (completed.length === 0) {
    historyListEl.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#6b7280;">No completed transactions yet.</td></tr>`;
    return;
  }

  completed.forEach((order) => {
    const customer = resolveCustomerDisplay(order);
    const total = order.total != null ? order.total : order.totalAmount;
    const totalStr =
      total != null && total !== ""
        ? `₱${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    const assignedStaff = order.assignedToName || "You";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong style="font-size:0.9rem;">${escapeHtml(order.id.slice(0, 8))}…</strong></td>
      <td>${escapeHtml(String(customer))}</td>
      <td class="order-items-cell">${escapeHtml(formatOrderItemsSummary(order.items))}</td>
      <td>${totalStr}</td>
      <td>${escapeHtml(assignedStaff)}</td>
      <td>${escapeHtml(getCompletedAtLabel(order))}</td>
    `;
    historyListEl.appendChild(tr);
  });
}

// Function to get location-based delivery times
function getLocationBasedDeliveryTimes(address) {
  if (!address) {
    return { min: 3, max: 5 }; // Default for unknown locations
  }

  const addressString =
    typeof address === "string"
      ? address.toLowerCase()
      : (address.city || address.province || address.municipality || "").toLowerCase();

  // Define delivery zones based on location
  const deliveryZones = {
    // Local areas - fastest delivery
    pila: { min: 1, max: 2 },
    calamba: { min: 1, max: 2 },
    cabuyao: { min: 1, max: 2 },
    binan: { min: 1, max: 2 },
    "santa rosa": { min: 1, max: 2 },

    // Nearby Laguna cities - moderate delivery
    "san pedro": { min: 2, max: 3 },
    "los baños": { min: 2, max: 3 },
    bay: { min: 2, max: 3 },
    calauan: { min: 2, max: 3 },
    liliw: { min: 2, max: 3 },
    nagcarlan: { min: 2, max: 3 },
    rizal: { min: 2, max: 3 },
    magdalena: { min: 2, max: 3 },
    luisiana: { min: 2, max: 3 },
    majayjay: { min: 2, max: 3 },
    pagsanjan: { min: 2, max: 3 },
    paete: { min: 2, max: 3 },
    kalayaan: { min: 2, max: 3 },
    cavinti: { min: 2, max: 3 },

    // Distant areas - longer delivery
    "san pablo": { min: 3, max: 4 },
    siniloan: { min: 3, max: 4 },
    famy: { min: 3, max: 4 },
    mabitac: { min: 3, max: 4 },
    "sta. maria": { min: 3, max: 4 },
    cavite: { min: 3, max: 4 },
    batangas: { min: 3, max: 4 },
    quezon: { min: 3, max: 4 },

    // Metro Manila - standard delivery
    manila: { min: 2, max: 3 },
    "quezon city": { min: 2, max: 3 },
    makati: { min: 2, max: 3 },
    pasig: { min: 2, max: 3 },
    taguig: { min: 2, max: 3 },
    mandaluyong: { min: 2, max: 3 },
    "san juan": { min: 2, max: 3 },
    pasay: { min: 2, max: 3 },
    paranaque: { min: 2, max: 3 },
    muntinlupa: { min: 2, max: 3 },
    "las pinas": { min: 2, max: 3 },
    marikina: { min: 2, max: 3 },
    malabon: { min: 2, max: 3 },
    navotas: { min: 2, max: 3 },
    valenzuela: { min: 2, max: 3 },
    caloocan: { min: 2, max: 3 },

    // Provincial areas - longer delivery
    "batangas city": { min: 3, max: 5 },
    lipa: { min: 3, max: 5 },
    tanauan: { min: 3, max: 5 },
    "sto. tomas": { min: 3, max: 5 },
    bauan: { min: 3, max: 5 },
    "san jose": { min: 3, max: 5 },
    cuenca: { min: 3, max: 5 },
    alitagtag: { min: 3, max: 5 },
    balayan: { min: 3, max: 5 },
    calaca: { min: 3, max: 5 },
    lemery: { min: 3, max: 5 },
    taal: { min: 3, max: 5 },
    "san luis": { min: 3, max: 5 },
    "san pascual": { min: 3, max: 5 },
    "san nicolas": { min: 3, max: 5 },
    tingloy: { min: 3, max: 5 },

    // Quezon Province
    lucena: { min: 3, max: 5 },
    sariaya: { min: 3, max: 5 },
    tayabas: { min: 3, max: 5 },
    candelaria: { min: 3, max: 5 },
    dolores: { min: 3, max: 5 },
    tiaong: { min: 3, max: 5 },
    "san antonio": { min: 3, max: 5 },
    "padre burgos": { min: 3, max: 5 },
    agdangan: { min: 3, max: 5 },
    unisan: { min: 3, max: 5 },
    "general nakar": { min: 4, max: 6 },
    infanta: { min: 4, max: 6 },
    real: { min: 4, max: 6 },
    mauban: { min: 3, max: 5 },
    sampaloc: { min: 4, max: 6 },
    lucban: { min: 3, max: 5 },
    pagsanjan: { min: 2, max: 3 },
    majayjay: { min: 2, max: 3 },
    luisiana: { min: 3, max: 5 },
    cavinti: { min: 3, max: 5 },
    famy: { min: 3, max: 4 },
    mabitac: { min: 3, max: 4 },
    siniloan: { min: 3, max: 4 },
    kalayaan: { min: 2, max: 3 },
    paete: { min: 2, max: 3 },
    pakil: { min: 3, max: 5 },
    pangil: { min: 3, max: 5 },
    siniloan: { min: 3, max: 4 },
    lumban: { min: 2, max: 3 },
    cavinti: { min: 3, max: 5 },
    baliuag: { min: 3, max: 5 },
    "san miguel": { min: 4, max: 6 },
    "san ildefonso": { min: 4, max: 6 },
    "san rafael": { min: 4, max: 6 },
    "dona remedios trinidad": { min: 4, max: 6 },
    "san jose del monte": { min: 3, max: 5 },
    meycauayan: { min: 3, max: 5 },
    marilao: { min: 3, max: 5 },
    obando: { min: 3, max: 5 },
    bocaue: { min: 3, max: 5 },
    balagtas: { min: 3, max: 5 },
    guiguinto: { min: 3, max: 5 },
    plaridel: { min: 3, max: 5 },
    pandi: { min: 4, max: 6 },
    angat: { min: 4, max: 6 },
    norzagaray: { min: 4, max: 6 },
  };

  // Find matching location
  for (const [location, timeRange] of Object.entries(deliveryZones)) {
    if (addressString.includes(location)) {
      return timeRange;
    }
  }

  // Default for unknown locations
  return { min: 3, max: 5 };
}

// Function to calculate estimated delivery time based on status and address
function calculateEstimatedDeliveryTime(order, manualOverride = null) {
  const now = new Date();
  const status = normalizeOrderStatus(order.status);

  // Use manual override if provided (from function parameter)
  if (manualOverride && manualOverride.minDate && manualOverride.maxDate) {
    return {
      minDate: manualOverride.minDate,
      maxDate: manualOverride.maxDate,
      daysRange: manualOverride.daysRange || "Custom",
      status: status,
      isManual: true,
    };
  }

  // Check for manual override stored in database
  if (
    order.manualDeliveryOverride &&
    (order.manualOverrideApplied || order.estimatedDeliveryDays === "Custom")
  ) {
    return {
      minDate: order.manualDeliveryOverride,
      maxDate: order.manualDeliveryOverride,
      daysRange: "Custom",
      status: status,
      isManual: true,
    };
  }

  // Use stored estimates if available (but not manual overrides)
  if (order.estimatedDeliveryMin && order.estimatedDeliveryMax && !order.manualOverrideApplied) {
    return {
      minDate: order.estimatedDeliveryMin,
      maxDate: order.estimatedDeliveryMax,
      daysRange: order.estimatedDeliveryDays || `${order.estimatedDeliveryDays}`,
      status: status,
      isManual: false,
    };
  }

  // Get customer address
  const customerAddress = order.shippingAddress || order.deliveryAddress || order.address || "";

  // Base delivery times by status
  const statusMultipliers = {
    accepted: 1.0,
    processing: 0.8,
    shipped: 0.6,
    delivered: 0,
  };

  // Get location-based delivery times
  const locationTimes = getLocationBasedDeliveryTimes(customerAddress);
  const multiplier = statusMultipliers[status] || 1.0;

  // Calculate adjusted delivery times
  const minDays = Math.ceil(locationTimes.min * multiplier);
  const maxDays = Math.ceil(locationTimes.max * multiplier);

  // Calculate estimated delivery date
  const minDeliveryDate = new Date(now.getTime() + minDays * 24 * 60 * 60 * 1000);
  const maxDeliveryDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

  // Format dates for display
  const formatDate = (date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Check for weekends (no delivery on Sundays)
  const addWeekendBuffer = (date) => {
    const day = date.getDay();
    if (day === 0) {
      // Sunday
      return new Date(date.getTime() + 24 * 60 * 60 * 1000); // Add 1 day
    }
    return date;
  };

  const adjustedMinDate = addWeekendBuffer(minDeliveryDate);
  const adjustedMaxDate = addWeekendBuffer(maxDeliveryDate);

  return {
    minDate: formatDate(adjustedMinDate),
    maxDate: formatDate(adjustedMaxDate),
    daysRange: `${minDays}-${maxDays} days`,
    status: status,
    location: customerAddress,
    isManual: false,
  };
}

// Function to apply manual delivery date override
async function applyManualDeliveryDate(orderId, manualDate) {
  try {
    const orderRef = doc(db, "orders", orderId);
    const currentOrder = allAssignedOrders.find((o) => o.id === orderId);

    if (!currentOrder) {
      throw new Error("Order not found");
    }

    // Create manual override object
    const manualOverride = {
      minDate: manualDate,
      maxDate: manualDate,
      daysRange: "Custom",
      isManual: true,
    };

    // Calculate with manual override
    const deliveryEstimate = calculateEstimatedDeliveryTime(currentOrder, manualOverride);

    await updateDoc(orderRef, {
      estimatedDeliveryMin: manualDate,
      estimatedDeliveryMax: manualDate,
      estimatedDeliveryDays: "Custom",
      manualDeliveryOverride: manualDate,
      manualOverrideApplied: true,
      manualOverrideAppliedAt: Timestamp.now(),
    });

    console.log(`Manual delivery date applied for order ${orderId}: ${manualDate}`);

    // Orders will refresh automatically via the real-time listener
    // No need to manually reload as onSnapshot handles updates

    return true;
  } catch (e) {
    console.error("Failed to apply manual delivery date:", e);
    alert("Failed to apply manual delivery date.");
    return false;
  }
}

// Function to update order status in Firestore
async function updateOrderStatus(orderId, newStatus) {
  try {
    const orderRef = doc(db, "orders", orderId);

    // Get current order to check for manual override
    const currentOrder = allAssignedOrders.find((o) => o.id === orderId);

    // Calculate new delivery estimate
    let deliveryEstimate;
    if (
      currentOrder &&
      currentOrder.manualDeliveryOverride &&
      !currentOrder.manualOverrideApplied
    ) {
      // Use existing manual override
      const manualOverride = {
        minDate: currentOrder.manualDeliveryOverride,
        maxDate: currentOrder.manualDeliveryOverride,
        daysRange: "Custom",
        isManual: true,
      };
      deliveryEstimate = calculateEstimatedDeliveryTime(currentOrder, manualOverride);
    } else {
      // Calculate based on address and status
      deliveryEstimate = calculateEstimatedDeliveryTime({
        ...currentOrder,
        status: newStatus,
      });
    }

    // Prepare update data
    const updateData = {
      status: newStatus,
      updatedAt: Timestamp.now(),
      estimatedDeliveryMin: deliveryEstimate.minDate,
      estimatedDeliveryMax: deliveryEstimate.maxDate,
      estimatedDeliveryDays: deliveryEstimate.daysRange,
    };

    // Preserve manual override fields if they exist
    if (currentOrder && currentOrder.manualDeliveryOverride) {
      updateData.manualDeliveryOverride = currentOrder.manualDeliveryOverride;
      updateData.manualOverrideApplied = true;
    }

    await updateDoc(orderRef, updateData);

    console.log(
      `Order ${orderId} updated to ${newStatus} with delivery estimate: ${deliveryEstimate.minDate} - ${deliveryEstimate.maxDate}`
    );
  } catch (e) {
    console.error("Failed to update order:", e);
    alert("Failed to update order status.");
  }
}

async function getUserRole(user) {
  if (!user) return null;

  let role = null;

  try {
    const roleByUid = await getDoc(doc(db, "users", user.uid));
    if (roleByUid.exists()) {
      role = (roleByUid.data().role || "").toLowerCase();
      console.log("Role found by UID:", role);
      return role;
    }
  } catch (e) {
    console.warn("Could not read user role by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await getDocs(q);
    if (!snap.empty) {
      role = ((snap.docs[0].data() || {}).role || "").toLowerCase();
      console.log("Role found by email:", role);
      return role;
    }
  } catch (e) {
    console.warn("Could not read user role by email:", e);
  }

  console.log("No role found for user, returning null");
  return null;
}

async function loadMyProfile() {
  if (!currentUser || !displayNameInput) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const data = snap.exists() ? snap.data() : {};
    const nm = data.displayName || data.name || "";
    const profilePhoto = data.photoURL || data.profilePic || currentUser.photoURL || "";

    displayNameInput.value = nm;
    if (displayNameEditInput) {
      displayNameEditInput.value = nm;
    }
    if (staffAccountNameEl) {
      staffAccountNameEl.textContent =
        nm || currentUser.displayName || currentUser.email || "My Account";
    }
    if (staffAvatarEl) {
      if (profilePhoto) {
        const sanitizedPhoto = sanitizeImageURL(profilePhoto);
        staffAvatarEl.src =
          sanitizedPhoto ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(
            nm || currentUser.displayName || currentUser.email || "Staff"
          )}&background=111827&color=fff&size=128`;
      } else {
        const fallbackName = nm || currentUser.displayName || currentUser.email || "Staff";
        staffAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          fallbackName
        )}&background=111827&color=fff&size=128`;
      }
    }

    // Update profile photo preview
    if (profilePhotoPreview) {
      if (profilePhoto) {
        const sanitizedPhoto = sanitizeImageURL(profilePhoto);
        profilePhotoPreview.src =
          sanitizedPhoto ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(
            nm || currentUser.displayName || currentUser.email || "Staff"
          )}&background=111827&color=fff&size=64`;
      } else {
        const fallbackName = nm || currentUser.displayName || currentUser.email || "Staff";
        profilePhotoPreview.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          fallbackName
        )}&background=111827&color=fff&size=64`;
      }
    }

    // Update current email display
    if (currentEmailDisplay) {
      currentEmailDisplay.textContent = currentUser.email || "Not available";
    }

    // Load account information
    await loadAccountInformation(data);
  } catch (e) {
    console.warn("Could not load staff profile:", e);
  }
}

async function loadAccountInformation(userData = {}) {
  if (!currentUser) return;

  try {
    // Display email
    if (emailDisplayEl) {
      emailDisplayEl.textContent = currentUser.email || "Not available";
    }

    // Display email in password reset section
    if (resetEmailDisplayEl) {
      resetEmailDisplayEl.textContent = currentUser.email || "your@email.com";
    }

    // Check and display email verification status
    await updateEmailVerificationStatus();

    // Display role
    if (staffRoleDisplayEl) {
      const role = userData.role || "staff";
      staffRoleDisplayEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
      staffRoleDisplayEl.style.color = role === "admin" ? "#dc2626" : "#059669";
    }

    // Display account creation date
    if (staffCreatedDisplayEl) {
      const createdAt = userData.createdAt || currentUser.metadata?.creationTime;
      if (createdAt) {
        const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        staffCreatedDisplayEl.textContent = date.toLocaleDateString();
      } else {
        staffCreatedDisplayEl.textContent = "Unknown";
      }
    }
  } catch (error) {
    console.error("Error loading account information:", error);
  }
}

async function updateEmailVerificationStatus() {
  if (!currentUser || !emailStatusTextEl || !emailStatusIndicatorEl) return;

  try {
    // Reload user to get latest verification status
    await reload(currentUser);

    const isVerified = currentUser.emailVerified;

    // Update status text and indicator
    if (isVerified) {
      emailStatusTextEl.textContent = "Verified";
      emailStatusTextEl.style.color = "#059669";
      emailStatusIndicatorEl.style.backgroundColor = "#059669";

      // Show verified info, hide unverified actions
      if (verifiedEmailInfoEl) verifiedEmailInfoEl.style.display = "block";
      if (unverifiedEmailActionsEl) unverifiedEmailActionsEl.style.display = "none";
    } else {
      emailStatusTextEl.textContent = "Not Verified";
      emailStatusTextEl.style.color = "#dc2626";
      emailStatusIndicatorEl.style.backgroundColor = "#dc2626";

      // Show unverified actions, hide verified info
      if (verifiedEmailInfoEl) verifiedEmailInfoEl.style.display = "none";
      if (unverifiedEmailActionsEl) unverifiedEmailActionsEl.style.display = "block";
    }
  } catch (error) {
    console.error("Error checking email verification status:", error);
    emailStatusTextEl.textContent = "Error";
    emailStatusTextEl.style.color = "#6b7280";
    emailStatusIndicatorEl.style.backgroundColor = "#6b7280";
  }
}

async function saveMyProfile(displayName) {
  if (!currentUser) return;

  // Validate and sanitize input
  const validation = validateInput(displayName, "name");
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const sanitized = validation.sanitized;
  if (!sanitized) throw new Error("Name is required.");

  // Ensure the user's profile doc exists and is up to date.
  await setDoc(
    doc(db, "users", currentUser.uid),
    {
      role: "staff",
      email: currentUser.email || null,
      displayName: sanitized,
      name: sanitized,
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  currentUser = user;

  // Start session timeout monitoring
  resetSessionTimer();

  // Add activity listeners
  document.addEventListener("click", resetSessionTimer);
  document.addEventListener("keypress", resetSessionTimer);
  document.addEventListener("scroll", resetSessionTimer);
  document.addEventListener("mousemove", resetSessionTimer);

  const role = await getUserRole(user);

  // Debug logging to identify the issue
  console.log("=== STAFF PAGE AUTH DEBUG ===");
  console.log("User UID:", user.uid);
  console.log("User Email:", user.email);
  console.log("Detected Role:", role);
  console.log("Role type:", typeof role);
  console.log("Role length:", role ? role.length : "N/A");

  // Check if role is staff or if role detection failed
  if (role === null || role === undefined || role === "") {
    console.warn("Role not found in database, assuming user is staff for staff.html page");
    // For users accessing staff.html, assume they're staff if role is not set
    // This prevents the redirect loop
  } else if (role === "admin") {
    console.log("🔴 ADMIN USER DETECTED - Redirecting to admin page");
    console.log("Role value:", JSON.stringify(role));
    window.location.replace("/admin.html");
    return;
  } else {
    console.log("✅ USER ALLOWED TO STAY ON STAFF PAGE");
    console.log("Role value:", JSON.stringify(role));
  }
  // If role is "staff" or any other value (including "customer"), let them stay on staff page
  // This prevents the redirect loop for users who should have access to staff features

  await loadMyProfile();

  const ordersQuery = query(collection(db, "orders"), where("assignedToUid", "==", user.uid));
  onSnapshot(ordersQuery, (snapshot) => {
    allAssignedOrders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    allAssignedOrders.sort((a, b) => {
      const aTs = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const bTs = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return bTs - aTs;
    });
    updateStats();
    renderOrders();
    renderCompletedHistory();
    hydrateCustomerNamesForOrders(allAssignedOrders);
  });
});

// Edit Profile Button Event
if (editProfileBtn) {
  editProfileBtn.addEventListener("click", () => {
    // Show verification section
    if (profileVerificationSection) {
      profileVerificationSection.style.display = "block";
    }
    if (profileEditSection) {
      profileEditSection.style.display = "none";
    }

    // Reset verification state
    profileEditVerified = false;
    profileVerificationCode = null;

    if (profileVerificationFeedbackEl) {
      profileVerificationFeedbackEl.textContent = "";
    }
  });
}

// Send Profile Verification Button Event
if (sendProfileVerificationBtn) {
  sendProfileVerificationBtn.addEventListener("click", async () => {
    if (!currentUser) {
      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.textContent = "No authenticated user found";
        profileVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Rate limiting check
    const rateLimitResult = rateLimiter.isAllowed("profile_verification", 3, 300000); // 3 attempts per 5 minutes
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil(rateLimitResult.remainingTime / 60000);
      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.textContent = `Too many verification attempts. Please wait ${minutes} minute(s).`;
        profileVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (sendProfileVerificationBtn) {
      sendProfileVerificationBtn.disabled = true;
      sendProfileVerificationBtn.textContent = "Sending...";
    }

    try {
      await sendProfileVerificationEmail();

      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.innerHTML = `✅ Verification code sent to <strong>${currentUser.email}</strong>! Please check your inbox and enter the 6-digit code below.`;
        profileVerificationFeedbackEl.style.color = "#059669";
      }

      // Show code input section
      if (profileCodeInputSection) {
        profileCodeInputSection.style.display = "block";
      }

      // Reset button state
      if (sendProfileVerificationBtn) {
        sendProfileVerificationBtn.disabled = false;
        sendProfileVerificationBtn.textContent = "Resend Code";
      }
    } catch (error) {
      console.error("Send profile verification error:", error);
      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.textContent =
          error.message || "Failed to send verification code";
        profileVerificationFeedbackEl.style.color = "#dc2626";
      }
    } finally {
      // Reset button state
      if (sendProfileVerificationBtn) {
        sendProfileVerificationBtn.disabled = false;
        sendProfileVerificationBtn.textContent = "Send Verification Code";
      }
    }
  });
}

// Verify Profile Code Button Event
if (verifyProfileCodeBtn) {
  verifyProfileCodeBtn.addEventListener("click", async () => {
    if (!currentUser || !profileVerificationCodeInput) {
      return;
    }

    const code = profileVerificationCodeInput.value.trim();
    if (code.length !== 6) {
      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.textContent = "Please enter a 6-digit verification code";
        profileVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (verifyProfileCodeBtn) {
      verifyProfileCodeBtn.disabled = true;
      verifyProfileCodeBtn.textContent = "Verifying...";
    }

    try {
      const isValid = await checkProfileEmailVerification(code);

      if (isValid) {
        profileEditVerified = true;

        if (profileVerificationFeedbackEl) {
          profileVerificationFeedbackEl.innerHTML =
            "✅ Verification successful! You can now edit your profile.";
          profileVerificationFeedbackEl.style.color = "#059669";
        }

        // Show edit form after a short delay
        setTimeout(() => {
          if (profileVerificationSection) {
            profileVerificationSection.style.display = "none";
          }
          if (profileEditSection) {
            profileEditSection.style.display = "block";
          }
          if (profileSaveSection) {
            profileSaveSection.style.display = "block";
          }

          // Copy current value to edit input
          if (displayNameEditInput && displayNameInput) {
            displayNameEditInput.value = displayNameInput.value;
            displayNameEditInput.focus();
          }
        }, 1000);
      } else {
        if (profileVerificationFeedbackEl) {
          profileVerificationFeedbackEl.textContent =
            "Invalid verification code. Please try again.";
          profileVerificationFeedbackEl.style.color = "#dc2626";
        }
      }
    } catch (error) {
      console.error("Profile verification error:", error);
      if (profileVerificationFeedbackEl) {
        profileVerificationFeedbackEl.textContent = "Verification failed. Please try again.";
        profileVerificationFeedbackEl.style.color = "#dc2626";
      }
    } finally {
      if (verifyProfileCodeBtn) {
        verifyProfileCodeBtn.disabled = false;
        verifyProfileCodeBtn.textContent = "Verify";
      }
    }
  });
}

// Cancel Profile Edit Button Event
if (cancelProfileEditBtn) {
  cancelProfileEditBtn.addEventListener("click", () => {
    // Reset to view mode
    if (profileVerificationSection) {
      profileVerificationSection.style.display = "none";
    }
    if (profileEditSection) {
      profileEditSection.style.display = "block";
    }
    if (profileSaveSection) {
      profileSaveSection.style.display = "none";
    }

    // Reset verification state
    profileEditVerified = false;
    profileVerificationCode = null;
    profileVerificationRequested = false;
    profileVerificationTimestamp = null;
    profileInitialVerificationStatus = null;

    if (profileVerificationFeedbackEl) {
      profileVerificationFeedbackEl.textContent = "";
    }
  });
}

if (profileForm && displayNameEditInput) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Only allow save if verified
    if (!profileEditVerified) {
      if (profileHintEditEl) {
        profileHintEditEl.textContent = "Please verify your identity first";
        profileHintEditEl.style.color = "#dc2626";
      }
      return;
    }

    // Rate limiting check
    const rateLimitResult = rateLimiter.isAllowed("profile_update", 3, 60000); // 3 attempts per minute
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil(rateLimitResult.remainingTime / 60000);
      if (profileHintEditEl) {
        profileHintEditEl.textContent = `Too many update attempts. Please wait ${minutes} minute(s).`;
        profileHintEditEl.style.color = "#dc2626";
      }
      return;
    }

    if (saveProfileBtn) {
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = "Saving...";
    }
    if (profileHintEditEl) {
      profileHintEditEl.textContent = "Saving…";
      profileHintEditEl.style.color = "#6b7280";
    }

    try {
      await saveMyProfile(displayNameEditInput.value);
      if (profileHintEditEl)
        profileHintEditEl.textContent = "Saved. Admin assignment list will show your name.";
      if (staffAccountNameEl) {
        const updatedName = String(displayNameEditInput.value || "").trim();
        if (updatedName) staffAccountNameEl.textContent = updatedName;
      }

      // Update display input
      if (displayNameInput) {
        displayNameInput.value = displayNameEditInput.value;
      }

      // Log successful profile update
      await logStaffAction(
        "profile_update",
        `Name changed to: ${displayNameEditInput.value}`,
        true
      );

      // Clear rate limiting on successful submission
      rateLimiter.clearAttempts("profile_update");

      // Reset to view mode after successful save
      setTimeout(() => {
        if (profileSaveSection) {
          profileSaveSection.style.display = "none";
        }
        if (profileEditSection) {
          profileEditSection.style.display = "block";
        }

        // Reset verification state
        profileEditVerified = false;
        profileVerificationCode = null;
      }, 2000);
    } catch (err) {
      console.error(err);
      if (profileHintEditEl) {
        profileHintEditEl.textContent = err.message || "Could not save profile.";
        profileHintEditEl.style.color = "#dc2626";
      }
      alert(err.message || "Could not save profile.");
    } finally {
      if (saveProfileBtn) {
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = "Save Changes";
      }
    }
  });
}

// Password Reset Functionality
const sendResetEmailBtn = document.getElementById("staff-send-reset-email");
const checkEmailStatusBtn = document.getElementById("staff-check-email-status");
const resetEmailDisplayEl = document.getElementById("reset-email-display");
const resetMessageEl = document.getElementById("reset-message");
const passwordResetFeedbackEl = document.getElementById("password-reset-feedback");

// Account Information Elements
const emailDisplayEl = document.getElementById("staff-email-display");
const emailStatusEl = document.getElementById("email-verification-status");
const emailStatusTextEl = document.getElementById("email-status-text");
const emailStatusIndicatorEl = document.getElementById("email-status-indicator");
const staffRoleDisplayEl = document.getElementById("staff-role-display");
const staffCreatedDisplayEl = document.getElementById("staff-created-display");
const emailVerificationActionsEl = document.getElementById("email-verification-actions");
const unverifiedEmailActionsEl = document.getElementById("unverified-email-actions");
const verifiedEmailInfoEl = document.getElementById("verified-email-info");
const verifyEmailBtn = document.getElementById("verify-email-btn");

// Password Reset Functions
async function sendPasswordResetEmailToUser() {
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }

  try {
    await sendPasswordResetEmail(auth, currentUser.email);
    await logStaffAction(
      "password_reset_sent",
      `Password reset email sent to ${currentUser.email}`,
      true
    );
    return true;
  } catch (error) {
    console.error("Password reset error:", error);
    await logStaffAction(
      "password_reset_sent",
      `Failed to send password reset: ${error.message}`,
      false
    );
    throw new Error("Failed to send password reset email. Please try again.");
  }
}

// Initialize password reset functionality
if (sendResetEmailBtn) {
  sendResetEmailBtn.addEventListener("click", async () => {
    if (!currentUser) {
      if (passwordResetFeedbackEl) {
        passwordResetFeedbackEl.textContent = "No authenticated user found";
        passwordResetFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Rate limiting check
    const rateLimitResult = rateLimiter.isAllowed("password_reset", 3, 300000); // 3 attempts per 5 minutes
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil(rateLimitResult.remainingTime / 60000);
      if (passwordResetFeedbackEl) {
        passwordResetFeedbackEl.textContent = `Too many reset attempts. Please wait ${minutes} minute(s).`;
        passwordResetFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (sendResetEmailBtn) {
      sendResetEmailBtn.disabled = true;
      sendResetEmailBtn.textContent = "Sending...";
    }

    try {
      await sendPasswordResetEmailToUser();

      if (passwordResetFeedbackEl) {
        passwordResetFeedbackEl.textContent =
          "✅ Password reset email sent! Please check your inbox and click the reset link.";
        passwordResetFeedbackEl.style.color = "#059669";
      }

      if (resetMessageEl) {
        resetMessageEl.innerHTML = `Password reset email sent to: <strong>${currentUser.email}</strong>. Please check your inbox.`;
        resetMessageEl.style.color = "#059669";
      }

      // Clear rate limiting on successful send
      rateLimiter.clearAttempts("password_reset");
    } catch (error) {
      console.error("Send reset error:", error);
      if (passwordResetFeedbackEl) {
        passwordResetFeedbackEl.textContent =
          error.message || "Failed to send password reset email";
        passwordResetFeedbackEl.style.color = "#dc2626";
      }
    } finally {
      if (sendResetEmailBtn) {
        sendResetEmailBtn.disabled = false;
        sendResetEmailBtn.textContent = "Send Password Reset Email";
      }
    }
  });
}

if (verifyEmailBtn) {
  verifyEmailBtn.addEventListener("click", async () => {
    if (!currentUser) {
      alert("No authenticated user found");
      return;
    }

    if (verifyEmailBtn) {
      verifyEmailBtn.disabled = true;
      verifyEmailBtn.textContent = "Sending...";
    }

    try {
      await sendEmailVerificationCode();

      // Show success message
      if (unverifiedEmailActionsEl) {
        const warningMsg = unverifiedEmailActionsEl.querySelector("p");
        if (warningMsg) {
          warningMsg.textContent =
            "✅ Verification email sent! Please check your inbox and click the verification link.";
          warningMsg.style.color = "#059669";
        }
      }

      // Hide button after sending
      if (verifyEmailBtn) {
        verifyEmailBtn.style.display = "none";
      }

      // Check verification status periodically
      let checkCount = 0;
      const checkInterval = setInterval(async () => {
        checkCount++;
        await updateEmailVerificationStatus();

        // Stop checking after 10 checks or if verified
        if (checkCount >= 10 || currentUser.emailVerified) {
          clearInterval(checkInterval);
        }
      }, 3000); // Check every 3 seconds
    } catch (error) {
      console.error("Send verification error:", error);
      if (unverifiedEmailActionsEl) {
        const warningMsg = unverifiedEmailActionsEl.querySelector("p");
        if (warningMsg) {
          warningMsg.textContent = `❌ Failed to send verification email: ${error.message}`;
          warningMsg.style.color = "#dc2626";
        }
      }
    } finally {
      if (verifyEmailBtn) {
        verifyEmailBtn.disabled = false;
        verifyEmailBtn.textContent = "Verify Email Address";
      }
    }
  });
}

// Enhanced password validation
function validatePasswordStrength(password) {
  const requirements = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
  };

  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const hasNoSpaces = !/\s/.test(password);

  const errors = [];
  if (password.length < requirements.minLength) {
    errors.push(`Minimum ${requirements.minLength} characters`);
  }
  if (requirements.requireUppercase && !hasUpperCase) {
    errors.push("Must include uppercase letter");
  }
  if (requirements.requireLowercase && !hasLowerCase) {
    errors.push("Must include lowercase letter");
  }
  if (requirements.requireNumbers && !hasNumbers) {
    errors.push("Must include numbers");
  }
  if (requirements.requireSpecialChars && !hasSpecialChar) {
    errors.push("Must include special characters (!@#$%^&* etc.)");
  }
  if (!hasNoSpaces) {
    errors.push("Cannot contain spaces");
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    strength: calculatePasswordStrength(password),
  };
}

function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 12) strength++;
  if (password.length >= 16) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength++;

  if (strength <= 2) return "Weak";
  if (strength <= 4) return "Medium";
  return "Strong";
}

// Profile Photo Event Listeners
if (changePhotoBtn) {
  changePhotoBtn.addEventListener("click", () => {
    if (photoUploadSection) {
      photoUploadSection.style.display = "block";
    }
    if (changePhotoBtn) {
      changePhotoBtn.style.display = "none";
    }

    if (photoUploadFeedbackEl) {
      photoUploadFeedbackEl.textContent = "";
    }
  });
}

if (selectPhotoBtn) {
  selectPhotoBtn.addEventListener("click", () => {
    if (profilePhotoInput) {
      profilePhotoInput.click();
    }
  });
}

if (profilePhotoInput) {
  profilePhotoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      if (photoUploadFeedbackEl) {
        photoUploadFeedbackEl.textContent = validation.error;
        photoUploadFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Store the selected file
    selectedPhotoFile = file;

    // Show preview section with upload button
    if (photoUploadSection) {
      photoUploadSection.style.display = "none";
    }
    if (photoPreviewSection) {
      photoPreviewSection.style.display = "block";
    }

    // Preview the image
    const reader = new FileReader();
    reader.onload = (e) => {
      if (selectedPhotoPreview) {
        selectedPhotoPreview.src = e.target.result;
      }
      if (selectedPhotoInfo) {
        selectedPhotoInfo.textContent = `${file.name} • ${(file.size / 1024).toFixed(1)}KB • ${file.type}`;
      }
    };
    reader.readAsDataURL(file);

    if (photoUploadFeedbackEl) {
      photoUploadFeedbackEl.textContent = `✅ ${file.name} selected (${(file.size / 1024).toFixed(1)}KB)`;
      photoUploadFeedbackEl.style.color = "#059669";
    }
  });
}

if (cancelPhotoBtn) {
  cancelPhotoBtn.addEventListener("click", () => {
    // Reset photo upload
    if (photoUploadSection) {
      photoUploadSection.style.display = "none";
    }
    if (changePhotoBtn) {
      changePhotoBtn.style.display = "block";
    }

    selectedPhotoFile = null;
    if (profilePhotoInput) {
      profilePhotoInput.value = "";
    }

    // Reset preview to current photo
    if (profilePhotoPreview && staffAvatarEl) {
      profilePhotoPreview.src = staffAvatarEl.src;
    }

    if (photoUploadFeedbackEl) {
      photoUploadFeedbackEl.textContent = "";
    }
  });
}

// Photo Verification Event Listeners
if (sendPhotoVerificationBtn) {
  sendPhotoVerificationBtn.addEventListener("click", async () => {
    if (!selectedPhotoFile) {
      if (photoVerificationFeedbackEl) {
        photoVerificationFeedbackEl.textContent = "Please select a photo first";
        photoVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Show verification section
    if (photoVerificationSection) {
      photoVerificationSection.style.display = "block";
    }
    if (photoUploadSection) {
      photoUploadSection.style.display = "none";
    }

    if (photoVerificationFeedbackEl) {
      photoVerificationFeedbackEl.textContent = "";
    }
  });
}

// Send Photo Verification Code Button Event
if (sendPhotoVerificationBtn) {
  sendPhotoVerificationBtn.addEventListener("click", async () => {
    if (!currentUser) {
      if (photoVerificationFeedbackEl) {
        photoVerificationFeedbackEl.textContent = "No authenticated user found";
        photoVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Rate limiting check
    const rateLimitResult = rateLimiter.isAllowed("photo_verification", 3, 300000); // 3 attempts per 5 minutes
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil(rateLimitResult.remainingTime / 60000);
      if (photoVerificationFeedbackEl) {
        photoVerificationFeedbackEl.textContent = `Too many verification attempts. Please wait ${minutes} minute(s).`;
        photoVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (sendPhotoVerificationBtn) {
      sendPhotoVerificationBtn.disabled = true;
      sendPhotoVerificationBtn.textContent = "Sending...";
    }

    try {
      await sendPhotoVerificationEmail();

      if (photoVerificationFeedbackEl) {
        photoVerificationFeedbackEl.innerHTML = `✅ Verification code sent to <strong>${currentUser.email}</strong>! Please check your inbox and enter 6-digit code below.`;
        photoVerificationFeedbackEl.style.color = "#059669";
      }

      // Show code input section
      if (photoCodeInputSection) {
        photoCodeInputSection.style.display = "block";
      }

      // Reset button state
      if (sendPhotoVerificationBtn) {
        sendPhotoVerificationBtn.disabled = false;
        sendPhotoVerificationBtn.textContent = "Resend Code";
      }
    } catch (error) {
      console.error("Send photo verification error:", error);
      if (photoVerificationFeedbackEl) {
        photoVerificationFeedbackEl.textContent =
          error.message || "Failed to send verification code";
        photoVerificationFeedbackEl.style.color = "#dc2626";
      }
    } finally {
      // Reset button state
      if (sendPhotoVerificationBtn) {
        sendPhotoVerificationBtn.disabled = false;
        sendPhotoVerificationBtn.textContent = "Send Verification Code";
      }
    }
  });
}

if (cancelPhotoUploadBtn) {
  cancelPhotoUploadBtn.addEventListener("click", () => {
    // Reset to upload section
    if (photoPreviewSection) {
      photoPreviewSection.style.display = "none";
    }
    if (photoUploadSection) {
      photoUploadSection.style.display = "block";
    }

    // Clear selected file
    selectedPhotoFile = null;
    if (profilePhotoInput) {
      profilePhotoInput.value = "";
    }

    // Clear preview
    if (selectedPhotoPreview) {
      selectedPhotoPreview.src = "";
    }
    if (selectedPhotoInfo) {
      selectedPhotoInfo.textContent = "";
    }

    if (photoPreviewFeedbackEl) {
      photoPreviewFeedbackEl.textContent = "";
    }
  });
}

if (cancelPhotoChangeBtn) {
  cancelPhotoChangeBtn.addEventListener("click", () => {
    // Reset to upload section
    if (photoVerificationSection) {
      photoVerificationSection.style.display = "none";
    }
    if (photoUploadSection) {
      photoUploadSection.style.display = "block";
    }

    // Reset verification state
    photoChangeVerified = false;
    photoVerificationCode = null;
    photoVerificationRequested = false;
    photoVerificationTimestamp = null;
    photoInitialVerificationStatus = null;

    if (photoVerificationFeedbackEl) {
      photoVerificationFeedbackEl.textContent = "";
    }
  });
}

// Email Change Event Listeners
if (changeEmailBtn) {
  changeEmailBtn.addEventListener("click", () => {
    if (emailChangeSection) {
      emailChangeSection.style.display = "block";
    }
    if (changeEmailBtn) {
      changeEmailBtn.style.display = "none";
    }

    if (emailChangeFeedbackEl) {
      emailChangeFeedbackEl.textContent = "";
    }
  });
}

if (cancelEmailChangeBtn) {
  cancelEmailChangeBtn.addEventListener("click", () => {
    // Reset email change section
    if (emailChangeSection) {
      emailChangeSection.style.display = "none";
    }
    if (changeEmailBtn) {
      changeEmailBtn.style.display = "block";
    }

    // Clear inputs
    if (newEmailInput) newEmailInput.value = "";
    if (confirmEmailInput) confirmEmailInput.value = "";

    // Reset state
    pendingEmailChange = null;

    if (emailChangeFeedbackEl) {
      emailChangeFeedbackEl.textContent = "";
    }
  });
}

if (sendEmailChangeBtn) {
  sendEmailChangeBtn.addEventListener("click", async () => {
    const newEmail = newEmailInput?.value?.trim();
    const confirmEmail = confirmEmailInput?.value?.trim();

    if (!newEmail || !confirmEmail) {
      if (emailChangeFeedbackEl) {
        emailChangeFeedbackEl.textContent = "Please enter both email addresses";
        emailChangeFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (!validateEmail(newEmail)) {
      if (emailChangeFeedbackEl) {
        emailChangeFeedbackEl.textContent = "Please enter a valid email address";
        emailChangeFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (newEmail !== confirmEmail) {
      if (emailChangeFeedbackEl) {
        emailChangeFeedbackEl.textContent = "Email addresses do not match";
        emailChangeFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (newEmail === currentUser.email) {
      if (emailChangeFeedbackEl) {
        emailChangeFeedbackEl.textContent = "New email must be different from current email";
        emailChangeFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Store pending email change and show verification
    pendingEmailChange = newEmail;

    if (emailChangeSection) {
      emailChangeSection.style.display = "none";
    }
    if (emailVerificationSection) {
      emailVerificationSection.style.display = "block";
    }

    if (emailChangeFeedbackEl) {
      emailChangeFeedbackEl.textContent = `✅ Email validation passed. Please verify your current email to complete the change to ${newEmail}`;
      emailChangeFeedbackEl.style.color = "#059669";
    }
  });
}

if (sendCurrentEmailVerificationBtn) {
  sendCurrentEmailVerificationBtn.addEventListener("click", async () => {
    if (!currentUser) {
      if (emailVerificationFeedbackEl) {
        emailVerificationFeedbackEl.textContent = "No authenticated user found";
        emailVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    // Rate limiting check
    const rateLimitResult = rateLimiter.isAllowed("email_change_verification", 3, 300000); // 3 attempts per 5 minutes
    if (!rateLimitResult.allowed) {
      const minutes = Math.ceil(rateLimitResult.remainingTime / 60000);
      if (emailVerificationFeedbackEl) {
        emailVerificationFeedbackEl.textContent = `Too many verification attempts. Please wait ${minutes} minute(s).`;
        emailVerificationFeedbackEl.style.color = "#dc2626";
      }
      return;
    }

    if (sendCurrentEmailVerificationBtn) {
      sendCurrentEmailVerificationBtn.disabled = true;
      sendCurrentEmailVerificationBtn.textContent = "Sending...";
    }

    try {
      await sendCurrentEmailVerification();

      if (emailVerificationFeedbackEl) {
        emailVerificationFeedbackEl.innerHTML = `✅ Verification email sent to <strong>${currentUser.email}</strong>! Please check your inbox and click the verification link.`;
        emailVerificationFeedbackEl.style.color = "#059669";
      }

      // Start checking verification status periodically
      let checkCount = 0;
      const checkInterval = setInterval(async () => {
        checkCount++;

        try {
          const isVerified = await checkCurrentEmailVerification();

          if (isVerified && pendingEmailChange) {
            clearInterval(checkInterval);

            // Update the email
            await updateEmailAddress(pendingEmailChange);

            // Update UI
            if (currentEmailDisplay) {
              currentEmailDisplay.textContent = pendingEmailChange;
            }

            // Reset UI
            if (emailVerificationSection) {
              emailVerificationSection.style.display = "none";
            }
            if (changeEmailBtn) {
              changeEmailBtn.style.display = "block";
            }

            if (emailVerificationFeedbackEl) {
              emailVerificationFeedbackEl.innerHTML = `✅ Email successfully changed to <strong>${pendingEmailChange}</strong>! Please check your new email for verification.`;
              emailVerificationFeedbackEl.style.color = "#059669";
            }

            // Clear state
            pendingEmailChange = null;
            emailChangeVerified = false;
          }
        } catch (error) {
          console.error("Error checking email verification status:", error);
        }

        // Stop checking after 20 attempts (about 1 minute)
        if (checkCount >= 20) {
          clearInterval(checkInterval);
          if (emailVerificationFeedbackEl) {
            emailVerificationFeedbackEl.innerHTML +=
              '<br><span style="color: #f59e0b;">Verification check timed out. Please click the verification link in your email and refresh this page.</span>';
          }
        }
      }, 3000); // Check every 3 seconds
    } catch (error) {
      console.error("Send email verification error:", error);
      if (emailVerificationFeedbackEl) {
        emailVerificationFeedbackEl.textContent =
          error.message || "Failed to send verification email";
        emailVerificationFeedbackEl.style.color = "#dc2626";
      }
    } finally {
      if (sendCurrentEmailVerificationBtn) {
        sendCurrentEmailVerificationBtn.disabled = false;
        sendCurrentEmailVerificationBtn.textContent = "Send Verification Email";
      }
    }
  });
}

if (cancelEmailVerificationBtn) {
  cancelEmailVerificationBtn.addEventListener("click", () => {
    // Reset to email change section
    if (emailVerificationSection) {
      emailVerificationSection.style.display = "none";
    }
    if (emailChangeSection) {
      emailChangeSection.style.display = "block";
    }

    // Reset verification state
    emailChangeVerified = false;
    pendingEmailChange = null;

    if (emailVerificationFeedbackEl) {
      emailVerificationFeedbackEl.textContent = "";
    }
  });
}

// Verification code functions
async function generateVerificationCode() {
  // Generate 6-digit code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function storeVerificationCode(userId, code, type = "profile") {
  const codeDoc = {
    userId: userId,
    code: code,
    type: type, // 'profile', 'photo', 'email_change'
    createdAt: Timestamp.now(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    used: false,
  };

  const docRef = doc(collection(db, "verification_codes"), `${userId}_${type}_${Date.now()}`);
  await setDoc(docRef, codeDoc);
  return docRef.id;
}

async function sendVerificationEmail(email, code, type = "profile") {
  const subject =
    type === "profile"
      ? "Profile Edit Verification Code"
      : type === "photo"
        ? "Photo Change Verification Code"
        : "Email Change Verification Code";

  const message =
    type === "profile"
      ? `Your verification code for profile editing is: ${code}\n\nThis code will expire in 10 minutes.`
      : type === "photo"
        ? `Your verification code for photo change is: ${code}\n\nThis code will expire in 10 minutes.`
        : `Your verification code for email change is: ${code}\n\nThis code will expire in 10 minutes.`;

  // For now, use alert to show the code (in production, you'd use a real email service)
  alert(`${subject}\n\n${message}\n\n(Email would be sent to: ${email})`);

  // Log the action
  await logStaffAction(
    "verification_code_sent",
    `Verification code sent to ${email} for ${type}`,
    true
  );
}

async function verifyCode(userId, code, type = "profile") {
  const codesRef = collection(db, "verification_codes");
  const q = query(
    codesRef,
    where("userId", "==", userId),
    where("code", "==", code),
    where("type", "==", type),
    where("used", "==", false),
    where("expiresAt", ">", Timestamp.now())
  );

  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return false;
  }

  // Mark the code as used
  const codeDoc = querySnapshot.docs[0];
  await updateDoc(codeDoc.ref, { used: true });

  return true;
}

async function sendEmailVerificationCode() {
  if (!currentUser) {
    throw new Error("No authenticated user found");
  }

  try {
    // Generate and store verification code
    const code = await generateVerificationCode();
    await storeVerificationCode(currentUser.uid, code, "email");

    // Send verification email with code
    await sendVerificationEmail(currentUser.email, code, "email");

    return true;
  } catch (error) {
    console.error("Email verification error:", error);
    await logStaffAction(
      "email_verification_sent",
      `Failed to send verification: ${error.message}`,
      false
    );
    throw error;
  }
}

async function checkEmailVerification() {
  if (!currentUser) return false;

  try {
    await reload(currentUser);
    return currentUser.emailVerified;
  } catch (error) {
    console.error("Error checking email verification:", error);
    return false;
  }
}

if (staffAccountChip && displayNameInput) {
  staffAccountChip.addEventListener("click", () => {
    showStaffSection("my-account");
    displayNameInput.focus();
    displayNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

if (ordersListEl) {
  ordersListEl.addEventListener("change", (e) => {
    const t = e.target;
    if (!t.classList.contains("staff-status-select")) return;
    const id = t.getAttribute("data-order-id");
    const val = t.value;
    if (!id || !val) return;
    updateOrderStatus(id, val);
  });

  // Add event listener for manual override buttons
  ordersListEl.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.classList.contains("apply-manual-date-btn")) return;

    const orderId = t.getAttribute("data-order-id");
    if (!orderId) return;

    // Find the corresponding date input
    const dateInput = document.querySelector(`.manual-delivery-date[data-order-id="${orderId}"]`);
    if (!dateInput) return;

    const selectedDate = dateInput.value;
    if (!selectedDate) {
      alert("Please select a delivery date first.");
      return;
    }

    // Confirm the manual override
    if (
      confirm(
        `Set manual delivery date to ${selectedDate}?\n\nThis will override the automatic delivery estimate.`
      )
    ) {
      applyManualDeliveryDate(orderId, selectedDate);
    }
  });
}

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
