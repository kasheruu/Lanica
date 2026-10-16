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
  deleteField,
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
import {
  subscribeToAllChats,
  subscribeToMessages,
  sendChatMessage,
  uploadChatAttachment,
  markOrderMessagesAsRead,
  unsendChatMessage,
  showMessengerUnsendModal,
  archiveChatSession,
  unarchiveChatSession,
  deleteConversation,
} from "./chatService.js";
import { recordAuditLog } from "./auditService.js";
import { showToast, showConfirmModal, showAlertModal } from "./uiFeedback.js";
import {
  renderPagination,
  showTableSkeleton,
  renderTableEmptyState,
} from "./paginationService.js";

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

const staffPlacedStatEl = document.getElementById("staff-placed");
const acceptedStatEl = document.getElementById("staff-accepted");
const processingStatEl = document.getElementById("staff-processing");
const shippedStatEl = document.getElementById("staff-shipped");
const deliveredStatEl = document.getElementById("staff-delivered");

const staffOrdersSearchInput = document.getElementById("staff-orders-search-input");
const staffOrdersSearchClear = document.getElementById("staff-orders-search-clear");
const staffOrdersStatusFilterEl = document.getElementById("staff-orders-status-filter");

const staffOrdersTableContainer = document.getElementById("staff-orders-table-container");
const staffHistoryTableContainer = document.getElementById("staff-history-table-container");

const cardFilterPlaced = document.getElementById("card-filter-placed");
const cardFilterAccepted = document.getElementById("card-filter-accepted");
const cardFilterProcessing = document.getElementById("card-filter-processing");
const cardFilterShipped = document.getElementById("card-filter-shipped");
const cardFilterDelivered = document.getElementById("card-filter-delivered");

const profileForm = document.getElementById("staff-profile-form");
const displayNameInput = document.getElementById("staff-display-name");
const displayNameEditInput = document.getElementById("staff-display-name-edit");
const phoneEditInput = document.getElementById("staff-phone-edit");
const firstNameInput = document.getElementById("staff-first-name");
const lastNameInput = document.getElementById("staff-last-name");
const emailAddressInput = document.getElementById("staff-email-address");
const saveProfileBtn = document.getElementById("staff-save-profile");
const profileHintEl = document.getElementById("staff-profile-hint");
const profileHintEditEl = document.getElementById("staff-profile-hint-edit");
const staffPhoneDisplay = document.getElementById("staff-phone-display");

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
        "Too many verification requests. Please wait a few minutes before trying again.",
        { cause: error }
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.", { cause: error });
    } else {
      throw new Error(error.message || "Failed to send verification code. Please try again.", { cause: error });
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
    throw new Error("Failed to upload profile photo", { cause: error });
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
        "Too many verification requests. Please wait a few minutes before trying again.",
        { cause: error }
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.", { cause: error });
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
      throw new Error("Failed to send verification email. Please try again later.", { cause: error });
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
        "Too many verification requests. Please wait a few minutes before trying again.",
        { cause: error }
      );
    } else if (error.code === "auth/user-not-found") {
      throw new Error("User account not found. Please sign in again.", { cause: error });
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
      throw new Error("Failed to send verification email. Please try again later.", { cause: error });
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
    throw new Error("Failed to update email address. Please try again.", { cause: error });
  }
}

const staffProfileAvatarEl = document.getElementById("staff-profile-avatar");
const staffProfilePhotoInput = document.getElementById("staff-profile-photo-input");
const staffEditPhotoBtn = document.getElementById("staff-edit-photo-btn");
const staffRemovePhotoBtn = document.getElementById("staff-remove-photo-btn");
const staffAccountNameEl = document.getElementById("staff-account-name");

function setStaffNameAcrossUi(name) {
  const label = name || "My Profile";
  if (staffAccountNameEl) staffAccountNameEl.textContent = label;
}
const navStaffDashboard = document.getElementById("nav-staff-dashboard");
const navOrders = document.getElementById("nav-orders");
const navStaffWorkshop = document.getElementById("nav-staff-workshop");
const navStaffChats = document.getElementById("nav-staff-chats");
const navStaffInventory = document.getElementById("nav-staff-inventory");
const navStaffAnalytics = document.getElementById("nav-staff-analytics");
const navMyAccount = document.getElementById("nav-my-account");

const staffDashboardSection = document.getElementById("staff-dashboard-section");
const staffOrdersSection = document.getElementById("staff-orders-section");
const staffWorkshopSection = document.getElementById("staff-workshop-section");
const staffChatsSection = document.getElementById("staff-chats-section");
const staffInventorySection = document.getElementById("staff-inventory-section");
const staffAnalyticsSection = document.getElementById("staff-analytics-section");
const staffAccountSection = document.getElementById("staff-account-section");
const staffHeaderTitle = document.getElementById("staff-header-title");
const staffHeaderBlurb = document.getElementById("staff-header-blurb");

const STAFF_HEADER_DASHBOARD_HTML = {
  title: "Staff Operations Dashboard",
  blurb: "Overview of your assigned craftsmanship pipeline, workshop crafting queue, and real-time customer consultations.",
};
const STAFF_HEADER_ORDERS_HTML = {
  title: "Staff Workshop & Order Hub",
  blurb:
    'Crafting progression: <strong>Deposit Verified → In Production → Quality Checked → Shipped → Delivered</strong>. Check item custom specs, track workshop progression, and fulfill customer orders.',
};
const STAFF_HEADER_WORKSHOP_HTML = {
  title: "Workshop Crafting Pipeline",
  blurb: "Visual Workshop Kanban Board: Track timber allocation, carpentry, upholstery custom specifications, and quality inspection stages.",
};
const STAFF_HEADER_CHATS_HTML = {
  title: "Customer Support & Consultations",
  blurb: "Direct chat with customers for custom dimensions, wood stains, fabric swatches, and WIP photos.",
};
const STAFF_HEADER_INVENTORY_HTML = {
  title: "Workshop Inventory Workspace",
  blurb: "Track hardwood stocks, fabric rolls, upholstery foam, and crafting materials.",
};
const STAFF_HEADER_ANALYTICS_HTML = {
  title: "Production Turnaround & Performance",
  blurb: "Monitor crafting lead times, quality inspection pass rates, and completion stats.",
};

let currentUser = null;
let currentStaffSection = "dashboard";
let staffPermissions = {
  manageOrders: true,
  inventoryControl: false,
  viewAnalytics: false,
  manageUsers: false,
};
let allStaffOrders = [];
let allAssignedOrders = [];
let staffOrdersSearchQuery = "";
let staffOrdersStatusFilter = "all";
let staffOrdersCurrentPage = 1;
let staffOrdersPerPage = 10;

let staffHistoryCurrentPage = 1;
let staffHistoryPerPage = 10;

let activeReceiptOrder = null;
let activeReceiptTab = "voucher";

const LANICA_BRANCHES = {
  calamba: {
    key: "calamba",
    name: "Calamba Branch",
    title: "LANICA'S SOFA SALA SET CALAMBA BRANCH",
    address: "MILAN PRESTIGE BLDG. BRGY. HALANG NATIONAL HIGHWAY CALAMBA CITY LAGUNA",
    contact: "0993-287-4937",
    voucherLocation: "MILAN PRESTIGE BUILDING, BRGY. HALANG CALAMBA LAGUNA",
  },
  pila: {
    key: "pila",
    name: "Pila Branch",
    title: "LANICA'S SOFA SALA SET PILA BRANCH",
    address: "VILLASOL 1, BRGY. LABUIN NATIONAL HIGHWAY, PILA, LAGUNA",
    contact: "0993-287-4937",
    voucherLocation: "VILLASOL 1, BRGY. LABUIN NATIONAL HIGHWAY, PILA, LAGUNA",
  },
};

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
          showToast("Email verified successfully! Your verification status has been updated.", "success");
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

function renderStaffDashboard(orders) {
  const activeOrders = (orders || []).filter((o) => !o.isDeleted && !isOrderCompleted(o));
  const myUid = currentUser?.uid;

  const myOrdersCount = activeOrders.filter((o) => o.assignedToUid === myUid).length;
  const inProdCount = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "in production").length;
  const qcCount = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "quality checked").length;
  const completedByMeCount = (orders || []).filter(
    (o) => !o.isDeleted && isOrderCompleted(o) && o.assignedToUid === myUid
  ).length;

  const elMyOrders = document.getElementById("staff-dash-my-orders");
  const elInProd = document.getElementById("staff-dash-in-prod");
  const elQc = document.getElementById("staff-dash-qc-pending");
  const elCompleted = document.getElementById("staff-dash-completed");

  if (elMyOrders) elMyOrders.textContent = String(myOrdersCount);
  if (elInProd) elInProd.textContent = String(inProdCount);
  if (elQc) elQc.textContent = String(qcCount);
  if (elCompleted) elCompleted.textContent = String(completedByMeCount);

  // Watchlist table
  const tbody = document.getElementById("staff-dashboard-watchlist-body");
  const badgeEl = document.getElementById("staff-dash-watchlist-badge");
  if (!tbody) return;

  const workshopStages = ["downpayment confirmed", "in production", "quality checked"];
  const workshopPieces = activeOrders.filter((o) => workshopStages.includes(normalizeOrderStatus(o.status)));

  if (badgeEl) {
    badgeEl.textContent = `${workshopPieces.length} Pieces in Workshop`;
  }

  if (workshopPieces.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #64748b;">No active furniture orders currently in crafting or inspection.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  workshopPieces.slice(0, 10).forEach((order) => {
    const customer = resolveCustomerDisplay(order);
    const st = normalizeOrderStatus(order.status);
    const isAssignedToMe = order.assignedToUid === myUid;

    let stageBadge = `<span class="badge" style="background:#e0e7ff; color:#3730a3; padding: 3px 8px; border-radius: 9999px; font-size: 0.76rem; font-weight: 700;">Deposit Verified</span>`;
    if (st === "in production") {
      stageBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; padding: 3px 8px; border-radius: 9999px; font-size: 0.76rem; font-weight: 700;">In Production</span>`;
    } else if (st === "quality checked") {
      stageBadge = `<span class="badge" style="background:#f3e8ff; color:#6b21a8; padding: 3px 8px; border-radius: 9999px; font-size: 0.76rem; font-weight: 700;">QC Passed</span>`;
    }

    const itemsSummaryHtml = formatOrderItemsSummaryHtml(order.items);
    const leadTime = order.estimatedLeadTime || "14–21 Days";

    const assignedDisplay = order.assignedToUid
      ? isAssignedToMe
        ? `<span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 700; padding: 3px 8px; border-radius: 9999px; font-size: 0.76rem;">You</span>`
        : `<span style="font-size: 0.82rem; font-weight: 500; color: #334155;">${escapeHtml(order.assignedToName || "Staff Member")}</span>`
      : `<button type="button" class="btn-primary btn-claim-order" data-order-id="${escapeHtml(order.id)}" style="padding: 4px 8px; font-size: 0.74rem; border-radius: 6px; white-space: nowrap; background: #6b4423; color: #fff; border: none; cursor: pointer; font-weight: 600;">Claim</button>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Order">
        <button type="button" class="btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: #2563eb; font-weight: 700; font-size: 0.88rem; font-family: inherit;">
          #${escapeHtml(order.id.slice(0, 8))}…
        </button>
      </td>
      <td data-label="Customer">
        <strong style="font-size: 0.86rem; color: #1e293b;">${escapeHtml(String(customer))}</strong>
      </td>
      <td class="order-items-cell" data-label="Items & Specs">${itemsSummaryHtml}</td>
      <td data-label="Workshop Stage">${stageBadge}</td>
      <td data-label="Lead Time"><span style="font-size: 0.82rem; color: #64748b;">🕒 ${escapeHtml(leadTime)}</span></td>
      <td data-label="Assigned Staff">${assignedDisplay}</td>
      <td data-label="Quick Action">
        <button type="button" class="btn-secondary btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="padding: 5px 10px; font-size: 0.76rem; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; white-space: nowrap;">
          View Details
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderStaffWorkshopQueue(orders) {
  const containerQueued = document.getElementById("staff-kanban-list-queued");
  const containerProduction = document.getElementById("staff-kanban-list-production");
  const containerQC = document.getElementById("staff-kanban-list-qc");
  const containerShipped = document.getElementById("staff-kanban-list-shipped");

  if (!containerQueued || !containerProduction || !containerQC || !containerShipped) return;

  const activeOrders = (orders || []).filter(
    (o) => !isOrderCompleted(o) && !o.isDeleted
  );

  const groupQueued = activeOrders.filter((o) => {
    const st = normalizeOrderStatus(o.status);
    return st === "downpayment confirmed" || st === "placed";
  });
  const groupProduction = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "in production");
  const groupQC = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "quality checked");
  const groupShipped = activeOrders.filter((o) => normalizeOrderStatus(o.status) === "shipped");

  const elQueued = document.getElementById("staff-ws-deposit-verified");
  const elInProd = document.getElementById("staff-ws-in-production");
  const elQc = document.getElementById("staff-ws-qc-passed");
  const elShipped = document.getElementById("staff-ws-shipped");

  if (elQueued) elQueued.textContent = String(groupQueued.length);
  if (elInProd) elInProd.textContent = String(groupProduction.length);
  if (elQc) elQc.textContent = String(groupQC.length);
  if (elShipped) elShipped.textContent = String(groupShipped.length);

  const setBadge = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(count);
  };
  setBadge("staff-kanban-count-queued", groupQueued.length);
  setBadge("staff-kanban-count-production", groupProduction.length);
  setBadge("staff-kanban-count-qc", groupQC.length);
  setBadge("staff-kanban-count-shipped", groupShipped.length);

  const createKanbanCard = (order, nextStage, nextLabel) => {
    const customer = resolveCustomerDisplay(order);
    const items = Array.isArray(order.items) ? order.items : [];

    let totalQty = 0;
    items.forEach((it) => {
      totalQty += Number(it.quantity || 1);
    });

    const totalVal = Number(order.totalAmount ?? order.total ?? 0);
    const totalAmountStr = `₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const specsHTML = items
      .map((it) => {
        const itemQty = Number(it.quantity || 1);
        const itemPrice = Number(it.price || 0);
        const itemSubtotal = Number(it.subtotal || itemPrice * itemQty);
        const notes = it.customNotes
          ? `<div class="kanban-custom-specs" style="margin-top:4px; font-size: 0.74rem; color: #b45309; background: #fffbeb; padding: 2px 6px; border-radius: 4px;"><strong>Custom:</strong> ${escapeHtml(it.customNotes)}</div>`
          : "";
        return `
          <div style="margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px dashed #e2e8f0;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
              <strong>${escapeHtml(it.name || it.title || "Item")}</strong>
              <span style="font-weight: 700; color: #0f172a; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 0.74rem;">Qty: ${itemQty}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.76rem; color: #64748b; margin-top: 2px;">
              <span>Material: ${escapeHtml(it.material || "Standard")}</span>
              <span style="font-weight: 600; color: #334155;">₱${itemSubtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            ${notes}
          </div>
        `;
      })
      .join("");

    const card = document.createElement("div");
    card.className = "kanban-card";
    card.innerHTML = `
      <div class="kanban-card-header" style="padding-bottom: 6px; border-bottom: 1px solid #f1f5f9; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div class="kanban-order-id" style="font-weight:700; color:#0f172a;">#${escapeHtml(order.id.slice(0, 8))}</div>
          <div class="kanban-customer-name" style="font-size:0.8rem; color:#475569;">${escapeHtml(String(customer))}</div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.72rem; color: #c2410c; background: #fff7ed; padding: 2px 6px; border-radius: 6px; font-weight: 600; display: inline-block;">${escapeHtml(order.orderType || "Made-to-Order")}</span>
          <div style="font-size:0.85rem; font-weight:700; color:#0f172a; margin-top:3px;">${totalAmountStr}</div>
        </div>
      </div>
      <div class="kanban-items-list" style="margin-bottom: 8px;">${specsHTML}</div>
      <div class="kanban-card-footer" style="display: flex; justify-content: space-between; align-items: center; padding-top: 6px; border-top: 1px solid #f1f5f9;">
        <div>
          <span class="kanban-lead-time" style="font-size:0.73rem; color:#64748b; display:block;">🕒 ${escapeHtml(order.estimatedLeadTime || "14–21 Days")}</span>
          <span style="font-size: 0.72rem; font-weight: 700; color: #334155;">Total Qty: ${totalQty} items</span>
        </div>
        <div style="display: flex; gap: 6px;">
          ${
            nextStage
              ? `<button type="button" class="btn-primary btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="${escapeHtml(nextStage)}" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; cursor: pointer; white-space: nowrap;">${escapeHtml(nextLabel)}</button>`
              : ""
          }
          <button type="button" class="btn-secondary btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff;">View</button>
        </div>
      </div>
    `;
    return card;
  };

  const populateColumn = (container, list, nextStage, nextLabel, emptyText) => {
    container.innerHTML = "";
    if (list.length === 0) {
      container.innerHTML = `<div class="kanban-empty" style="text-align:center; padding: 24px 12px; color: #94a3b8; font-size: 0.84rem;">${emptyText}</div>`;
      return;
    }
    list.forEach((order) => {
      container.appendChild(createKanbanCard(order, nextStage, nextLabel));
    });
  };

  populateColumn(containerQueued, groupQueued, "in production", "Start Production", "No queued orders");
  populateColumn(containerProduction, groupProduction, "quality checked", "Pass QC", "No orders in crafting");
  populateColumn(containerQC, groupQC, "shipped", "Dispatch / Ship", "No orders awaiting dispatch");
  populateColumn(containerShipped, groupShipped, "delivered", "Mark Delivered", "No recently shipped orders");
}

function renderStaffPermissionsPills(perms) {
  const container = document.getElementById("staff-permissions-badges");
  if (!container) return;
  container.innerHTML = "";
  const list = [
    { key: "manageOrders", label: "Orders Management", granted: perms.manageOrders !== false },
    { key: "inventoryControl", label: "Inventory Control", granted: !!perms.inventoryControl },
    { key: "viewAnalytics", label: "View Analytics", granted: !!perms.viewAnalytics },
    { key: "manageUsers", label: "Users Management", granted: !!perms.manageUsers },
  ];
  list.forEach((item) => {
    const span = document.createElement("span");
    span.className = "badge";
    span.style.cssText = item.granted
      ? "background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; font-weight: 600;"
      : "background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0; font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; text-decoration: line-through;";
    span.textContent = item.label;
    container.appendChild(span);
  });
}

function showStaffSection(name) {
  // Role scope permission enforcement
  if (name === "inventory" && !staffPermissions.inventoryControl) {
    showToast("You do not have permission to access the Inventory module.", "error");
    name = "dashboard";
  }
  if (name === "analytics" && !staffPermissions.viewAnalytics) {
    showToast("You do not have permission to access the Analytics module.", "error");
    name = "dashboard";
  }

  currentStaffSection = name;

  const showDashboard = name === "dashboard";
  const showOrders = name === "orders";
  const showWorkshop = name === "workshop";
  const showChats = name === "chats";
  const showInventory = name === "inventory";
  const showAnalytics = name === "analytics";

  if (staffDashboardSection) staffDashboardSection.classList.toggle("is-hidden", !showDashboard);
  if (staffOrdersSection) staffOrdersSection.classList.toggle("is-hidden", !showOrders);
  if (staffWorkshopSection) staffWorkshopSection.classList.toggle("is-hidden", !showWorkshop);
  if (staffChatsSection) staffChatsSection.classList.toggle("is-hidden", !showChats);
  if (staffInventorySection) staffInventorySection.classList.toggle("is-hidden", !showInventory);
  if (staffAnalyticsSection) staffAnalyticsSection.classList.toggle("is-hidden", !showAnalytics);

  if (navStaffDashboard) navStaffDashboard.classList.toggle("active", showDashboard);
  if (navOrders) navOrders.classList.toggle("active", showOrders);
  if (navStaffWorkshop) navStaffWorkshop.classList.toggle("active", showWorkshop);
  if (navStaffChats) navStaffChats.classList.toggle("active", showChats);
  if (navStaffInventory) navStaffInventory.classList.toggle("active", showInventory);
  if (navStaffAnalytics) navStaffAnalytics.classList.toggle("active", showAnalytics);

  if (staffHeaderTitle && staffHeaderBlurb) {
    let block = STAFF_HEADER_DASHBOARD_HTML;
    if (showOrders) block = STAFF_HEADER_ORDERS_HTML;
    else if (showWorkshop) block = STAFF_HEADER_WORKSHOP_HTML;
    else if (showChats) block = STAFF_HEADER_CHATS_HTML;
    else if (showInventory) block = STAFF_HEADER_INVENTORY_HTML;
    else if (showAnalytics) block = STAFF_HEADER_ANALYTICS_HTML;

    staffHeaderTitle.textContent = block.title;
    staffHeaderBlurb.innerHTML = block.blurb;
  }

  if (showDashboard) renderStaffDashboard(allStaffOrders);
  if (showWorkshop) renderStaffWorkshopQueue(allStaffOrders);
}

if (navStaffDashboard) {
  navStaffDashboard.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("dashboard");
  });
}

if (navOrders) {
  navOrders.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("orders");
  });
}

if (navStaffWorkshop) {
  navStaffWorkshop.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("workshop");
  });
}

if (navStaffChats) {
  navStaffChats.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("chats");
  });
}

if (navStaffInventory) {
  navStaffInventory.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("inventory");
  });
}

if (navStaffAnalytics) {
  navStaffAnalytics.addEventListener("click", (e) => {
    e.preventDefault();
    showStaffSection("analytics");
  });
}

// Shortcuts inside Staff Dashboard
const staffDashBtnWorkshop = document.getElementById("staff-dash-btn-workshop");
const staffDashBtnOrders = document.getElementById("staff-dash-btn-orders");
const staffDashBtnChats = document.getElementById("staff-dash-btn-chats");

if (staffDashBtnWorkshop) {
  staffDashBtnWorkshop.addEventListener("click", () => showStaffSection("workshop"));
}
if (staffDashBtnOrders) {
  staffDashBtnOrders.addEventListener("click", () => showStaffSection("orders"));
}
if (staffDashBtnChats) {
  staffDashBtnChats.addEventListener("click", () => showStaffSection("chats"));
}

async function removeStaffProfilePhoto() {
  if (!currentUser) return;
  const confirmed = await showConfirmModal({
    title: "Remove Profile Photo",
    message: "Are you sure you want to remove your profile photo?",
    confirmText: "Remove Photo",
    cancelText: "Cancel",
    isDestructive: true,
    icon: "delete",
  });
  if (!confirmed) return;
  try {
    await setDoc(
      doc(db, "users", currentUser.uid),
      {
        photoURL: deleteField(),
        profilePic: deleteField(),
        profilePhoto: deleteField(),
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );
    await loadMyProfile();
    showToast("Profile photo removed.", "info");
  } catch (err) {
    console.error(err);
    showToast("Could not remove photo. Try again.", "error");
  }
}

if (staffEditPhotoBtn && staffProfilePhotoInput) {
  staffEditPhotoBtn.addEventListener("click", () => staffProfilePhotoInput.click());
}

if (staffProfilePhotoInput) {
  staffProfilePhotoInput.addEventListener("change", async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || !currentUser) return;
    const validation = validateImageFile(file);
    if (!validation.isValid) {
      showToast(validation.error, "warning");
      return;
    }
    try {
      if (staffEditPhotoBtn) staffEditPhotoBtn.disabled = true;
      await uploadProfilePhoto(file);
      await loadMyProfile();
      showToast("Profile photo updated successfully!", "success");
    } catch (err) {
      showToast(err.message || "Could not update photo", "error");
    } finally {
      if (staffEditPhotoBtn) staffEditPhotoBtn.disabled = false;
    }
  });
}

if (staffRemovePhotoBtn) {
  staffRemovePhotoBtn.addEventListener("click", () => {
    removeStaffProfilePhoto();
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

function validateInput(input, type) {
  if (!input || typeof input !== "string") {
    return { isValid: false, error: `${type} is required`, sanitized: "" };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { isValid: false, error: `${type} cannot be empty`, sanitized: "" };
  }

  if (type === "name") {
    if (trimmed.length < 2) {
      return { isValid: false, error: "Name must be at least 2 characters", sanitized: "" };
    }
    if (trimmed.length > 50) {
      return { isValid: false, error: "Name must be 50 characters or less", sanitized: "" };
    }
    // Allow letters, spaces, hyphens, apostrophes, and common Filipino characters
    if (!/^[a-zA-Z\u00C0-\u017F\s\-'.]+$/.test(trimmed)) {
      return { isValid: false, error: "Name contains invalid characters", sanitized: "" };
    }
  }

  return { isValid: true, error: null, sanitized: trimmed };
}

function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== "string") {
    return { isValid: false, error: "Phone number is required", sanitized: "" };
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return { isValid: true, error: null, sanitized: "" }; // Phone is optional
  }

  // Remove any non-digit characters
  const digitsOnly = trimmed.replace(/\D/g, "");

  // Check if it's a valid Philippine mobile number (starts with 09 and has 11 digits)
  if (!/^09\d{9}$/.test(digitsOnly)) {
    return {
      isValid: false,
      error: "Please enter a valid Philippine mobile number (e.g., 09123456789)",
      sanitized: "",
    };
  }

  return { isValid: true, error: null, sanitized: digitsOnly };
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
      applyStaffOrdersFilter();
    }
  } finally {
    customerHydrationInFlight = false;
  }
}

function normalizeOrderStatus(raw) {
  if (raw == null) return "placed";
  const s = String(raw).toLowerCase().trim();
  if (s === "slot reserved" || s === "slot_reserved") return "slot reserved";
  if (s === "pending") return "placed";
  if (s === "accepted" || s === "deposit confirmed" || s === "deposit verified" || s === "payment verified") return "downpayment confirmed";
  if (s === "processing" || s === "packed") return "in production";
  if (s === "declined") return "cancelled";
  if (s === "completed" || s === "order completed") return "completed";
  if (s === "received" || s === "arrived") return "delivered";
  if (
    [
      "placed",
      "slot reserved",
      "downpayment confirmed",
      "in production",
      "quality checked",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ].includes(s)
  )
    return s;
  return "placed";
}

function isOrderCompleted(order) {
  if (!order) return false;
  const status = normalizeOrderStatus(order.status);
  const orderStatus = normalizeOrderStatus(order.orderStatus);
  const rawStatus = String(order.status || "").toLowerCase().trim();
  const rawOrderStatus = String(order.orderStatus || "").toLowerCase().trim();
  return (
    status === "completed" ||
    orderStatus === "completed" ||
    rawStatus === "completed" ||
    rawOrderStatus === "completed" ||
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
      const notes = it.customNotes ? ` [Custom: ${it.customNotes}]` : "";
      return `${nm} x ${q}${notes}`;
    })
    .join(", ");
}

function formatOrderDeliveryAddress(order) {
  if (!order) return "No delivery address recorded";

  const isPickup =
    order.fulfillmentType === "pickup" ||
    order.address?.pickupAtWorkshop ||
    order.shippingAddress?.pickupAtWorkshop;
  if (isPickup) return "Lanica Workshop (Store Pickup)";

  const sources = [
    order.shippingAddress,
    order.deliveryAddress,
    order.address,
    order.customerAddress,
  ];

  for (const src of sources) {
    if (!src) continue;
    if (typeof src === "string") {
      const trimmed = src.trim();
      if (trimmed && trimmed !== "[object Object]") return trimmed;
    } else if (typeof src === "object") {
      if (
        typeof src.fullAddress === "string" &&
        src.fullAddress.trim() &&
        src.fullAddress.trim() !== "[object Object]"
      ) {
        return src.fullAddress.trim();
      }
      if (
        typeof src.address === "string" &&
        src.address.trim() &&
        src.address.trim() !== "[object Object]"
      ) {
        return src.address.trim();
      }
      const street =
        typeof src.streetAddress === "string"
          ? src.streetAddress.trim()
          : typeof src.street === "string"
          ? src.street.trim()
          : "";
      const city = typeof src.city === "string" ? src.city.trim() : "";
      const province = typeof src.province === "string" ? src.province.trim() : "";
      const postal =
        typeof src.postalCode === "string"
          ? src.postalCode.trim()
          : typeof src.postal === "string"
          ? src.postal.trim()
          : "";

      const parts = [street, city, province, postal].filter(
        (p) => p && p !== "[object Object]"
      );
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }

  if (
    typeof order.fullAddress === "string" &&
    order.fullAddress.trim() &&
    order.fullAddress.trim() !== "[object Object]"
  ) {
    return order.fullAddress.trim();
  }

  return "No delivery address recorded";
}

function formatOrderLandmark(order) {
  if (!order) return "";
  const sources = [
    order.shippingAddress,
    order.deliveryAddress,
    order.address,
  ];
  for (const src of sources) {
    if (src && typeof src === "object") {
      const lm = src.nearestLandmark || src.landmark;
      if (typeof lm === "string" && lm.trim() && lm.trim() !== "[object Object]") {
        return lm.trim();
      }
    }
  }
  if (
    typeof order.nearestLandmark === "string" &&
    order.nearestLandmark.trim() &&
    order.nearestLandmark.trim() !== "[object Object]"
  ) {
    return order.nearestLandmark.trim();
  }
  return "";
}

function formatOrderRecipientPhone(order) {
  if (!order) return "—";
  return (
    order.shippingAddress?.phone ||
    order.shippingAddress?.phoneNumber ||
    order.deliveryAddress?.phone ||
    order.address?.phone ||
    order.customerPhone ||
    order.phone ||
    order.phoneNumber ||
    "—"
  );
}

function formatFormalDate(ts, uppercase = false) {
  if (!ts) return uppercase ? "N/A" : "N/A";
  let d;
  if (typeof ts.toDate === "function") d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else if (ts instanceof Date) d = ts;
  else d = new Date(ts);

  if (isNaN(d.getTime())) return uppercase ? "N/A" : "N/A";

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const m = months[d.getMonth()];
  const day = d.getDate();
  const y = d.getFullYear();
  const str = `${m} ${day}, ${y}`;
  return uppercase ? str.toUpperCase() : str;
}

function formatOrderDate(ts) {
  if (!ts) return "—";
  let d;
  if (typeof ts.toDate === "function") d = ts.toDate();
  else if (ts.seconds) d = new Date(ts.seconds * 1000);
  else if (ts instanceof Date) d = ts;
  else d = new Date(ts);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function parseItemPrice(price) {
  if (typeof price === "number") return price;
  if (!price) return 0;
  const cleaned = String(price).replace(/[^0-9.-]+/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatTransactionMethod(method) {
  if (!method) return "CASH (COUNTER)";
  const m = String(method).toLowerCase();
  if (m.includes("walk_in") || m.includes("cash") || m.includes("counter")) return "CASH (COUNTER)";
  if (m.includes("paymongo") || m.includes("qr") || m.includes("card") || m.includes("gcash")) return "QR PH / PAYMONGO";
  return String(method).toUpperCase();
}

function formatOrderItemsSummaryHtml(items) {
  if (!Array.isArray(items) || items.length === 0) return "—";
  return items
    .map((it) => {
      const q = it.quantity != null ? it.quantity : 1;
      const nm = it.name || it.productName || it.title || "Item";
      const notes = it.customNotes
        ? `<div><span class="order-custom-specs-badge">Specs: ${escapeHtml(it.customNotes)}</span></div>`
        : "";
      return `<div style="margin-bottom: 4px; line-height: 1.25;"><strong style="font-size: 0.84rem; color: #1e293b;">${escapeHtml(nm)}</strong> <span style="font-size: 0.78rem; color: #64748b;">× ${q}</span>${notes}</div>`;
    })
    .join("");
}

function updateStats() {
  const counts = {
    placed: 0,
    "downpayment confirmed": 0,
    "in production": 0,
    "quality checked": 0,
    delivered: 0,
  };

  allStaffOrders.forEach((o) => {
    if (isOrderCompleted(o) || o.isDeleted) return;
    const st = normalizeOrderStatus(o.status);
    if (counts[st] !== undefined) {
      counts[st] += 1;
    }
  });

  if (staffPlacedStatEl) staffPlacedStatEl.textContent = String(counts.placed);
  if (acceptedStatEl) acceptedStatEl.textContent = String(counts["downpayment confirmed"]);
  if (processingStatEl) processingStatEl.textContent = String(counts["in production"]);
  if (shippedStatEl) shippedStatEl.textContent = String(counts["quality checked"]);
  if (deliveredStatEl) deliveredStatEl.textContent = String(counts.delivered);

  // Sync active visual ring on stat cards
  [
    { el: cardFilterPlaced, status: "placed" },
    { el: cardFilterAccepted, status: "downpayment confirmed" },
    { el: cardFilterProcessing, status: "in production" },
    { el: cardFilterShipped, status: "quality checked" },
    { el: cardFilterDelivered, status: "delivered" },
  ].forEach(({ el, status }) => {
    if (el) {
      el.classList.toggle("active-filter", staffOrdersStatusFilter === status);
    }
  });

  renderStaffDashboard(allStaffOrders);
  renderStaffWorkshopQueue(allStaffOrders);
}

function applyStaffOrdersFilter() {
  if (!ordersListEl) return;

  const q = staffOrdersSearchQuery.trim().toLowerCase();

  // 1. Filter active orders
  const activeOrders = allStaffOrders.filter((o) => {
    if (isOrderCompleted(o) || o.isDeleted) return false;

    const st = normalizeOrderStatus(o.status);

    // Status filter
    if (staffOrdersStatusFilter !== "all" && st !== staffOrdersStatusFilter) {
      return false;
    }

    // Search query
    if (q) {
      const idMatch = (o.id || "").toLowerCase().includes(q) || String(o.orderId || "").toLowerCase().includes(q);
      if (idMatch) return true;

      const custName = resolveCustomerDisplay(o).toLowerCase();
      const email = (o.customerEmail || o.email || "").toLowerCase();
      if (custName.includes(q) || email.includes(q)) return true;

      if (Array.isArray(o.items)) {
        const itemMatch = o.items.some((it) => {
          const name = (it.name || it.title || it.productName || "").toLowerCase();
          const mat = (it.material || "").toLowerCase();
          const notes = (it.customNotes || "").toLowerCase();
          return name.includes(q) || mat.includes(q) || notes.includes(q);
        });
        if (itemMatch) return true;
      }

      if (st.includes(q)) return true;
      return false;
    }

    return true;
  });

  // 2. Paginate active orders
  const totalItems = activeOrders.length;
  const totalPages = Math.ceil(totalItems / staffOrdersPerPage) || 1;
  if (staffOrdersCurrentPage > totalPages) staffOrdersCurrentPage = totalPages;
  if (staffOrdersCurrentPage < 1) staffOrdersCurrentPage = 1;

  const startIndex = (staffOrdersCurrentPage - 1) * staffOrdersPerPage;
  const pagedOrders = activeOrders.slice(startIndex, startIndex + staffOrdersPerPage);

  renderOrdersList(pagedOrders, totalItems);

  if (staffOrdersTableContainer) {
    renderPagination({
      container: staffOrdersTableContainer,
      currentPage: staffOrdersCurrentPage,
      totalPages: totalPages,
      totalItems: totalItems,
      pageSize: staffOrdersPerPage,
      pageSizeOptions: [10, 25, 50, 100],
      urlParamPrefix: "staffOrders",
      onPageChange: (newPage) => {
        staffOrdersCurrentPage = newPage;
        applyStaffOrdersFilter();
      },
      onPageSizeChange: (newSize) => {
        staffOrdersPerPage = newSize;
        staffOrdersCurrentPage = 1;
        applyStaffOrdersFilter();
      },
    });
  }

  // 3. Filter completed orders
  const completedOrders = allStaffOrders.filter((o) => {
    if (!isOrderCompleted(o) || o.isDeleted) return false;

    if (q) {
      const idMatch = (o.id || "").toLowerCase().includes(q) || String(o.orderId || "").toLowerCase().includes(q);
      if (idMatch) return true;
      const custName = resolveCustomerDisplay(o).toLowerCase();
      const email = (o.customerEmail || o.email || "").toLowerCase();
      if (custName.includes(q) || email.includes(q)) return true;
      if (Array.isArray(o.items)) {
        const itemMatch = o.items.some((it) => {
          const name = (it.name || it.title || it.productName || "").toLowerCase();
          return name.includes(q);
        });
        if (itemMatch) return true;
      }
      return false;
    }
    return true;
  });

  const totalCompleted = completedOrders.length;
  const totalCompletedPages = Math.ceil(totalCompleted / staffHistoryPerPage) || 1;
  if (staffHistoryCurrentPage > totalCompletedPages) staffHistoryCurrentPage = totalCompletedPages;
  if (staffHistoryCurrentPage < 1) staffHistoryCurrentPage = 1;

  const historyStart = (staffHistoryCurrentPage - 1) * staffHistoryPerPage;
  const pagedHistory = completedOrders.slice(historyStart, historyStart + staffHistoryPerPage);

  renderCompletedHistory(pagedHistory, totalCompleted);

  if (staffHistoryTableContainer) {
    renderPagination({
      container: staffHistoryTableContainer,
      currentPage: staffHistoryCurrentPage,
      totalPages: totalCompletedPages,
      totalItems: totalCompleted,
      pageSize: staffHistoryPerPage,
      pageSizeOptions: [10, 25, 50, 100],
      urlParamPrefix: "staffHist",
      onPageChange: (newPage) => {
        staffHistoryCurrentPage = newPage;
        applyStaffOrdersFilter();
      },
      onPageSizeChange: (newSize) => {
        staffHistoryPerPage = newSize;
        staffHistoryCurrentPage = 1;
        applyStaffOrdersFilter();
      },
    });
  }

  updateStats();
}

function renderOrdersList(orders, totalCount) {
  if (!ordersListEl) return;
  ordersListEl.innerHTML = "";

  if (!orders || orders.length === 0) {
    renderTableEmptyState(
      ordersListEl,
      9,
      staffOrdersSearchQuery || staffOrdersStatusFilter !== "all"
        ? "No orders found matching your active filter criteria."
        : "No active crafting orders currently in the workshop queue."
    );
    return;
  }

  orders.forEach((order) => {
    const st = normalizeOrderStatus(order.status);
    const created = order.createdAt;
    let dateStr = "—";
    if (created && typeof created.toDate === "function") {
      dateStr = created.toDate().toLocaleString();
    } else if (created && created.seconds) {
      dateStr = new Date(created.seconds * 1000).toLocaleString();
    }

    const customer = resolveCustomerDisplay(order);
    const phone = formatOrderRecipientPhone(order);

    // Fulfillment calculation & badge (Store Pickup vs Delivery)
    const isPickup =
      order.fulfillmentType === "pickup" ||
      order.address?.pickupAtWorkshop ||
      order.shippingAddress?.pickupAtWorkshop;
    const fullAddr = formatOrderDeliveryAddress(order);
    const fulfillmentBadgeHtml = isPickup
      ? `<span class="fulfillment-badge pickup" title="Pickup at Lanica Workshop" style="display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path></svg>Store Pickup</span>`
      : `<span class="fulfillment-badge delivery" title="${escapeHtml(fullAddr || "Home Delivery")}" style="display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>Delivery</span>`;

    const nearestLandmark = isPickup ? "" : formatOrderLandmark(order);
    const landmarkBadgeHtml = nearestLandmark
      ? `<div style="font-size:0.73rem; color:#d97706; font-weight:500; margin-top:2px; max-width:170px; line-height:1.2; white-space:normal; display:flex; align-items:flex-start; gap:3px;" title="Landmark / Instructions: ${escapeHtml(nearestLandmark)}"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; margin-top:2px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><span>${escapeHtml(nearestLandmark)}</span></div>`
      : "";

    const addressDisplayHtml = !isPickup && fullAddr && fullAddr !== "No delivery address recorded"
      ? `<div style="font-size:0.75rem; color:#6b7280; margin-top:3px; max-width:170px; line-height:1.2; white-space:normal;" title="${escapeHtml(fullAddr)}">${escapeHtml(fullAddr.length > 45 ? fullAddr.slice(0, 45) + '…' : fullAddr)}</div>${landmarkBadgeHtml}`
      : isPickup
        ? `<div style="font-size:0.75rem; color:#b45309; margin-top:3px;">Lanica Workshop</div>`
        : "";

    // Items Column
    const itemsSummaryHtml = formatOrderItemsSummaryHtml(order.items);

    // Financial Breakdown Calculation
    const isAwaitingCounterDownpayment = order.paymentStatus === "awaiting_counter_downpayment";
    const totalVal = Number(order.totalAmount ?? order.total ?? 0);
    const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounterDownpayment;
    const paidVal = isAwaitingCounterDownpayment
      ? Number(order.downpaymentPaid || 0)
      : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
    const remainingVal = Number(order.remainingBalance ?? order.balanceDue ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
    const isBalanceSettled = order.balanceStatus === "settled" || order.balanceStatus === "Settled" || remainingVal <= 0;
    const paidPct = totalVal > 0 ? Math.round((paidVal / totalVal) * 100) : (isDownpayment ? (isAwaitingCounterDownpayment ? 0 : 30) : 100);

    const hasRiderProof = Boolean(order.riderCashProofUrl || order.balanceStatus === "Pending Admin Verification");
    let riderRemittanceBadgeHtml = "";
    if (hasRiderProof && !isBalanceSettled) {
      riderRemittanceBadgeHtml = `<div><span class="balance-badge" style="background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; display:inline-flex; align-items:center; gap:3px; font-weight:700; margin-top:3px; font-size:0.72rem;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>Rider Proof</span></div>`;
    }

    const balanceBadgeHtml = isAwaitingCounterDownpayment
      ? `<span class="balance-badge pending" style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Counter DP Pending</span>`
      : `<span class="balance-badge ${isBalanceSettled ? "settled" : "pending"}" style="display:inline-flex; align-items:center; gap:3px;">${isBalanceSettled ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Settled' : '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>Pending'}</span>`;

    const financialBreakdownHtml = `
      <div class="financial-breakdown-card">
        <div>Total: <strong class="fin-total">₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div>Upfront: <span class="fin-paid">₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> <small style="color:#6b7280;">(${paidPct}%)</small></div>
        <div>Due: <span class="fin-due">₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        ${balanceBadgeHtml}
        ${riderRemittanceBadgeHtml}
      </div>
    `;

    // Status Badge & Refund Tag
    const isRefundRequested = order.refundStatus === "refund_requested" || order.status === "cancellation_pending_review";
    const displayStatusText = (st === "downpayment confirmed" || st === "accepted")
      ? "Deposit Verified"
      : (st === "slot reserved" ? "Slot Reserved" : (st.charAt(0).toUpperCase() + st.slice(1)));

    const statusBadgeHtml = `
      <div>
        <span class="order-status-badge order-status-${escapeHtml(st.replace(/\s+/g, '-'))}">${escapeHtml(displayStatusText)}</span>
        ${isRefundRequested ? `<div style="margin-top: 4px;"><span class="refund-status-badge requested" style="display:inline-flex; align-items:center; gap:3px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>Refund Requested</span></div>` : ""}
      </div>
    `;

    // Delivery Estimate Display with Edit Button
    const deliveryEstimate = calculateEstimatedDeliveryTime(order);
    const daysDisplay =
      deliveryEstimate.isManual || deliveryEstimate.daysRange === "Custom"
        ? `<span style="color: #dc2626; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>Manual</span>`
        : `<span style="color: #d97706; font-size: 0.72rem;">(${deliveryEstimate.daysRange})</span>`;

    const deliveryDisplayHtml = st === "delivered"
      ? '<span style="color: #059669; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>Delivered</span>'
      : `
        <div style="font-size: 0.82rem; line-height: 1.3;">
          <div style="color: #1f2937; font-weight: 500;">${deliveryEstimate.minDate}</div>
          <div style="color: #6b7280; font-size: 0.75rem;">to ${deliveryEstimate.maxDate}</div>
          <div style="margin-top: 2px; display: flex; align-items: center; gap: 4px;">
            ${daysDisplay}
            <button type="button" class="btn-open-delivery-modal" data-order-id="${escapeHtml(order.id)}" title="Adjust delivery estimate" style="background: none; border: none; padding: 0; color: #2563eb; cursor: pointer; display: inline-flex; align-items: center;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
          </div>
        </div>
      `;

    // Staff Assignment Display
    const isAssignedToMe = order.assignedToUid === currentUser?.uid;
    const isUnassigned = !order.assignedToUid;
    const assignedHtml = order.assignedToUid
      ? isAssignedToMe
        ? `<span class="badge" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-weight: 700; padding: 3px 8px; border-radius: 9999px; font-size: 0.76rem;">You</span>`
        : `<span style="font-size: 0.82rem; font-weight: 500; color: #334155;">${escapeHtml(order.assignedToName || "Staff Member")}</span>`
      : `<button type="button" class="btn-primary btn-claim-order" data-order-id="${escapeHtml(order.id)}" style="padding: 5px 10px; font-size: 0.76rem; border-radius: 6px; white-space: nowrap; background: #6b4423; color: #fff; border: none; cursor: pointer; font-weight: 600;">Claim Order</button>`;

    // Kebab Actions
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Order">
        <button type="button" class="btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: #2563eb; font-weight: 700; font-size: 0.88rem; font-family: inherit;" title="Click to view full order details">
          #${escapeHtml(order.id.slice(0, 8))}…
        </button>
        <div style="font-size: 0.74rem; color: #94a3af; margin-top: 3px;">${escapeHtml(dateStr)}</div>
      </td>
      <td data-label="Customer">
        <strong style="font-size: 0.88rem; color: #1e293b;">${escapeHtml(String(customer))}</strong>
        ${phone !== "—" ? `<div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">${escapeHtml(phone)}</div>` : ""}
      </td>
      <td data-label="Fulfillment">
        ${fulfillmentBadgeHtml}
        ${addressDisplayHtml}
      </td>
      <td class="order-items-cell" data-label="Items">${itemsSummaryHtml}</td>
      <td data-label="Financials">${financialBreakdownHtml}</td>
      <td data-label="Status">${statusBadgeHtml}</td>
      <td data-label="Est. Delivery">${deliveryDisplayHtml}</td>
      <td data-label="Assigned to">${assignedHtml}</td>
      <td data-label="Action">
        <div class="kebab-menu-container">
          <button type="button" class="kebab-trigger-btn" aria-label="Row Actions" title="Actions">
            ⋮
          </button>
          <div class="kebab-dropdown-menu">
            <button type="button" class="kebab-menu-item btn-view-order-details" data-order-id="${escapeHtml(order.id)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              View Order Summary
            </button>
            <button type="button" class="kebab-menu-item action-blue btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="voucher">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              Payment Voucher
            </button>
            <button type="button" class="kebab-menu-item action-cyan btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="quotation">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>
              Official Quotation
            </button>
            ${
              isAwaitingCounterDownpayment
                ? `<button type="button" class="kebab-menu-item action-green btn-receive-counter-downpayment" data-order-id="${escapeHtml(order.id)}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Confirm Counter Downpayment
                  </button>`
                : ""
            }
            ${
              st === "downpayment confirmed"
                ? `<button type="button" class="kebab-menu-item action-blue btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="In Production">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                    Start Production
                  </button>`
                : ""
            }
            ${
              st === "in production"
                ? `<button type="button" class="kebab-menu-item action-purple btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Quality Checked">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    Pass Quality Check
                  </button>`
                : ""
            }
            ${
              st === "quality checked"
                ? `<button type="button" class="kebab-menu-item action-amber btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Shipped">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="1"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    Dispatch / Ship Order
                  </button>`
                : ""
            }
            ${
              st === "shipped"
                ? `<button type="button" class="kebab-menu-item action-green btn-advance-status" data-order-id="${escapeHtml(order.id)}" data-next-status="Delivered">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    Mark as Delivered
                  </button>`
                : ""
            }
            <button type="button" class="kebab-menu-item action-amber btn-open-delivery-modal" data-order-id="${escapeHtml(order.id)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              Adjust Delivery Estimate
            </button>
            ${
              isUnassigned
                ? `<button type="button" class="kebab-menu-item btn-claim-order" data-order-id="${escapeHtml(order.id)}">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                    Claim / Assign to Me
                  </button>`
                : ""
            }
          </div>
        </div>
      </td>
    `;
    ordersListEl.appendChild(tr);
  });
}

function renderCompletedHistory(orders, totalCount) {
  if (!historyListEl) return;
  historyListEl.innerHTML = "";

  if (!orders || orders.length === 0) {
    renderTableEmptyState(historyListEl, 7, "No completed transactions found.");
    return;
  }

  orders.forEach((order) => {
    const customer = resolveCustomerDisplay(order);
    const total = order.total != null ? order.total : order.totalAmount;
    const totalStr =
      total != null && total !== ""
        ? `₱${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "—";

    const assignedStaff = order.assignedToName || (order.assignedToUid === currentUser?.uid ? "You" : "Staff");
    const itemsSummaryHtml = formatOrderItemsSummaryHtml(order.items);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Order">
        <button type="button" class="btn-view-order-details" data-order-id="${escapeHtml(order.id)}" style="background: none; border: none; padding: 0; text-align: left; cursor: pointer; color: #2563eb; font-weight: 700; font-size: 0.88rem; font-family: inherit;">
          #${escapeHtml(order.id.slice(0, 8))}…
        </button>
      </td>
      <td data-label="Customer"><strong>${escapeHtml(String(customer))}</strong></td>
      <td class="order-items-cell" data-label="Items">${itemsSummaryHtml}</td>
      <td data-label="Total"><strong>${totalStr}</strong></td>
      <td data-label="Staff Assigned">${escapeHtml(assignedStaff)}</td>
      <td data-label="Completed At">${escapeHtml(getCompletedAtLabel(order))}</td>
      <td data-label="Action">
        <div class="kebab-menu-container">
          <button type="button" class="kebab-trigger-btn" aria-label="Row Actions" title="Actions">
            ⋮
          </button>
          <div class="kebab-dropdown-menu">
            <button type="button" class="kebab-menu-item btn-view-order-details" data-order-id="${escapeHtml(order.id)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              View Order Summary
            </button>
            <button type="button" class="kebab-menu-item action-blue btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="voucher">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
              Payment Voucher
            </button>
            <button type="button" class="kebab-menu-item action-cyan btn-open-lanica-receipt" data-order-id="${escapeHtml(order.id)}" data-default-tab="quotation">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>
              Official Quotation
            </button>
          </div>
        </div>
      </td>
    `;
    historyListEl.appendChild(tr);
  });
}

function resetStaffFilters() {
  staffOrdersSearchQuery = "";
  staffOrdersStatusFilter = "all";
  staffOrdersCurrentPage = 1;

  if (staffOrdersSearchInput) staffOrdersSearchInput.value = "";
  if (staffOrdersSearchClear) staffOrdersSearchClear.style.display = "none";
  if (staffOrdersStatusFilterEl) staffOrdersStatusFilterEl.value = "all";

  applyStaffOrdersFilter();
  showToast("Filters reset to default view.", "info");
}

let staffProductsCache = [];
let staffProductsUnsubscribe = null;

function initStaffProductsListener() {
  if (staffProductsUnsubscribe) return;
  try {
    const q = collection(db, "products");
    staffProductsUnsubscribe = onSnapshot(
      q,
      (snap) => {
        staffProductsCache = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.isDeleted !== true && data.action !== "delete") {
            staffProductsCache.push({ id: d.id, ...data });
          }
        });
      },
      (err) => {
        console.warn("Could not listen to products in staff portal:", err);
      }
    );
  } catch (err) {
    console.warn("initStaffProductsListener error:", err);
  }
}
initStaffProductsListener();

function resolveOrderItemImage(item, productsList = []) {
  if (!item) return "assets/product_sofa.png";

  const direct =
    item.imageUrl ||
    item.image ||
    item.photo ||
    item.thumbnail ||
    item.productImage ||
    item.img ||
    (Array.isArray(item.images) ? item.images[0] : (item.images?.isoImage || item.images?.bgImage || item.images?.frontBg)) ||
    (Array.isArray(item.thumbnails) ? item.thumbnails[0] : null);
  if (typeof direct === "string" && direct.trim() && !direct.includes("product_sofa.png") && !direct.includes("placeholder.com")) {
    return direct.trim();
  }

  if (typeof item.url === "string" && item.url.trim() && !item.url.includes("product_sofa.png") && !item.url.includes("placeholder.com")) {
    return item.url.trim();
  }

  const itemId = String(item.productId || item.id || item.prodId || "").trim();
  const itemName = String(item.name || item.title || "").trim().toLowerCase();

  const match = (productsList || []).find((p) => {
    if (!p) return false;
    if (itemId && String(p.id) === itemId) return true;
    const pName = String(p.name || p.title || "").trim().toLowerCase();
    if (itemName && pName) {
      if (itemName === pName || pName.includes(itemName) || itemName.includes(pName)) return true;
      const cleanItem = itemName.replace(/[^a-z0-9]/g, "");
      const cleanProd = pName.replace(/[^a-z0-9]/g, "");
      if (cleanItem && cleanProd && (cleanItem === cleanProd || cleanProd.includes(cleanItem) || cleanItem.includes(cleanProd))) {
        return true;
      }
    }
    return false;
  });

  if (match) {
    const candidate =
      match.thumbnail ||
      (Array.isArray(match.thumbnails) && match.thumbnails[0]) ||
      (match.images && (
        match.images.isoImage ||
        match.images.bgImage ||
        match.images.frontBg ||
        (Array.isArray(match.images.thumbnails) && match.images.thumbnails[0]) ||
        (Array.isArray(match.images) ? match.images[0] : null)
      )) ||
      match.imageUrl ||
      match.image ||
      match.photo ||
      match.url;
    if (candidate && typeof candidate === "string" && candidate.trim() && !candidate.includes("product_sofa.png")) {
      return candidate.trim();
    }
  }

  if (typeof direct === "string" && direct.trim() && !direct.includes("placeholder.com")) {
    return direct.trim();
  }
  if (typeof item.url === "string" && item.url.trim() && !item.url.includes("placeholder.com")) {
    return item.url.trim();
  }

  return "assets/product_sofa.png";
}

async function showOrderSummaryModal(orderId) {
  if (!orderId) return;

  let order = Array.isArray(allStaffOrders)
    ? allStaffOrders.find(
        (o) =>
          o.id === orderId ||
          o.orderId === orderId ||
          String(o.orderNumber) === String(orderId)
      )
    : null;

  if (!order) {
    try {
      const snap = await getDoc(doc(db, "orders", orderId));
      if (snap.exists()) {
        order = { id: snap.id, ...snap.data() };
      } else {
        const q = query(collection(db, "orders"), where("orderId", "==", String(orderId)));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          order = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() };
        }
      }
    } catch (err) {
      console.warn("Could not fetch order for summary modal:", err);
    }
  }

  if (!order) {
    showToast("Order details could not be found.", "error");
    return;
  }

  // Pre-load all products if staffProductsCache is empty
  if (!Array.isArray(staffProductsCache) || staffProductsCache.length === 0) {
    try {
      const pSnap = await getDocs(collection(db, "products"));
      staffProductsCache = [];
      pSnap.forEach((ds) => {
        const d = ds.data();
        if (d.isDeleted !== true && d.action !== "delete") {
          staffProductsCache.push({ id: ds.id, ...d });
        }
      });
    } catch (err) {
      console.warn("Could not preload products in staff order summary:", err);
    }
  }

  // Pre-fetch product info for items missing a valid photo thumbnail
  if (Array.isArray(order.items)) {
    for (const it of order.items) {
      const currentResolved = resolveOrderItemImage(it, staffProductsCache);
      if (currentResolved === "assets/product_sofa.png") {
        try {
          const itId = it.productId || it.id || it.prodId;
          if (itId) {
            const snap = await getDoc(doc(db, "products", String(itId)));
            if (snap.exists()) {
              staffProductsCache.push({ id: snap.id, ...snap.data() });
            }
          } else if (it.name || it.title) {
            const rawName = String(it.name || it.title).trim();
            const qSnap = await getDocs(query(collection(db, "products"), where("name", "==", rawName)));
            if (!qSnap.empty) {
              qSnap.forEach((ds) => staffProductsCache.push({ id: ds.id, ...ds.data() }));
            } else {
              const allSnap = await getDocs(collection(db, "products"));
              allSnap.forEach((ds) => {
                const d = ds.data();
                if (d.isDeleted !== true && d.action !== "delete") {
                  staffProductsCache.push({ id: ds.id, ...d });
                }
              });
            }
          }
        } catch (e) {
          console.warn("Could not load product image for item:", it.name, e);
        }
      }
    }
  }

  const existing = document.getElementById("staff-order-summary-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "staff-order-summary-modal";
  modal.className = "modal active";
  modal.style.cssText =
    "position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px;";

  const isPickup =
    order.fulfillmentType === "pickup" ||
    order.address?.pickupAtWorkshop ||
    order.shippingAddress?.pickupAtWorkshop;
  const customerName = resolveCustomerDisplay(order);
  const phone = formatOrderRecipientPhone(order);
  const fullAddress = formatOrderDeliveryAddress(order);
  const landmark = isPickup ? "" : formatOrderLandmark(order);

  const proofUrl = pickFirstNonEmpty(order.proofUrl, order.paymentProof, order.paymentProofUrl, "");

  const itemsListHtml = (order.items || [])
    .map(
      (item) => `
      <div style="display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <img src="${resolveOrderItemImage(item, staffProductsCache)}" alt="${escapeHtml(item.name || 'Item')}" style="width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; background: #f8fafc;" onerror="this.onerror=null;this.src='assets/product_sofa.png';">
        <div style="flex: 1;">
          <strong style="color: #0f172a; font-size: 0.9rem;">${escapeHtml(item.name || item.title || "Item")}</strong>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">Variant / Material: <strong>${escapeHtml(item.material || "Standard")}</strong> &bull; Qty: <strong>${item.quantity || 1}</strong></div>
          ${item.customNotes ? `<div style="font-size: 0.76rem; color: #b45309; background: #fffbeb; border: 1px solid #fef3c7; padding: 4px 8px; border-radius: 6px; margin-top: 4px; line-height: 1.3;"><strong>Custom Specs:</strong> ${escapeHtml(item.customNotes)}</div>` : ""}
        </div>
        <strong style="color: #0f172a; font-size: 0.92rem;">₱${((parseItemPrice(item.price)) * Number(item.quantity || 1)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      </div>
    `
    )
    .join("");

  const totalVal = Number(order.totalAmount || order.total || 0);
  const isAwaitingCounterDownpayment = order.paymentStatus === "awaiting_counter_downpayment";
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounterDownpayment;
  const paidVal = isAwaitingCounterDownpayment
    ? Number(order.downpaymentPaid || 0)
    : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
  const remainingVal = Number(order.remainingBalance ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
  const canonicalStatus = normalizeOrderStatus(order.status);

  modal.innerHTML = `
    <div style="background: #ffffff; border-radius: 16px; max-width: 580px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.15); padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">
        <div>
          <h3 style="margin: 0; font-size: 1.2rem; color: #0f172a;">Order Summary #${escapeHtml(String(order.orderId || order.id || "").slice(0, 8))}</h3>
          <div style="font-size: 0.78rem; color: #64748b; margin-top: 3px;">Placed on ${formatOrderDate(order.createdAt)}</div>
        </div>
        <button type="button" class="btn-close-modal" style="background: #f1f5f9; border: none; font-size: 1.2rem; cursor: pointer; color: #64748b; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">&times;</button>
      </div>

      <div style="background: #f8fafc; padding: 14px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 0.85rem; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 6px;">
        <div><strong>Customer Name:</strong> ${escapeHtml(customerName)} ${phone !== "—" ? `(${escapeHtml(phone)})` : ""}</div>
        <div><strong>Fulfillment:</strong> <span style="font-weight: 600;">${isPickup ? "Store Pickup (Lanica Workshop)" : "Home Delivery"}</span></div>
        <div><strong>Delivery Address:</strong> ${escapeHtml(fullAddress)}</div>
        ${landmark ? `<div style="color: #b45309; background: #fffbeb; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg><strong>Landmark:</strong> ${escapeHtml(landmark)}</div>` : ""}
        <div><strong>Current Status:</strong> <span style="font-weight: 600; color: #1e293b; background: #e2e8f0; padding: 2px 8px; border-radius: 4px; text-transform: capitalize;">${escapeHtml(canonicalStatus)}</span></div>
        <div><strong>Payment Method:</strong> ${escapeHtml(order.paymentMethod === "walk_in_cash" || order.paymentMethod === "cash" || String(order.paymentMethod || "").toLowerCase().includes("counter") ? "Cash (Counter)" : "Online / QR Ph (PayMongo)")}</div>
        <div><strong>Assigned Staff:</strong> <span style="font-weight: 600; color: #0284c7;">${escapeHtml(order.assignedToName || (order.assignedToUid === currentUser?.uid ? "You" : "Unassigned"))}</span></div>
      </div>

      ${proofUrl ? `
        <div style="margin-bottom: 16px; padding: 12px; background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px;">
          <div style="font-size: 0.82rem; font-weight: 600; color: #6b21a8; margin-bottom: 6px;">Payment Verification Screenshot</div>
          <a href="${proofUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block;">
            <img src="${proofUrl}" alt="Proof of Payment" style="max-height: 140px; border-radius: 8px; border: 1px solid #d8b4fe; object-fit: contain;">
          </a>
        </div>
      ` : ""}

      ${order.riderCashProofUrl ? `
        <div style="margin-bottom: 16px; padding: 14px; background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 0.85rem; font-weight: 700; color: #065f46; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>
              <span>Rider Remittance / Cash Proof Receipt</span>
            </div>
            <span style="font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: ${order.balanceStatus === "Settled" || order.balanceStatus === "settled" ? "#d1fae5; color: #065f46;" : "#fef3c7; color: #92400e;"}">${escapeHtml(order.balanceStatus || "Pending Verification")}</span>
          </div>
          <a href="${escapeHtml(order.riderCashProofUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block;">
            <img src="${escapeHtml(order.riderCashProofUrl)}" alt="Rider Cash Proof" style="max-height: 160px; max-width: 100%; border-radius: 8px; border: 1px solid #6ee7b7; object-fit: contain; background: #fff;" />
          </a>
        </div>
      ` : ""}

      <h4 style="margin: 0 0 8px; font-size: 0.95rem; color: #334155;">Ordered Items Breakdown</h4>
      <div style="margin-bottom: 16px;">${itemsListHtml || "<p style='color:#94a3b8;'>No items listed.</p>"}</div>

      <div style="border-top: 2px solid #e2e8f0; padding-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; background: #f8fafc; padding: 12px 16px; border-radius: 10px;">
        <div style="display: flex; justify-content: space-between;"><span>Contract Total:</span><strong>₱${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div style="display: flex; justify-content: space-between; color: #059669;"><span>Amount Paid:</span><strong>₱${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
        <div style="display: flex; justify-content: space-between; color: ${remainingVal > 0 ? "#dc2626" : "#64748b"};"><span>Balance Remaining:</span><strong>₱${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
      </div>

      <div style="margin-top: 20px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn-summary-open-voucher" data-order-id="${escapeHtml(order.id)}" style="padding: 10px 16px; cursor: pointer; border-radius: 8px; background: #2563eb; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
          Payment Voucher
        </button>
        <button type="button" class="btn-summary-open-quotation" data-order-id="${escapeHtml(order.id)}" style="padding: 10px 16px; cursor: pointer; border-radius: 8px; background: #0284c7; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem;">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>
          Official Quotation
        </button>
        ${
          order.paymentStatus === "awaiting_counter_downpayment"
            ? `<button type="button" class="btn-summary-receive-counter-downpayment" data-order-id="${escapeHtml(
                order.id
              )}" style="padding: 10px 18px; cursor: pointer; border-radius: 8px; background: #059669; color: white; border: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; touch-action: manipulation;">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                Receive Downpayment
              </button>`
            : ""
        }
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector(".btn-close-modal");
  if (closeBtn) closeBtn.addEventListener("click", () => modal.remove());

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  const voucherBtn = modal.querySelector(".btn-summary-open-voucher");
  if (voucherBtn) {
    voucherBtn.addEventListener("click", () => {
      modal.remove();
      openLanicaReceiptModal(order.id, "voucher");
    });
  }

  const quotationBtn = modal.querySelector(".btn-summary-open-quotation");
  if (quotationBtn) {
    quotationBtn.addEventListener("click", () => {
      modal.remove();
      openLanicaReceiptModal(order.id, "quotation");
    });
  }

  const receiveBtn = modal.querySelector(".btn-summary-receive-counter-downpayment");
  if (receiveBtn) {
    receiveBtn.addEventListener("click", async () => {
      modal.remove();
      const confirmed = await showConfirmModal({
        title: "Confirm Counter Downpayment",
        message: `Confirm 30% downpayment received at store counter for Order #${order.id.slice(0, 8)}? This will verify the deposit and move the order to In Production.`,
        confirmText: "Confirm Downpayment",
        cancelText: "Cancel",
        icon: "dollar",
      });
      if (confirmed) {
        await updateOrderStatus(order.id, "in production");
        showToast("Counter downpayment confirmed! Order is now in production.", "success");
      }
    });
  }
}

function openDeliveryModal(orderId) {
  const modal = document.getElementById("staff-delivery-modal");
  const idEl = document.getElementById("delivery-modal-order-id");
  const valEl = document.getElementById("delivery-modal-order-id-val");
  const dateInput = document.getElementById("delivery-modal-date-input");
  if (!modal || !idEl || !valEl || !dateInput) return;

  const order = allStaffOrders.find((o) => o.id === orderId);
  idEl.textContent = `#${orderId.slice(0, 8)}`;
  valEl.value = orderId;

  const today = new Date().toISOString().split("T")[0];
  dateInput.min = today;
  if (order && order.manualDeliveryOverride) {
    dateInput.value = order.manualDeliveryOverride;
  } else {
    dateInput.value = today;
  }

  modal.style.display = "flex";
  modal.classList.add("active");
}

function openLanicaReceiptModal(orderId, defaultTab = "voucher") {
  initLanicaReceiptModalListeners();

  const order = (allStaffOrders || []).find((o) => o.id === orderId);
  if (!order) {
    showToast("Unable to load order details for receipt generation.", "error");
    return;
  }

  activeReceiptOrder = order;
  activeReceiptTab = defaultTab || "voucher";

  // Auto-detect branch based on order address/notes
  if (!activeReceiptOrder._selectedBranch) {
    const rawAddr = (formatOrderDeliveryAddress(order) || "").toLowerCase();
    const rawLandmark = (formatOrderLandmark(order) || "").toLowerCase();
    const branchHint = String(order.branch || order.branchName || "").toLowerCase();

    if (
      rawAddr.includes("pila") ||
      rawAddr.includes("labuin") ||
      rawLandmark.includes("pila") ||
      branchHint.includes("pila")
    ) {
      activeReceiptOrder._selectedBranch = "pila";
    } else {
      activeReceiptOrder._selectedBranch = "calamba";
    }
  }

  renderLanicaDocumentContent();

  const modal = document.getElementById("lanica-receipt-modal");
  if (modal) {
    modal.classList.add("active");
    modal.style.display = "flex";
  }
}

function initLanicaReceiptModalListeners() {
  const modal = document.getElementById("lanica-receipt-modal");
  const closeBtn = document.getElementById("btn-close-lanica-modal");
  const printBtn = document.getElementById("btn-print-lanica-doc");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");

  const closeModal = () => {
    if (modal) {
      modal.classList.remove("active");
      modal.style.display = "none";
    }
  };

  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeModal();
    });
  }

  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "true";
    printBtn.addEventListener("click", (e) => {
      e.preventDefault();
      window.print();
    });
  }

  if (tabVoucher && !tabVoucher.dataset.bound) {
    tabVoucher.dataset.bound = "true";
    tabVoucher.addEventListener("click", (e) => {
      e.preventDefault();
      activeReceiptTab = "voucher";
      renderLanicaDocumentContent();
    });
  }

  if (tabQuotation && !tabQuotation.dataset.bound) {
    tabQuotation.dataset.bound = "true";
    tabQuotation.addEventListener("click", (e) => {
      e.preventDefault();
      activeReceiptTab = "quotation";
      renderLanicaDocumentContent();
    });
  }

  if (branchCalamba && !branchCalamba.dataset.bound) {
    branchCalamba.dataset.bound = "true";
    branchCalamba.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeReceiptOrder) {
        activeReceiptOrder._selectedBranch = "calamba";
        delete activeReceiptOrder._docBranch;
        renderLanicaDocumentContent();
      }
    });
  }

  if (branchPila && !branchPila.dataset.bound) {
    branchPila.dataset.bound = "true";
    branchPila.addEventListener("click", (e) => {
      e.preventDefault();
      if (activeReceiptOrder) {
        activeReceiptOrder._selectedBranch = "pila";
        delete activeReceiptOrder._docBranch;
        renderLanicaDocumentContent();
      }
    });
  }

  const printableArea = document.getElementById("lanica-printable-area");
  if (printableArea && !printableArea.dataset.bound) {
    printableArea.dataset.bound = "true";
    printableArea.addEventListener("click", (e) => {
      const resetBranchBtn = e.target.closest("#btn-reset-branch-btn");
      if (resetBranchBtn && activeReceiptOrder) {
        const branchKey = activeReceiptOrder._selectedBranch || "calamba";
        const cfg = LANICA_BRANCHES[branchKey] || LANICA_BRANCHES.calamba;
        activeReceiptOrder._docBranch = {
          title: cfg.title,
          address: cfg.address,
          contact: cfg.contact,
          voucherLocation: cfg.voucherLocation,
        };
        renderLanicaDocumentContent();
        showToast(`Branch header reset to ${cfg.name} defaults.`, "info");
      }
    });
  }
}

function renderLanicaDocumentContent() {
  const area = document.getElementById("lanica-printable-area");
  const tabVoucher = document.getElementById("tab-btn-voucher");
  const tabQuotation = document.getElementById("tab-btn-quotation");
  const branchCalamba = document.getElementById("btn-branch-calamba");
  const branchPila = document.getElementById("btn-branch-pila");

  if (!area || !activeReceiptOrder) return;

  const order = activeReceiptOrder;

  // Toggle Tab Button Active Visuals
  if (tabVoucher && tabQuotation) {
    if (activeReceiptTab === "voucher") {
      tabVoucher.classList.add("active");
      tabQuotation.classList.remove("active");
      tabVoucher.style.background = "#2563eb";
      tabVoucher.style.color = "#ffffff";
      tabQuotation.style.background = "transparent";
      tabQuotation.style.color = "#94a3b8";
    } else {
      tabQuotation.classList.add("active");
      tabVoucher.classList.remove("active");
      tabQuotation.style.background = "#2563eb";
      tabQuotation.style.color = "#ffffff";
      tabVoucher.style.background = "transparent";
      tabVoucher.style.color = "#94a3b8";
    }
  }

  // Toggle Branch Button Active Visuals
  const currentBranchKey = order._selectedBranch || "calamba";
  const branchConfig = LANICA_BRANCHES[currentBranchKey] || LANICA_BRANCHES.calamba;

  if (branchCalamba && branchPila) {
    if (currentBranchKey === "pila") {
      branchPila.classList.add("active");
      branchCalamba.classList.remove("active");
      branchPila.style.background = "#2563eb";
      branchPila.style.color = "#ffffff";
      branchCalamba.style.background = "transparent";
      branchCalamba.style.color = "#94a3b8";
    } else {
      branchCalamba.classList.add("active");
      branchPila.classList.remove("active");
      branchCalamba.style.background = "#2563eb";
      branchCalamba.style.color = "#ffffff";
      branchPila.style.background = "transparent";
      branchPila.style.color = "#94a3b8";
    }
  }

  if (!order._docBranch) {
    order._docBranch = {
      title: branchConfig.title,
      address: branchConfig.address,
      contact: branchConfig.contact,
      voucherLocation: branchConfig.voucherLocation,
    };
  }
  const branch = order._docBranch;

  const totalVal = Number(order.totalAmount || order.total || 0);
  const isAwaitingCounter = order.paymentStatus === "awaiting_counter_downpayment";
  const isDownpayment = order.paymentOption === "downpayment" || Number(order.downpaymentAmount) > 0 || isAwaitingCounter;
  const paidVal = isAwaitingCounter
    ? Number(order.downpaymentPaid || 0)
    : Number(order.downpaymentAmount ?? (isDownpayment ? Math.round(totalVal * 0.30) : totalVal));
  const remainingVal = Number(order.remainingBalance ?? (isDownpayment ? Math.max(0, totalVal - paidVal) : 0));
  const isPartial = isDownpayment && remainingVal > 0;

  const deliveryCharge = Number(order.deliveryFee ?? order.shippingFee ?? order.shippingAddress?.shippingCost ?? 1000);
  const itemsSubtotal = Math.max(0, totalVal - deliveryCharge);

  const customQuotation = order._docQuotation || {};
  const customerName = customQuotation.customerName || resolveCustomerDisplay(order);
  const customerAddress = customQuotation.customerAddress || formatOrderDeliveryAddress(order);
  const customerPhone = customQuotation.customerPhone || formatOrderRecipientPhone(order);
  const quotationNumber = customQuotation.quotationNumber || String(order.orderId || order.id || "0122").slice(0, 10).toUpperCase();

  const purchaseDate = customQuotation.purchaseDate || formatFormalDate(order.createdAt, false);
  const purchaseDateUpper = formatFormalDate(order.createdAt, true);
  const deliveryDate = customQuotation.deliveryDate || formatFormalDate(order.targetDeliveryDate || order.estimatedDeliveryDate || order.deliveredAt, true);

  const proofUrl = pickFirstNonEmpty(order.proofUrl, order.paymentProof, order.paymentProofUrl, "");
  const methodDisplay = formatTransactionMethod(order.paymentMethod || order.paymentType);

  const headerHtml = `
    <div class="modal-no-print voucher-edit-hint" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; padding: 6px 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; font-size: 0.76rem; color: #1d4ed8;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.9rem;">✎</span>
        <span>Branch header, address &amp; customer details are editable inline.</span>
      </div>
      <button type="button" id="btn-reset-branch-btn" title="Reset branch details to defaults" style="background: #ffffff; border: 1px solid #bfdbfe; border-radius: 5px; font-size: 0.72rem; font-weight: 600; color: #1e40af; padding: 3px 8px; cursor: pointer; transition: all 0.15s ease;">
        ↺ Reset to ${escapeHtml(branchConfig.name)}
      </button>
    </div>

    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 18px; margin-bottom: 8px;">
      <img src="assets/lanicalogo.jpg" alt="Lanica Logo" style="width: 76px; height: 76px; object-fit: contain; border: 1.5px solid #000; padding: 2px;" onerror="this.onerror=null;this.src='assets/product_sofa.png';" />
      <div style="text-align: center; flex: 1;">
        <div
          contenteditable="true"
          spellcheck="false"
          class="doc-editable-field"
          data-branch-field="title"
          title="Click to edit branch name"
          style="font-size: 0.95rem; font-weight: 800; letter-spacing: 0.05em; color: #000; text-transform: uppercase; cursor: text; padding: 1px 4px;"
        >${escapeHtml(branch.title)}</div>
        <div
          contenteditable="true"
          spellcheck="false"
          class="doc-editable-field"
          data-branch-field="address"
          title="Click to edit branch address"
          style="font-size: 0.8rem; font-weight: 600; color: #1f2937; margin-top: 3px; text-transform: uppercase; cursor: text; padding: 1px 4px;"
        >${escapeHtml(branch.address)}</div>
        <div style="font-size: 0.8rem; font-weight: 700; color: #000; margin-top: 2px;">
          CONTACT NO#: <span
            contenteditable="true"
            spellcheck="false"
            class="doc-editable-field"
            data-branch-field="contact"
            title="Click to edit contact number"
            style="cursor: text; padding: 1px 4px;"
          >${escapeHtml(branch.contact)}</span>
        </div>
      </div>
    </div>
    <div style="height: 4px; background: #000; width: 100%; margin-bottom: 22px;"></div>
  `;

  if (activeReceiptTab === "voucher") {
    const firstItem = (order.items && order.items[0]) || null;
    const firstItemName = firstItem
      ? firstItem.name || firstItem.title || "Custom Furniture"
      : (order.productName || "Custom Furniture");
    const particulars = `PAYMENT FOR ${escapeHtml(firstItemName.toUpperCase())} SOFA SET`;
    const staffSignatory = order.assignedStaffName || (currentUser?.displayName || "Staff Member");
    const signDate = purchaseDate;

    if (!order._voucherSignatories) {
      order._voucherSignatories = {
        preparedBy: staffSignatory,
        preparedDate: signDate,
        checkedBy: "Staff Lead",
        checkedDate: signDate,
        approvedBy: "SUPERVISOR",
        approvedDate: signDate,
        receivedBy: "OWNER/REPRESENTATIVE",
        receivedDate: signDate,
      };
    }
    const sigs = order._voucherSignatories;

    const renderSignatoryCol = (roleKey, roleLabel, defaultName) => {
      const nameVal = sigs[roleKey] || defaultName;
      const dateVal = sigs[roleKey + "Date"] || purchaseDate;

      return `
        <div style="display: flex; flex-direction: column; justify-content: flex-end;">
          <div style="font-weight: 700; text-transform: uppercase; color: #000; min-height: 28px; display: flex; align-items: center; justify-content: center; line-height: 1.2;">${roleLabel}</div>
          <div
            contenteditable="true"
            spellcheck="false"
            class="voucher-editable-signatory"
            data-sig-field="${roleKey}"
            title="Click to edit name"
            style="margin: 32px auto 4px; border-bottom: 1.5px solid #000; width: 90%; min-height: 22px; font-weight: 800; font-size: 0.8rem; color: #000; padding: 1px 4px; text-align: center; cursor: text;"
          >${escapeHtml(nameVal)}</div>
          <div style="font-size: 0.72rem; color: #475569;">
            DATE: <span contenteditable="true" spellcheck="false" class="voucher-editable-date" data-sig-field="${roleKey}Date" title="Click to edit date" style="padding: 1px 4px; cursor: text;">${escapeHtml(dateVal)}</span>
          </div>
        </div>
      `;
    };

    area.innerHTML = `
      <div style="max-width: 760px; margin: 0 auto; color: #000;">
        ${headerHtml}

        <div style="font-size: 1.25rem; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 20px;">
          PAYMENT REQUEST VOUCHER
        </div>

        <div style="font-size: 0.9rem; font-weight: 700; color: #000; margin-bottom: 8px;">1. Payment Request Form / Voucher</div>
        
        <table style="width: 100%; border-collapse: collapse; border: 2px solid #000; font-size: 0.86rem; margin-bottom: 28px;">
          <tbody>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; width: 38%; text-transform: uppercase;">DOCUMENT DATE:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 600; text-transform: uppercase;">${escapeHtml(purchaseDateUpper)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PAYEE NAME:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; text-transform: uppercase;">LANICA'S BED AND SOFA BED TRADING</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PAYMENT METHOD:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">${escapeHtml(order.paymentMethod === "walk_in_cash" || order.paymentMethod === "cash" || String(order.paymentMethod || "").toLowerCase().includes("counter") ? "CASH (COUNTER)" : "QR PH / PAYMONGO")}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">LOCATION:</td>
              <td
                contenteditable="true"
                spellcheck="false"
                class="doc-editable-field"
                data-branch-field="voucherLocation"
                title="Click to edit voucher location"
                style="border: 1px solid #000; padding: 7px 12px; font-weight: 600; text-transform: uppercase; cursor: text;"
              >${escapeHtml(branch.voucherLocation || branch.address)}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">PARTICULARS/DESCRIPTION:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">${particulars}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">TOTAL CONTRACT/ BILLING AMOUNT</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700;">₱ ${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700; text-transform: uppercase;">
                AMOUNT PAID (Partial ${isPartial ? '<strong>[ ☑ ]</strong>' : '[ ☐ ]'} Full ${!isPartial ? '<strong>[ ☑ ]</strong>' : '[ ☐ ]'})
              </td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 700;">₱ ${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; text-transform: uppercase;">REMAINING BALANCE:</td>
              <td style="border: 1px solid #000; padding: 7px 12px; font-weight: 800; color: #dc2626; font-size: 0.95rem;">₱ ${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div style="font-size: 0.9rem; font-weight: 700; color: #000; margin-bottom: 8px;">2. APPROVAL &amp; PAYMENT RELEASE SIGNATORIES</div>
        <div style="border-top: 2px solid #000; padding-top: 14px; margin-bottom: 24px;">
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center; font-size: 0.78rem;">
            ${renderSignatoryCol("preparedBy", "PREPARED BY", staffSignatory)}
            ${renderSignatoryCol("checkedBy", "CHECKED BY", "Staff Lead")}
            ${renderSignatoryCol("approvedBy", "APPROVED BY", "SUPERVISOR")}
            ${renderSignatoryCol("receivedBy", "RECEIVED BY", "OWNER/REPRESENTATIVE")}
          </div>
        </div>

        ${proofUrl ? `
          <div style="margin-top: 18px; border: 1.5px dashed #64748b; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: #334155; margin-bottom: 10px;">ATTACHED PAYMENT VERIFICATION SCREENSHOT:</div>
            <img src="${proofUrl}" alt="Proof of Payment" style="max-height: 260px; max-width: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1); margin: 0 auto; display: block;" onerror="this.onerror=null;this.parentElement.style.display='none';" />
          </div>
        ` : `
          <div style="margin-top: 18px; border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; background: #f8fafc;">
            <div style="font-size: 0.82rem; font-weight: 700; text-transform: uppercase; color: #059669;">PAYMENT RECONCILED VIA ${escapeHtml(methodDisplay)}</div>
            <div style="font-size: 0.76rem; color: #64748b; margin-top: 3px;">Ref: <strong>#${escapeHtml(String(quotationNumber).slice(0, 10))}</strong> &bull; Date: ${escapeHtml(purchaseDate)}</div>
          </div>
        `}
      </div>
    `;
  } else {
    // DOCUMENT 2: OFFICIAL QUOTATION
    const items = (order.items && order.items.length > 0) ? order.items : [{
      name: order.productName || order.itemTitle || "Custom Handcrafted Furniture",
      quantity: 1,
      price: itemsSubtotal,
      material: order.material || "Kiln-Dried Hardwood / High-Density Foam",
      color: order.fabricColor || order.color || "Standard Color",
      customNotes: order.customNotes || "Standard Artisan Custom Specs"
    }];

    const itemsRowsHtml = items.map((item, idx) => {
      const itemQty = Number(item.quantity || 1);
      const itemPrice = parseItemPrice(item.price);
      const itemTotal = itemPrice * itemQty;
      const itemName = String(item.name || item.title || order.productName || "Custom Handcrafted Furniture").toUpperCase();
      const rawColor = item.color || item.fabricColor || "STANDARD COLOR";
      const itemColor = String(rawColor).toUpperCase();
      const itemSpecs = item.customNotes || item.specs || order.customNotes || "Standard handcrafted specifications";

      return `
        <tr style="vertical-align: top; border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 10px 8px; font-weight: 700; width: 36px;">${idx + 1}</td>
          <td style="padding: 10px 8px;">
            <div style="font-weight: 800; font-size: 0.95rem; text-transform: uppercase; color: #000;">${escapeHtml(itemName)}</div>
            <div style="font-weight: 700; font-size: 0.82rem; margin-top: 3px;">STANDARD SIZE</div>
            <div style="font-size: 0.82rem; margin-top: 2px;">${escapeHtml(itemSpecs)}</div>
            <div style="font-weight: 700; font-size: 0.82rem; margin-top: 6px;">COLOR: ${escapeHtml(itemColor)}</div>
            ${item.material ? `<div style="font-weight: 700; font-size: 0.8rem; margin-top: 2px; color: #4b5563;">FINISH / UPHOLSTERY: ${escapeHtml(String(item.material).toUpperCase())}</div>` : ""}
            
            <div style="margin-top: 8px; font-size: 0.8rem;">
              <div style="font-weight: 700; text-transform: uppercase;">MATERIALS:</div>
              <div style="padding-left: 4px; line-height: 1.4;">
                ✓ PURE GOODLUMBER WOOD FRAME (KILN DRIED)<br/>
                ✓ PURE 4 INCHES URATEX FOAM<br/>
                ✓ ANTI ANAY AT BUKBOK TREATED<br/>
                ✓ PLUSH PREMIUM UPHOLSTERY FABRIC
              </div>
            </div>

            <div style="margin-top: 10px; font-weight: 800; font-size: 0.82rem; text-transform: uppercase; color: #000;">
              6 MONTHS WARRANTY FOAM SEAT ONLY
            </div>
          </td>
          <td style="padding: 10px 8px; text-align: center; font-weight: 700; width: 60px;">${itemQty}</td>
          <td style="padding: 10px 8px; text-align: right; font-weight: 700; width: 110px;">₱ ${itemPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td style="padding: 10px 8px; text-align: right; font-weight: 700; width: 110px;">₱ ${itemTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>
      `;
    }).join("");

    area.innerHTML = `
      <div style="max-width: 760px; margin: 0 auto; color: #000;">
        ${headerHtml}

        <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 22px; font-size: 0.86rem; line-height: 1.5; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 260px;">
            <div><strong>NAME:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerName" title="Click to edit customer name" style="text-transform: uppercase; cursor: text; padding: 1px 4px;">${escapeHtml(customerName)}</span></div>
            <div><strong>ADDRESS:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerAddress" title="Click to edit customer address" style="text-transform: uppercase; cursor: text; padding: 1px 4px;">${escapeHtml(customerAddress)}</span></div>
            <div><strong>CONTACT NO#:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="customerPhone" title="Click to edit customer phone" style="cursor: text; padding: 1px 4px;">${escapeHtml(customerPhone)}</span></div>
          </div>
          <div style="min-width: 230px; text-align: right;">
            <div><strong>QUOTATION NO#:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="quotationNumber" title="Click to edit quotation #" style="font-weight: 800; cursor: text; padding: 1px 4px;">${escapeHtml(quotationNumber)}</span></div>
            <div><strong>DATE PURCHASE:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="purchaseDate" title="Click to edit purchase date" style="cursor: text; padding: 1px 4px;">${escapeHtml(purchaseDate)}</span></div>
            <div><strong>TARGET DELIVERY:</strong> <span contenteditable="true" spellcheck="false" class="doc-editable-field" data-quotation-field="deliveryDate" title="Click to edit delivery date" style="cursor: text; padding: 1px 4px;">${escapeHtml(deliveryDate)}</span></div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; border-top: 2px solid #000; border-bottom: 2px solid #000; font-size: 0.84rem; margin-bottom: 18px;">
          <thead>
            <tr style="border-bottom: 2px solid #000; text-transform: uppercase; font-size: 0.82rem;">
              <th style="padding: 8px; text-align: left;">#</th>
              <th style="padding: 8px; text-align: left;">ITEM &amp; SPECIFICATIONS</th>
              <th style="padding: 8px; text-align: center;">QTY</th>
              <th style="padding: 8px; text-align: right;">UNIT PRICE</th>
              <th style="padding: 8px; text-align: right;">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>

        <div style="display: flex; justify-content: flex-end; margin-bottom: 24px;">
          <div style="min-width: 280px; font-size: 0.86rem; line-height: 1.6;">
            <div style="display: flex; justify-content: space-between;"><span>SUBTOTAL:</span><strong>₱ ${itemsSubtotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            <div style="display: flex; justify-content: space-between;"><span>DELIVERY CHARGE:</span><strong>₱ ${deliveryCharge.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            <div style="display: flex; justify-content: space-between; border-top: 1.5px solid #000; padding-top: 4px; margin-top: 4px; font-size: 0.95rem;"><span>TOTAL AMOUNT:</span><strong style="color: #000;">₱ ${totalVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            <div style="display: flex; justify-content: space-between; color: #059669;"><span>DOWNPAYMENT PAID:</span><strong>₱ ${paidVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
            <div style="display: flex; justify-content: space-between; color: ${remainingVal > 0 ? '#dc2626' : '#059669'}; font-weight: 800;"><span>REMAINING BALANCE:</span><strong>₱ ${remainingVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          </div>
        </div>
      </div>
    `;
  }
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
    // majayjay: { min: 2, max: 3 }, // Duplicate - removed
    // pagsanjan: { min: 2, max: 3 }, // Duplicate - removed
    // paete: { min: 2, max: 3 }, // Duplicate - removed
    // kalayaan: { min: 2, max: 3 }, // Duplicate - removed
    cavinti: { min: 2, max: 3 },

    // Distant areas - longer delivery
    "san pablo": { min: 3, max: 4 },
    // siniloan: { min: 3, max: 4 }, // Duplicate - removed
    // famy: { min: 3, max: 4 }, // Duplicate - removed
    // mabitac: { min: 3, max: 4 }, // Duplicate - removed
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
    // pagsanjan: { min: 2, max: 3 }, // Duplicate - removed
    // majayjay: { min: 2, max: 3 }, // Duplicate - removed
    // luisiana: { min: 3, max: 5 }, // Duplicate - removed
    // cavinti: { min: 3, max: 5 }, // Duplicate - removed
    // famy: { min: 3, max: 4 }, // Duplicate - removed
    // mabitac: { min: 3, max: 4 }, // Duplicate - removed
    // siniloan: { min: 3, max: 4 }, // Duplicate - removed
    // kalayaan: { min: 2, max: 3 }, // Duplicate - removed
    // paete: { min: 2, max: 3 }, // Duplicate - removed
    pakil: { min: 3, max: 5 },
    pangil: { min: 3, max: 5 },
    // siniloan: { min: 3, max: 4 }, // Duplicate - removed
    lumban: { min: 2, max: 3 },
    // cavinti: { min: 3, max: 5 }, // Duplicate - removed
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
    showToast("Failed to apply manual delivery date.", "error");
    return false;
  }
}

function getStatusNotificationMessage(orderId, newStatus) {
  const norm = normalizeOrderStatus(newStatus);
  const ref = orderId ? `#${String(orderId).slice(0, 8)}` : "your order";
  switch (norm) {
    case "slot reserved":
      return `✨ Order Reservation Confirmed (${ref}): Your reservation has been recorded. Our workshop team will review your custom specifications.`;
    case "downpayment confirmed":
      return `💰 Deposit Confirmed (${ref}): 30% downpayment received and verified. Your order is now queued for workshop fabrication!`;
    case "in production":
      return `🔨 In Production (${ref}): Our workshop craftsmen and staff have officially begun woodworking, assembly, and upholstery for your handcrafted furniture!`;
    case "quality checked":
      return `🔍 Quality Inspection Passed (${ref}): Your custom furniture has passed final workshop quality control and is being packaged for dispatch!`;
    case "shipped":
      return `🚚 Out for Delivery (${ref}): Your order has been dispatched with our logistics team and is on its way to your delivery address!`;
    case "delivered":
      return `🎉 Order Delivered (${ref}): Your handcrafted furniture has arrived! Please inspect your piece and tap "Order Received" in your orders page to finalize.`;
    case "completed":
      return `🎉 Order Completed (${ref}): Thank you for trusting Lanica Furniture! Your official receipt is ready in your Completed Transactions History.`;
    case "cancelled":
      return `❌ Order Cancelled (${ref}): This order has been cancelled. Please contact workshop support if you need assistance.`;
    default:
      return `📢 Status Update (${ref}): Your order status is now ${newStatus.toUpperCase()}.`;
  }
}

async function broadcastOrderStatusUpdate(orderId, newStatus) {
  if (!orderId || !newStatus) return;
  const orderDocRef = doc(db, "orders", orderId);
  const now = Timestamp.now();
  const textMsg = getStatusNotificationMessage(orderId, newStatus);

  const payload = {
    text: textMsg,
    message: textMsg,
    content: textMsg,
    sender: "system",
    senderId: "system",
    senderName: "Lanica System",
    senderRole: "system",
    role: "system",
    isSystem: true,
    type: 0,
    timestamp: now,
    createdAt: now,
  };

  try {
    const webCol = collection(db, "orders", orderId, "messages");
    await addDoc(webCol, payload);
  } catch (err) {
    console.warn("Could not write status update to orders/{id}/messages:", err);
  }

  try {
    const mobileCol = collection(db, "order_chats", orderId, "messages");
    await addDoc(mobileCol, payload);
  } catch (err) {
    console.warn("Could not write status update to order_chats/{id}/messages:", err);
  }

  try {
    await updateDoc(orderDocRef, {
      lastMessage: textMsg,
      lastMessageAt: now,
      lastSenderRole: "system",
      lastSenderName: "Lanica System",
    });
  } catch (err) {
    console.warn("Could not update lastMessage on order:", err);
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
      orderStatus: newStatus,
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

    if (currentOrder && currentOrder.paymentStatus === "awaiting_counter_downpayment" && (newStatus === "in production" || newStatus === "downpayment confirmed")) {
      updateData.paymentStatus = "downpayment_paid";
      updateData.downpaymentPaid = Number(currentOrder.downpaymentRequired ?? Math.round(Number(currentOrder.totalAmount || currentOrder.total || 0) * 0.30));
      updateData.downpaymentPaidAt = Timestamp.now();
    }

    await updateDoc(orderRef, updateData);
    broadcastOrderStatusUpdate(orderId, newStatus).catch((err) => console.warn("Broadcast err:", err));

    if (updateData.paymentStatus === "downpayment_paid") {
      await recordAuditLog({
        action: "DOWNPAYMENT_RECEIVED",
        targetType: "order",
        targetId: orderId,
        description: `Staff confirmed 30% Downpayment (₱${Number(updateData.downpaymentPaid || 0).toLocaleString()}) received via Counter Cash for Order #${orderId.slice(0, 8)}`,
        diff: {
          before: {
            orderStatus: currentOrder?.orderStatus || currentOrder?.status,
            paymentStatus: currentOrder?.paymentStatus,
          },
          after: {
            orderStatus: newStatus,
            paymentStatus: "downpayment_paid",
            downpaymentPaid: updateData.downpaymentPaid,
          },
        },
        performedBy: currentUser,
      });
    } else {
      await recordAuditLog({
        action: "ORDER_STATUS_CHANGED",
        targetType: "order",
        targetId: orderId,
        description: `Staff updated status for order #${orderId.slice(0, 8)} from "${currentOrder?.status || 'unknown'}" to "${newStatus}"`,
        diff: {
          before: { status: currentOrder?.status, orderStatus: currentOrder?.orderStatus },
          after: { status: newStatus, orderStatus: newStatus },
        },
        performedBy: currentUser,
      });
    }
  } catch (e) {
    console.error("Failed to update order:", e);
    showToast("Failed to update order status.", "error");
  }
}

async function getUserRole(user) {
  if (!user) return null;

  let role;

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

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    first: parts.slice(0, -1).join(" ") || parts[0] || "",
    last: parts.length > 1 ? parts.slice(-1).join(" ") : "",
  };
}

function combineName(first, last) {
  const f = String(first || "").trim();
  const l = String(last || "").trim();
  return [f, l].filter(Boolean).join(" ");
}

async function loadMyProfile() {
  if (!currentUser || !displayNameInput) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const data = snap.exists() ? snap.data() : {};
    const nm = data.displayName || data.name || "";
    const phone = data.phoneNumber || data.phone || "";
    const profilePhoto = data.photoURL || data.profilePic || currentUser.photoURL || "";

    displayNameInput.value = nm;
    if (displayNameEditInput) {
      displayNameEditInput.value = nm;
    }
    if (phoneEditInput) {
      phoneEditInput.value = phone;
    }
    if (firstNameInput && lastNameInput) {
      const split = splitName(nm || currentUser.displayName || "");
      firstNameInput.value = split.first;
      lastNameInput.value = split.last;
    }
    if (emailAddressInput) {
      emailAddressInput.value = currentUser.email || "";
    }
    if (staffPhoneDisplay) {
      staffPhoneDisplay.textContent = phone || "Not set";
    }
    setStaffNameAcrossUi(
      nm || currentUser.displayName || currentUser.email || "My Profile"
    );
    const avatarFallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      nm || currentUser.displayName || currentUser.email || "Staff"
    )}&background=111827&color=fff&size=128`;
    const setAvatarSrc = (imgEl) => {
      if (!imgEl) return;
      if (profilePhoto) {
        const sanitizedPhoto = sanitizeImageURL(profilePhoto);
        imgEl.src = sanitizedPhoto || avatarFallbackUrl;
      } else {
        imgEl.src = avatarFallbackUrl;
      }
    };
    setAvatarSrc(staffProfileAvatarEl);

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

async function saveMyProfile(displayName, phoneNumber) {
  if (!currentUser) return;

  // Validate and sanitize name
  const nameValidation = validateInput(displayName, "name");
  if (!nameValidation.isValid) {
    throw new Error(nameValidation.error);
  }

  const sanitizedName = nameValidation.sanitized;
  if (!sanitizedName) throw new Error("Name is required.");

  // Validate phone number if provided
  if (phoneNumber) {
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.isValid) {
      throw new Error(phoneValidation.error);
    }
    phoneNumber = phoneValidation.sanitized;
  }

  // Ensure the user's profile doc exists and is up to date.
  const updateData = {
    role: "staff",
    email: currentUser.email || null,
    displayName: sanitizedName,
    name: sanitizedName,
    updatedAt: Timestamp.now(),
  };

  // Add phone number if provided
  if (phoneNumber) {
    updateData.phoneNumber = phoneNumber;
    updateData.phone = phoneNumber;
  }

  await setDoc(doc(db, "users", currentUser.uid), updateData, { merge: true });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  currentUser = user;

  try {
    await reload(user);
  } catch (e) {
    console.warn("Could not reload auth user:", e);
  }
  if (!user.emailVerified) {
    window.location.replace("/login.html");
    return;
  }

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

  // Only allow users with role === "staff" to access staff page
  if (role === "admin") {
    console.log("🔴 ADMIN USER DETECTED - Redirecting to admin page");
    window.location.replace("/admin.html");
    return;
  } else if (role !== "staff") {
    console.warn("🔴 ACCESS DENIED - User does not have staff role. Role:", role);
    window.location.replace("/login.html");
    return;
  } else {
    console.log("✅ STAFF USER CONFIRMED - Access granted to staff page");
  }

  // Check account suspension status on initial load
  try {
    const userDocSnap = await getDoc(doc(db, "users", user.uid));
    if (userDocSnap.exists()) {
      const uStatus = String(userDocSnap.data().status || "").toLowerCase().trim();
      if (uStatus === "inactive" || uStatus === "suspended") {
        await signOut(auth);
        window.location.replace("/login.html?suspended=true");
        return;
      }
    }
  } catch (err) {
    console.warn("Could not check initial user status:", err);
  }

  initStaffProductsListener();
  await loadMyProfile();

  // Dynamic Real-time Role & Status Enforcement Listener
  onSnapshot(doc(db, "users", user.uid), async (userSnap) => {
    if (!userSnap.exists()) return;
    const userData = userSnap.data();

    // Immediate session revocation if suspended or deactivated
    const uStatus = String(userData.status || "").toLowerCase().trim();
    if (uStatus === "inactive" || uStatus === "suspended") {
      alert("Your staff account has been deactivated or suspended by an administrator. Access denied.");
      await signOut(auth);
      window.location.replace("/login.html?suspended=true");
      return;
    }

    const perms = userData.permissions || {};
    staffPermissions = {
      manageOrders: perms.manageOrders !== false,
      inventoryControl: !!perms.inventoryControl,
      viewAnalytics: !!perms.viewAnalytics,
      manageUsers: !!perms.manageUsers,
    };

    if (navStaffInventory) {
      navStaffInventory.classList.toggle("is-hidden", !staffPermissions.inventoryControl);
    }
    if (navStaffAnalytics) {
      navStaffAnalytics.classList.toggle("is-hidden", !staffPermissions.viewAnalytics);
    }

    // Dynamic Route Restriction
    if (!staffPermissions.inventoryControl && currentStaffSection === "inventory") {
      showStaffSection("dashboard");
      showToast("Inventory access has been revoked by Administrator.", "warning");
    }
    if (!staffPermissions.viewAnalytics && currentStaffSection === "analytics") {
      showStaffSection("dashboard");
      showToast("Analytics access has been revoked by Administrator.", "warning");
    }

    renderStaffPermissionsPills(staffPermissions);
  });

  showStaffSection("dashboard");

  const ordersQuery = query(collection(db, "orders"));
  onSnapshot(ordersQuery, (snapshot) => {
    const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    allStaffOrders = all;
    allStaffOrders.sort((a, b) => {
      const aTs = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const bTs = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return bTs - aTs;
    });
    allAssignedOrders = allStaffOrders;
    updateStats();
    applyStaffOrdersFilter();
    hydrateCustomerNamesForOrders(allStaffOrders);
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

    if (firstNameInput && lastNameInput && displayNameEditInput) {
      displayNameEditInput.value = combineName(firstNameInput.value, lastNameInput.value);
    }

    // Profile verification flow is not required for the new profile update UI.

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
      const newName = String(displayNameEditInput.value || "").trim();
      const newPhone = String(phoneEditInput.value || "").trim();

      await saveMyProfile(newName, newPhone);
      if (profileHintEditEl) profileHintEditEl.textContent = "Profile saved successfully.";
      if (newName) setStaffNameAcrossUi(newName);

      // Update display inputs
      if (displayNameInput) {
        displayNameInput.value = newName;
      }
      if (staffPhoneDisplay) {
        staffPhoneDisplay.textContent = newPhone || "Not set";
      }

      // Log successful profile update
      await logStaffAction(
        "profile_update",
        `Profile updated - Name: ${newName}, Phone: ${newPhone || "Not set"}`,
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
      showToast(err.message || "Could not save profile.", "error");
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
    throw new Error("Failed to send password reset email. Please try again.", { cause: error });
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
      showToast("No authenticated user found", "warning");
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
    if (profilePhotoPreview && staffProfileAvatarEl) {
      profilePhotoPreview.src = staffProfileAvatarEl.src;
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

  await showAlertModal({
    title: subject,
    message: `${message}\n\n(Verification code simulated for: ${email})`,
    confirmText: "Got It",
    type: "info",
  });

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

// Staff Orders Toolbar & Filters Event Listeners
let staffOrdersSearchDebounce = null;
if (staffOrdersSearchInput) {
  staffOrdersSearchInput.addEventListener("input", (e) => {
    clearTimeout(staffOrdersSearchDebounce);
    const val = e.target.value;
    if (staffOrdersSearchClear) {
      staffOrdersSearchClear.style.display = val.trim().length > 0 ? "flex" : "none";
    }
    staffOrdersSearchDebounce = setTimeout(() => {
      staffOrdersSearchQuery = val;
      staffOrdersCurrentPage = 1;
      applyStaffOrdersFilter();
    }, 250);
  });
}

if (staffOrdersSearchClear) {
  staffOrdersSearchClear.addEventListener("click", () => {
    if (staffOrdersSearchInput) staffOrdersSearchInput.value = "";
    staffOrdersSearchClear.style.display = "none";
    staffOrdersSearchQuery = "";
    staffOrdersCurrentPage = 1;
    if (staffOrdersSearchInput) staffOrdersSearchInput.focus();
    applyStaffOrdersFilter();
  });
}

if (staffOrdersStatusFilterEl) {
  staffOrdersStatusFilterEl.addEventListener("change", (e) => {
    staffOrdersStatusFilter = e.target.value;
    staffOrdersCurrentPage = 1;
    applyStaffOrdersFilter();
  });
}


// Stat Cards Click-to-Filter Sync
const statFilterPairs = [
  { el: cardFilterPlaced, status: "placed" },
  { el: cardFilterAccepted, status: "downpayment confirmed" },
  { el: cardFilterProcessing, status: "in production" },
  { el: cardFilterShipped, status: "quality checked" },
  { el: cardFilterDelivered, status: "delivered" },
];

statFilterPairs.forEach(({ el, status }) => {
  if (el) {
    el.addEventListener("click", () => {
      if (staffOrdersStatusFilter === status) {
        staffOrdersStatusFilter = "all";
      } else {
        staffOrdersStatusFilter = status;
      }
      if (staffOrdersStatusFilterEl) {
        staffOrdersStatusFilterEl.value = staffOrdersStatusFilter;
      }
      staffOrdersCurrentPage = 1;
      applyStaffOrdersFilter();
    });
  }
});

// Global Kebab Dropdown Menu Handler & Viewport Boundary Positioning
function closeAllKebabMenus() {
  document.querySelectorAll(".kebab-dropdown-menu.active").forEach((menu) => {
    menu.classList.remove("active");
  });
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest(".kebab-trigger-btn");
  if (trigger) {
    e.stopPropagation();
    const menu = trigger.nextElementSibling;
    if (!menu) return;
    const wasActive = menu.classList.contains("active");
    closeAllKebabMenus();
    if (!wasActive) {
      menu.classList.add("active");
    }
    return;
  }

  if (!e.target.closest(".kebab-dropdown-menu")) {
    closeAllKebabMenus();
  }
});

window.addEventListener("scroll", closeAllKebabMenus, { passive: true });
window.addEventListener("resize", closeAllKebabMenus, { passive: true });

// Delegated Order Actions for Active Orders & Completed History
async function handleTableActionClick(e) {
  const viewBtn = e.target.closest(".btn-view-order-details");
  if (viewBtn) {
    closeAllKebabMenus();
    const orderId = viewBtn.getAttribute("data-order-id");
    if (orderId) showOrderSummaryModal(orderId);
    return;
  }

  const receiptBtn = e.target.closest(".btn-open-lanica-receipt");
  if (receiptBtn) {
    closeAllKebabMenus();
    const orderId = receiptBtn.getAttribute("data-order-id");
    const defaultTab = receiptBtn.getAttribute("data-default-tab") || "voucher";
    if (orderId) openLanicaReceiptModal(orderId, defaultTab);
    return;
  }

  const advanceBtn = e.target.closest(".btn-advance-status");
  if (advanceBtn) {
    closeAllKebabMenus();
    const orderId = advanceBtn.getAttribute("data-order-id");
    const nextStatus = advanceBtn.getAttribute("data-next-status");
    if (!orderId || !nextStatus) return;

    const confirmed = await showConfirmModal({
      title: "Advance Order Progression",
      message: `Advance Order #${orderId.slice(0, 8)} to "${nextStatus}"?`,
      confirmText: "Advance Status",
      cancelText: "Cancel",
      icon: "info",
    });
    if (confirmed) {
      await updateOrderStatus(orderId, nextStatus.toLowerCase());
      showToast(`Order status advanced to ${nextStatus}.`, "success");
    }
    return;
  }

  const counterDownpaymentBtn = e.target.closest(".btn-receive-counter-downpayment");
  if (counterDownpaymentBtn) {
    closeAllKebabMenus();
    const orderId = counterDownpaymentBtn.getAttribute("data-order-id");
    if (!orderId) return;

    const confirmed = await showConfirmModal({
      title: "Confirm Counter Downpayment",
      message: `Confirm 30% downpayment received at store counter for Order #${orderId.slice(0, 8)}? This will verify the deposit and move the order to In Production.`,
      confirmText: "Confirm Downpayment",
      cancelText: "Cancel",
      icon: "dollar",
    });
    if (confirmed) {
      await updateOrderStatus(orderId, "in production");
      showToast("Counter downpayment confirmed! Order is now in production.", "success");
    }
    return;
  }

  const deliveryBtn = e.target.closest(".btn-open-delivery-modal");
  if (deliveryBtn) {
    closeAllKebabMenus();
    const orderId = deliveryBtn.getAttribute("data-order-id");
    if (orderId) openDeliveryModal(orderId);
    return;
  }

  const claimBtn = e.target.closest(".btn-claim-order");
  if (claimBtn) {
    closeAllKebabMenus();
    const orderId = claimBtn.getAttribute("data-order-id");
    if (!orderId || !currentUser) return;

    const targetOrder = allStaffOrders.find((o) => o.id === orderId);
    if (targetOrder && targetOrder.assignedToUid) {
      showToast("This order is already assigned and cannot be claimed.", "error");
      return;
    }

    try {
      claimBtn.disabled = true;
      claimBtn.textContent = "Claiming...";
      const staffName = pickFirstNonEmpty(
        currentUser.displayName,
        currentUser.name,
        currentUser.email,
        "Staff Member"
      );
      await updateDoc(doc(db, "orders", orderId), {
        assignedToUid: currentUser.uid,
        assignedToName: staffName,
        updatedAt: Timestamp.now(),
      });
      showToast("Order claimed successfully!", "success");
    } catch (err) {
      console.error("Failed to claim order:", err);
      showToast("Failed to claim order: " + (err.message || ""), "error");
      claimBtn.disabled = false;
      claimBtn.textContent = "Claim Order";
    }
    return;
  }
}

if (ordersListEl) ordersListEl.addEventListener("click", handleTableActionClick);
if (historyListEl) historyListEl.addEventListener("click", handleTableActionClick);

const staffWatchlistBody = document.getElementById("staff-dashboard-watchlist-body");
if (staffWatchlistBody) staffWatchlistBody.addEventListener("click", handleTableActionClick);

// Global delegation for any remaining action buttons (e.g. watchlist table, kanban cards, dynamically inserted elements)
document.addEventListener("click", (e) => {
  const actionBtn = e.target.closest(
    ".btn-view-order-details, .btn-open-lanica-receipt, .btn-advance-status, .btn-receive-counter-downpayment, .btn-open-delivery-modal, .btn-claim-order"
  );
  if (!actionBtn) return;
  // If clicked inside containers that already handle it directly, skip to prevent duplicate handling
  if (ordersListEl && ordersListEl.contains(actionBtn)) return;
  if (historyListEl && historyListEl.contains(actionBtn)) return;
  if (staffWatchlistBody && staffWatchlistBody.contains(actionBtn)) return;
  handleTableActionClick(e);
});

// Delivery Date Modal Event Listeners
const deliveryModal = document.getElementById("staff-delivery-modal");
const closeDeliveryModalBtn = document.getElementById("btn-close-delivery-modal");
const cancelDeliveryModalBtn = document.getElementById("btn-cancel-delivery-modal");
const applyDeliveryModalBtn = document.getElementById("btn-apply-delivery-modal");

function closeDeliveryModal() {
  if (deliveryModal) {
    deliveryModal.style.display = "none";
    deliveryModal.classList.remove("active");
  }
}

if (closeDeliveryModalBtn) closeDeliveryModalBtn.addEventListener("click", closeDeliveryModal);
if (cancelDeliveryModalBtn) cancelDeliveryModalBtn.addEventListener("click", closeDeliveryModal);
if (deliveryModal) {
  deliveryModal.addEventListener("click", (e) => {
    if (e.target === deliveryModal) closeDeliveryModal();
  });
}

if (applyDeliveryModalBtn) {
  applyDeliveryModalBtn.addEventListener("click", async () => {
    const valEl = document.getElementById("delivery-modal-order-id-val");
    const dateInput = document.getElementById("delivery-modal-date-input");
    const orderId = valEl?.value;
    const selectedDate = dateInput?.value;

    if (!orderId || !selectedDate) {
      showToast("Please choose a valid target delivery date.", "warning");
      return;
    }

    applyDeliveryModalBtn.disabled = true;
    applyDeliveryModalBtn.textContent = "Saving...";
    try {
      const ok = await applyManualDeliveryDate(orderId, selectedDate);
      if (ok) {
        showToast(`Delivery estimate updated to ${selectedDate}.`, "success");
        closeDeliveryModal();
      }
    } finally {
      applyDeliveryModalBtn.disabled = false;
      applyDeliveryModalBtn.textContent = "Apply Delivery Date";
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    const confirmed = await showConfirmModal({
      title: "Sign Out",
      message: "Are you sure you want to log out of the Staff Portal?",
      confirmText: "Log Out",
      cancelText: "Stay",
      icon: "logout",
    });
    if (!confirmed) return;

    try {
      await signOut(auth);
      showToast("Logged out successfully.", "info");
      setTimeout(() => {
        window.location.replace("/index.html");
      }, 500);
    } catch (error) {
      console.error("Error signing out:", error);
      showToast("Failed to log out. Try again.", "error");
    }
  });
}

// Staff Live Chat Workspace
let activeStaffChatSessionId = null;
let activeStaffChatUnsubscribe = null;
let allStaffChatSessions = [];
const staffSessionMessageUnsubs = new Map();
const staffSessionUnreadCounts = new Map();
const staffSessionLatestMessages = new Map();

function playStaffChatNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Autoplay policy might mute until user interaction, ignore safely
  }
}

function showStaffChatNotificationToast(messageText, session) {
  let container = document.getElementById("staff-chat-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "staff-chat-toast-container";
    container.style.cssText =
      "position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px; max-width: 360px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.style.cssText =
    "background: #111827; color: #fff; padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #ef4444; transition: transform 0.2s, opacity 0.2s;";
  toast.innerHTML = `
    <div style="flex: 1; margin-right: 10px;">
      <div style="font-weight: 700; color: #f87171; font-size: 0.74rem; text-transform: uppercase; margin-bottom: 2px; display: flex; align-items: center; gap: 5px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Customer Message</div>
      <div style="color: #f3f4f6; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.3;">
        <strong>${escapeHtml(session?.customerName || "Customer")}:</strong> ${escapeHtml(messageText)}
      </div>
    </div>
    <button type="button" style="background: none; border: none; color: #9ca3af; font-size: 1.1rem; cursor: pointer; line-height: 1; padding: 4px;">✕</button>
  `;

  toast.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON" && session) {
      const chatNav = document.getElementById("nav-staff-chats");
      if (chatNav) chatNav.click();
      const sessionsListEl = document.getElementById("staff-chat-sessions-list");
      if (sessionsListEl) {
        const item = sessionsListEl.querySelector(`[data-session-id="${session.id}"]`);
        if (item) item.click();
      }
    }
    toast.remove();
  });

  const closeBtn = toast.querySelector("button");
  if (closeBtn) closeBtn.addEventListener("click", () => toast.remove());

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 7000);
}

function updateStaffNavChatBadge() {
  let totalUnread = 0;
  staffSessionUnreadCounts.forEach((count) => {
    totalUnread += count;
  });

  const navBadge = document.getElementById("staff-nav-chat-unread-badge");
  if (navBadge) {
    if (totalUnread > 0) {
      navBadge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
      navBadge.style.display = "inline-block";
    } else {
      navBadge.style.display = "none";
    }
  }
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

  // Detect if rawText is an image URL (Firebase Storage or direct image file)
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

  // If rawText matches mediaUrl or is purely an image URL, do not show the raw URL string as text
  let displayText = rawText;
  if (mediaUrl && (displayText === mediaUrl || isImageTarget)) {
    displayText = "";
  }

  return { mediaUrl, displayText };
}

function setupStaffLiveChat() {
  const sessionsListEl = document.getElementById("staff-chat-sessions-list");
  const messagesEl = document.getElementById("staff-chat-messages");
  const customerNameEl = document.getElementById("staff-chat-customer-name");
  const customerEmailEl = document.getElementById("staff-chat-customer-email");
  const chatForm = document.getElementById("staff-chat-form");
  const chatInput = document.getElementById("staff-chat-input");
  const fileInput = document.getElementById("staff-chat-file-input");
  const attachBtn = document.getElementById("staff-chat-attach-btn");
  const attachPreview = document.getElementById("staff-chat-attachment-preview");
  const attachFilename = document.getElementById("staff-chat-filename");
  const cancelAttachBtn = document.getElementById("staff-chat-cancel-attachment");
  const chatSubmitBtn = chatForm ? chatForm.querySelector('button[type="submit"]') : null;

  let attachedFile = null;

  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showToast("Attachment must be under 5MB.", "warning");
          fileInput.value = "";
          return;
        }
        attachedFile = file;
        if (attachPreview && attachFilename) {
          attachFilename.textContent = attachedFile.name;
          attachPreview.style.display = "flex";
        }
      }
    });
  }

  if (cancelAttachBtn) {
    cancelAttachBtn.addEventListener("click", () => {
      attachedFile = null;
      if (fileInput) fileInput.value = "";
      if (attachPreview) attachPreview.style.display = "none";
    });
  }

  let currentStaffChatFilter = "all";
  const filterAllBtn = document.getElementById("staff-chat-filter-all");
  const filterSupportBtn = document.getElementById("staff-chat-filter-support");
  const filterOrdersBtn = document.getElementById("staff-chat-filter-orders");
  const filterClosedBtn = document.getElementById("staff-chat-filter-closed");
  const staffChatTotalCount = document.getElementById("staff-chat-total-count");

  // Reply Quoting State
  let activeReplyingMessage = null;
  const replyPreviewEl = document.getElementById("staff-chat-reply-preview");
  const replySenderEl = document.getElementById("staff-chat-reply-sender");
  const replySnippetEl = document.getElementById("staff-chat-reply-snippet");
  const cancelReplyBtn = document.getElementById("staff-chat-cancel-reply");

  function setReplyingMessage(m) {
    activeReplyingMessage = m;
    if (replyPreviewEl && replySenderEl && replySnippetEl) {
      if (m) {
        const { mediaUrl, displayText } = parseChatMessageContent(m);
        const snippet = displayText || (mediaUrl ? "[Photo Attachment]" : "Message");
        replySenderEl.textContent = m.senderName || (m.senderRole === "admin" || m.senderRole === "staff" ? "Staff Member" : "Customer");
        replySnippetEl.textContent = `"${snippet.slice(0, 65)}${snippet.length > 65 ? "..." : ""}"`;
        replyPreviewEl.style.display = "flex";
        if (chatInput) chatInput.focus();
      } else {
        replyPreviewEl.style.display = "none";
      }
    }
  }

  if (cancelReplyBtn) {
    cancelReplyBtn.addEventListener("click", () => setReplyingMessage(null));
  }

  function renderAvatarHtml(photoURL, name, isSupport = false, size = 36) {
    const nameParts = (name || "Customer").trim().split(/\s+/);
    const initials = nameParts.length > 1
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : (nameParts[0].slice(0, 2)).toUpperCase();

    const bg = isSupport ? "#fef3c7" : "#f1f5f9";
    const fg = isSupport ? "#92400e" : "#334155";
    const border = isSupport ? "#fde68a" : "#e2e8f0";

    const fallback = `<span style="display: ${photoURL ? "none" : "flex"}; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: ${Math.round(size * 0.38)}px; font-weight: 700; color: ${fg}; user-select: none;">${escapeHtml(initials)}</span>`;

    if (photoURL && (photoURL.startsWith("http://") || photoURL.startsWith("https://") || photoURL.startsWith("data:"))) {
      return `
        <div style="width: ${size}px; height: ${size}px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: ${bg}; border: 1.5px solid ${border}; position: relative; display: flex; align-items: center; justify-content: center;">
          <img src="${escapeHtml(photoURL)}" alt="${escapeHtml(name)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
          ${fallback}
        </div>
      `;
    }

    return `
      <div style="width: ${size}px; height: ${size}px; border-radius: 50%; background: ${bg}; border: 1.5px solid ${border}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <span style="font-size: ${Math.round(size * 0.38)}px; font-weight: 700; color: ${fg}; user-select: none;">${escapeHtml(initials)}</span>
      </div>
    `;
  }

  function setStaffChatFilter(filter) {
    currentStaffChatFilter = filter;
    [filterAllBtn, filterSupportBtn, filterOrdersBtn, filterClosedBtn].forEach((btn) => {
      if (!btn) return;
      btn.style.background = "#fff";
      btn.style.color = "#374151";
      btn.style.border = "1px solid #d1d5db";
    });
    const activeBtn =
      filter === "support"
        ? filterSupportBtn
        : filter === "orders"
        ? filterOrdersBtn
        : filter === "closed"
        ? filterClosedBtn
        : filterAllBtn;
    if (activeBtn) {
      activeBtn.style.background = "#111827";
      activeBtn.style.color = "#fff";
      activeBtn.style.border = "none";
    }
    renderStaffChatSessionsList(allStaffChatSessions);
  }

  if (filterAllBtn) filterAllBtn.addEventListener("click", () => setStaffChatFilter("all"));
  if (filterSupportBtn) filterSupportBtn.addEventListener("click", () => setStaffChatFilter("support"));
  if (filterOrdersBtn) filterOrdersBtn.addEventListener("click", () => setStaffChatFilter("orders"));
  if (filterClosedBtn) filterClosedBtn.addEventListener("click", () => setStaffChatFilter("closed"));

  subscribeToAllChats((sessions) => {
    allStaffChatSessions = sessions;
    attachStaffMessageListeners(sessions);
    renderStaffChatSessionsList(sessions);
  });

  function attachStaffMessageListeners(sessions) {
    sessions.forEach((s) => {
      if (staffSessionMessageUnsubs.has(s.id)) return;

      const isSupport = s.sessionType === "support" || s.isUserSupport || String(s.id).startsWith("user_");
      const cleanUid = s.userId || s.actualId || String(s.id).replace(/^user_/, "");
      const messagesColRef = isSupport
        ? collection(db, "users", cleanUid, "messages")
        : collection(db, "orders", s.id, "messages");

      const unsub = onSnapshot(messagesColRef, (snapshot) => {
        let unread = 0;
        let latestMsg = null;
        let latestTime = 0;

        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          const isFromStaff =
            d.senderRole === "admin" ||
            d.senderRole === "staff" ||
            d.senderId === "support_admin";

          if (!isFromStaff && d.isRead === false) {
            unread++;
          }

          const msgTime =
            d.timestamp?.toMillis?.() ||
            d.createdAt?.toMillis?.() ||
            (d.timestamp?.seconds ? d.timestamp.seconds * 1000 : 0) ||
            (d.createdAt?.seconds ? d.createdAt.seconds * 1000 : 0) ||
            0;

          if (msgTime >= latestTime) {
            latestTime = msgTime;
            latestMsg = d;
          }
        });

        const prevUnread = staffSessionUnreadCounts.get(s.id) || 0;
        staffSessionUnreadCounts.set(s.id, unread);

        if (latestMsg) {
          const { mediaUrl, displayText } = parseChatMessageContent(latestMsg);
          const textPreview = displayText || (mediaUrl ? "[Photo Attachment]" : "No message text");

          staffSessionLatestMessages.set(s.id, {
            text: textPreview,
            time: latestMsg.timestamp || latestMsg.createdAt,
            timeMs: latestTime,
            isFromStaff:
              latestMsg.senderRole === "admin" ||
              latestMsg.senderRole === "staff" ||
              latestMsg.senderId === "support_admin",
          });
        }

        if (unread > prevUnread && activeStaffChatSessionId !== s.id) {
          playStaffChatNotificationSound();
          const { mediaUrl, displayText } = parseChatMessageContent(latestMsg || {});
          const preview = displayText || (mediaUrl ? "Sent a photo attachment" : "Sent a message");
          showStaffChatNotificationToast(preview, s);
        }

        if (activeStaffChatSessionId === s.id && unread > 0) {
          markOrderMessagesAsRead(s.id, "staff", isSupport);
          staffSessionUnreadCounts.set(s.id, 0);
        }

        updateStaffNavChatBadge();
        renderStaffChatSessionsList(allStaffChatSessions);
      });

      staffSessionMessageUnsubs.set(s.id, unsub);
    });
  }

  let staffChatSearchQuery = "";
  const staffChatSearchInput = document.getElementById("staff-chat-search-input");
  const staffChatSearchClear = document.getElementById("staff-chat-search-clear");
  let staffChatSearchDebounce = null;

  if (staffChatSearchInput) {
    staffChatSearchInput.addEventListener("input", (e) => {
      clearTimeout(staffChatSearchDebounce);
      const val = e.target.value;
      if (staffChatSearchClear) {
        staffChatSearchClear.style.display = val.trim().length > 0 ? "flex" : "none";
      }
      staffChatSearchDebounce = setTimeout(() => {
        staffChatSearchQuery = val;
        renderStaffChatSessionsList(allStaffChatSessions);
      }, 200);
    });
  }

  if (staffChatSearchClear) {
    staffChatSearchClear.addEventListener("click", () => {
      if (staffChatSearchInput) staffChatSearchInput.value = "";
      staffChatSearchClear.style.display = "none";
      staffChatSearchQuery = "";
      if (staffChatSearchInput) staffChatSearchInput.focus();
      renderStaffChatSessionsList(allStaffChatSessions);
    });
  }

  function renderStaffChatSessionsList(sessions) {
    if (!sessionsListEl) return;

    let filteredSessions = sessions.filter((s) => {
      if (currentStaffChatFilter === "closed") {
        return Boolean(s.isClosed);
      }
      if (s.isClosed) return false;

      if (currentStaffChatFilter === "support") return s.sessionType === "support";
      if (currentStaffChatFilter === "orders") return s.sessionType === "order";
      return true;
    });

    if (staffChatSearchQuery) {
      const q = staffChatSearchQuery.toLowerCase().trim();
      filteredSessions = filteredSessions.filter((s) => {
        const name = (s.customerName || "").toLowerCase();
        const email = (s.customerEmail || "").toLowerCase();
        const id = String(s.id || s.actualId || "").toLowerCase();
        const preview = (staffSessionLatestMessages.get(s.id)?.text || "").toLowerCase();
        return name.includes(q) || email.includes(q) || id.includes(q) || preview.includes(q);
      });
    }

    if (staffChatTotalCount) {
      if (staffChatSearchQuery || currentStaffChatFilter !== "all") {
        staffChatTotalCount.textContent = `${filteredSessions.length} / ${sessions.length}`;
      } else {
        staffChatTotalCount.textContent = `${sessions.length} Chats`;
      }
    }

    if (filteredSessions.length === 0) {
      if (staffChatSearchQuery) {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">No conversations found matching "${escapeHtml(staffChatSearchQuery)}".</div>`;
      } else {
        sessionsListEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.85rem;">No ${
          currentStaffChatFilter === "support"
            ? "general live support"
            : currentStaffChatFilter === "orders"
            ? "order crafting"
            : currentStaffChatFilter === "closed"
            ? "closed / archived"
            : "active"
        } conversations found.</div>`;
      }
      return;
    }

    const sorted = [...filteredSessions].sort((a, b) => {
      const unreadA = staffSessionUnreadCounts.get(a.id) || 0;
      const unreadB = staffSessionUnreadCounts.get(b.id) || 0;
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadB > 0 && unreadA === 0) return 1;

      const timeA =
        staffSessionLatestMessages.get(a.id)?.timeMs ||
        a.updatedAt?.toMillis?.() ||
        a.createdAt?.toMillis?.() ||
        0;
      const timeB =
        staffSessionLatestMessages.get(b.id)?.timeMs ||
        b.updatedAt?.toMillis?.() ||
        b.createdAt?.toMillis?.() ||
        0;
      return timeB - timeA;
    });

    sessionsListEl.innerHTML = "";
    sorted.forEach((s) => {
      const isSelected = s.id === activeStaffChatSessionId;
      const unreadCount = staffSessionUnreadCounts.get(s.id) || 0;
      const latestInfo = staffSessionLatestMessages.get(s.id);
      const displayMessage = latestInfo?.text || s.lastMessage || "No messages yet";
      const isSupport = s.sessionType === "support";

      const timeVal = latestInfo?.time || s.updatedAt || s.createdAt;
      const timeStr = timeVal?.toDate
        ? timeVal.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";

      const item = document.createElement("div");
      item.className = "chat-session-item";
      item.setAttribute("data-session-id", s.id);
      item.style.cssText = `padding: 12px 14px; border-bottom: 1px solid #f3f4f6; cursor: pointer; background: ${
        isSelected ? "#eff6ff" : unreadCount > 0 ? "#fef2f2" : "#fff"
      }; border-left: ${
        isSelected ? "4px solid #3b82f6" : unreadCount > 0 ? "4px solid #ef4444" : "4px solid transparent"
      }; transition: background 0.15s;`;

      item.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: flex-start;">
          ${renderAvatarHtml(s.photoURL, s.customerName, isSupport, 38)}
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <strong style="font-size: 0.85rem; color: ${unreadCount > 0 ? "#991b1b" : "#111827"}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 175px;">
                ${escapeHtml(s.customerName || "Customer")}
              </strong>
              <span style="font-size: 0.70rem; color: #9ca3af; flex-shrink: 0;">${timeStr}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
              ${
                isSupport
                  ? `<span style="font-size: 0.66rem; font-weight: 700; padding: 1px 5px; border-radius: 4px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 3px;"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Support</span>`
                  : `<span style="font-size: 0.66rem; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; display: inline-flex; align-items: center; gap: 3px;"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>#${escapeHtml(s.orderId || s.id)}</span>`
              }
              <span style="font-size: 0.66rem; padding: 1px 5px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 500;">
                ${escapeHtml(s.status || (isSupport ? "Live Support" : "Placed"))}
              </span>
              ${
                s.isClosed
                  ? `<span style="font-size: 0.66rem; padding: 1px 5px; border-radius: 4px; background: #f3f4f6; color: #64748b; font-weight: 600;">Closed</span>`
                  : ""
              }
              ${
                unreadCount > 0
                  ? `<span style="margin-left: auto; background: #ef4444; color: #ffffff; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 9999px; min-width: 18px; text-align: center; line-height: 1.2; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.4);">${unreadCount}</span>`
                  : ""
              }
            </div>
            <div style="font-size: 0.78rem; color: ${
              unreadCount > 0 ? "#111827" : "#6b7280"
            }; font-weight: ${
              unreadCount > 0 ? "600" : "400"
            }; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${unreadCount > 0 ? '<span style="color: #ef4444; margin-right: 4px;">●</span>' : ""}${escapeHtml(displayMessage)}
            </div>
          </div>
        </div>
      `;

      item.addEventListener("click", () => {
        selectStaffChatSession(s);
      });

      sessionsListEl.appendChild(item);
    });
  }

  const mobileBackBtn = document.getElementById("staff-chat-mobile-back");
  const chatWorkspaceEl = document.getElementById("staff-chat-workspace");
  const activeAvatarEl = document.getElementById("staff-chat-active-avatar");
  const staffChatHeaderActions = document.getElementById("staff-chat-header-actions");
  const optionsMenuBtn = document.getElementById("staff-chat-options-menu-btn");
  const optionsDropdown = document.getElementById("staff-chat-options-dropdown");
  const archiveActionBtn = document.getElementById("staff-chat-action-archive");
  const archiveText = document.getElementById("staff-chat-archive-text");
  const deleteActionBtn = document.getElementById("staff-chat-action-delete");

  if (mobileBackBtn && chatWorkspaceEl) {
    mobileBackBtn.addEventListener("click", () => {
      chatWorkspaceEl.classList.remove("mobile-chat-open");
    });
  }

  // Close dropdown on click outside
  document.addEventListener("click", (e) => {
    if (optionsDropdown && !e.target.closest(".messenger-header-dropdown-wrap")) {
      optionsDropdown.style.display = "none";
    }
  });

  let staffChatVisibleLimit = 20;

  function selectStaffChatSession(session) {
    activeStaffChatSessionId = session.id;
    staffChatVisibleLimit = 20; // Default 20 messages
    const isSupport = session.sessionType === "support";
    setReplyingMessage(null);

    if (chatWorkspaceEl) {
      chatWorkspaceEl.classList.add("mobile-chat-open");
    }

    staffSessionUnreadCounts.set(session.id, 0);
    updateStaffNavChatBadge();
    markOrderMessagesAsRead(session.id, "staff", isSupport);

    // Header Avatar
    if (activeAvatarEl) {
      activeAvatarEl.innerHTML = renderAvatarHtml(session.photoURL, session.customerName, isSupport, 40);
    }

    // Configure Header Actions (Messenger Dropdown Options)
    if (staffChatHeaderActions) {
      staffChatHeaderActions.style.display = "flex";

      const isArchived = Boolean(session.isArchived || session.isClosed);
      if (archiveText) {
        archiveText.textContent = isArchived ? "Unarchive Chat" : "Archive Chat";
      }

      if (optionsMenuBtn && optionsDropdown) {
        optionsMenuBtn.onclick = (e) => {
          e.stopPropagation();
          const isShown = optionsDropdown.style.display === "flex";
          optionsDropdown.style.display = isShown ? "none" : "flex";
        };
      }

      if (archiveActionBtn) {
        archiveActionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (optionsDropdown) optionsDropdown.style.display = "none";
          try {
            if (isArchived) {
              await unarchiveChatSession({ targetId: session.id, isUserSupport: isSupport });
              session.isArchived = false;
              session.isClosed = false;
              showToast("Chat unarchived and moved to Inbox.", "success");
            } else {
              await archiveChatSession({ targetId: session.id, isUserSupport: isSupport });
              session.isArchived = true;
              session.isClosed = true;
              showToast("Chat archived.", "info");
            }
            renderStaffChatSessionsList(allStaffChatSessions);
            selectStaffChatSession(session);
          } catch (err) {
            showToast(err.message || "Failed to update chat status.", "error");
          }
        };
      }

      if (deleteActionBtn) {
        deleteActionBtn.onclick = async (e) => {
          e.stopPropagation();
          if (optionsDropdown) optionsDropdown.style.display = "none";
          const confirmed = await showConfirmModal({
            title: "Delete Conversation?",
            message: "Are you sure you want to delete this entire conversation? All message history will be permanently deleted.",
            confirmText: "Delete",
            cancelText: "Cancel",
            isDestructive: true,
          });

          if (confirmed) {
            try {
              await deleteConversation({ targetId: session.id, isUserSupport: isSupport });
              showToast("Conversation deleted.", "info");
              activeStaffChatSessionId = null;
              if (chatWorkspaceEl) chatWorkspaceEl.classList.remove("mobile-chat-open");
              if (customerNameEl) customerNameEl.textContent = "Select a conversation";
              if (customerEmailEl) customerEmailEl.textContent = "Choose a customer to consult on dimensions/materials";
              if (activeAvatarEl) activeAvatarEl.innerHTML = "";
              if (staffChatHeaderActions) staffChatHeaderActions.style.display = "none";
              if (messagesEl) messagesEl.innerHTML = `<div style="margin: auto; text-align: center; color: #9ca3af; font-size: 0.9rem;">Select a conversation from the left to start chatting.</div>`;
              if (chatInput) {
                chatInput.disabled = true;
                chatInput.placeholder = "Select a conversation to reply...";
              }
              if (chatSubmitBtn) {
                chatSubmitBtn.disabled = true;
                chatSubmitBtn.style.opacity = "0.6";
                chatSubmitBtn.style.cursor = "not-allowed";
              }
            } catch (err) {
              showToast(err.message || "Failed to delete conversation.", "error");
            }
          }
        };
      }
    }

    if (customerNameEl) {
      if (isSupport) {
        customerNameEl.innerHTML = `<span style="background: #fef3c7; color: #92400e; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>LIVE SUPPORT</span>${escapeHtml(
          session.customerName || "Customer"
        )}${session.isClosed ? ' <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 500;">(Closed)</span>' : ""}`;
      } else {
        customerNameEl.innerHTML = `<span style="background: #e0f2fe; color: #0369a1; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px; display: inline-flex; align-items: center; gap: 4px;"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>ORDER #${escapeHtml(
          session.orderId || session.id
        )}</span>${escapeHtml(session.customerName || "Customer")}${session.isClosed ? ' <span style="font-size: 0.72rem; color: #94a3b8; font-weight: 500;">(Closed)</span>' : ""}`;
      }
    }
    if (customerEmailEl) {
      if (isSupport) {
        customerEmailEl.textContent = `Email: ${session.customerEmail || "Not provided"} • Customer ID: ${
          session.userId || session.actualId
        }`;
      } else {
        customerEmailEl.textContent = `Status: ${session.status || "Placed"} | Total: ₱${Number(
          session.totalAmount || 0
        ).toLocaleString()} (Doc ID: ${session.id})`;
      }
    }

    renderStaffChatSessionsList(allStaffChatSessions);

    if (activeStaffChatUnsubscribe) activeStaffChatUnsubscribe();

    let allLoadedMessages = [];

    function renderMessageBatch() {
      if (!messagesEl) return;
      if (allLoadedMessages.length === 0) {
        messagesEl.innerHTML = `<div style="margin: auto; text-align: center; color: #9ca3af; font-size: 0.88rem;">No messages in this ${
          isSupport ? "support" : "order"
        } thread yet. Send a greeting!</div>`;
        return;
      }

      const totalCount = allLoadedMessages.length;
      const startIndex = Math.max(0, totalCount - staffChatVisibleLimit);
      const visibleMsgs = allLoadedMessages.slice(startIndex);
      const hiddenCount = startIndex;

      messagesEl.innerHTML = "";

      if (hiddenCount > 0) {
        const loadMoreBtn = document.createElement("div");
        loadMoreBtn.className = "chat-load-earlier-btn";
        loadMoreBtn.style.cssText = "text-align: center; margin: 4px auto 12px auto; font-size: 0.78rem; color: #2563eb; cursor: pointer; padding: 6px 14px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 20px; font-weight: 600; width: fit-content; user-select: none; transition: all 0.15s ease;";
        loadMoreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:4px;"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>Load earlier messages (${hiddenCount} hidden)`;
        loadMoreBtn.addEventListener("click", () => {
          const oldScrollHeight = messagesEl.scrollHeight;
          staffChatVisibleLimit += 20;
          renderMessageBatch();
          messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
        });
        messagesEl.appendChild(loadMoreBtn);
      }

      visibleMsgs.forEach((m) => {
        const isSystem =
          Boolean(m.isSystem) ||
          m.senderRole === "system" ||
          m.senderRole === "bot" ||
          m.sender === "system" ||
          m.senderId === "system" ||
          (typeof m.senderName === "string" && (m.senderName.toLowerCase().includes("system") || m.senderName.toLowerCase().includes("bot")));

        const isStaff =
          !isSystem &&
          (m.senderRole === "admin" ||
           m.senderRole === "staff" ||
           m.senderId === "support_admin");

        const row = document.createElement("div");
        row.className = `chat-message-row ${isSystem ? "is-system" : isStaff ? "is-staff" : "is-customer"}`;

        const senderLabel = isSystem
          ? (m.senderName || "Lanica System")
          : isStaff
            ? "Staff & Team"
            : (session.customerName || m.senderName || "Customer");

        const timeVal = m.timestamp || m.createdAt;
        const timeStr = timeVal?.toDate
          ? timeVal.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        const { mediaUrl, displayText } = parseChatMessageContent(m);

        // Avatar: system has robot icon, customer has photo/initials, staff has none
        const avatarCol = isSystem
          ? `<div class="chat-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: #fef3c7; color: #b45309; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; font-weight: 700; flex-shrink: 0; border: 1.5px solid #fde68a;" title="Lanica System Notification">🤖</div>`
          : !isStaff
            ? renderAvatarHtml(session.photoURL, senderLabel, isSupport, 32)
            : "";

        // Quoted Reply HTML
        const quotedHtml = m.replyTo && m.replyTo.text
          ? `
            <div class="chat-quoted-box">
              <span class="chat-quoted-box-sender">Replying to ${escapeHtml(m.replyTo.senderName || "User")}</span>
              <span class="chat-quoted-box-text">${escapeHtml(m.replyTo.text)}</span>
            </div>
          `
          : "";

        row.innerHTML = `
          ${avatarCol}
          <div class="chat-message-content-wrap">
            <span style="font-size: 0.72rem; color: ${isSystem ? '#b45309' : '#6b7280'}; margin-bottom: 2px; font-weight: ${isSystem ? '700' : '500'};">
              ${escapeHtml(senderLabel)} • ${timeStr}
            </span>
            <div class="chat-bubble-with-actions">
              ${
                m.isUnsent
                  ? `<div class="chat-bubble-unsent">${isStaff ? "You unsent a message" : `${escapeHtml(senderLabel)} unsent a message`}</div>`
                  : `
                <div class="chat-bubble-${isSystem ? "system" : isStaff ? "staff" : "customer"}" style="padding: 10px 14px; border-radius: 12px; font-size: 0.88rem; line-height: 1.4; background: ${
                  isSystem ? "#fffbeb" : isStaff ? "#6b4423" : "#ffffff"
                }; color: ${isSystem ? "#92400e" : isStaff ? "#fff" : "#1f2937"}; border: 1px solid ${
                  isSystem ? "#fde68a" : isStaff ? "#6b4423" : "#e5e7eb"
                }; box-shadow: 0 1px 2px rgba(0,0,0,0.05); max-width: 100%;">
                  ${quotedHtml}
                  ${displayText ? `<p style="margin: 0 0 ${mediaUrl ? '8px' : '0'} 0; white-space: pre-wrap; word-break: break-word;">${escapeHtml(displayText)}</p>` : ""}
                  ${
                    mediaUrl
                      ? `<a href="${mediaUrl}" target="_blank" rel="noopener" style="display: block; border-radius: 8px; overflow: hidden; max-width: 280px; max-height: 280px; border: 1px solid rgba(0,0,0,0.08); background: #000; text-decoration: none;" title="Click to view full image">
                          <img src="${mediaUrl}" loading="lazy" style="width: 100%; height: 100%; max-height: 280px; object-fit: contain; display: block;" alt="Attachment" />
                        </a>`
                      : ""
                  }
                </div>
                `
              }
              ${
                !m.isUnsent
                  ? `
                <div class="chat-msg-actions">
                  <button type="button" class="chat-msg-action-btn reply-btn" title="Reply to message">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M10 9V5L3 12l7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                  </button>
                  ${
                    isStaff
                      ? `<button type="button" class="chat-msg-action-btn unsend unsend-btn" title="More options / Unsend"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`
                      : ""
                  }
                </div>
                `
                  : ""
              }
            </div>
          </div>
        `;

        const replyBtn = row.querySelector(".reply-btn");
        if (replyBtn) {
          replyBtn.onclick = () => setReplyingMessage(m);
        }

        const unsendBtn = row.querySelector(".unsend-btn");
        if (unsendBtn) {
          unsendBtn.onclick = async () => {
            const result = await showMessengerUnsendModal({ canUnsendForEveryone: isStaff });
            if (!result) return;
            try {
              await unsendChatMessage({
                targetId: session.id,
                messageId: m.id,
                isUserSupport: isSupport,
                unsendFor: result.unsendFor,
                currentUserId: currentUser ? currentUser.uid : "staff",
              });
              showToast(result.unsendFor === "everyone" ? "You unsent a message." : "Message removed for you.", "info");
            } catch (err) {
              console.error("Unsend error:", err);
              showToast(err.message || "Could not unsend message.", "error");
            }
          };
        }

        messagesEl.appendChild(row);
      });
    }

    if (messagesEl) {
      messagesEl.onscroll = () => {
        if (messagesEl.scrollTop <= 10 && allLoadedMessages.length > staffChatVisibleLimit) {
          const oldScrollHeight = messagesEl.scrollHeight;
          staffChatVisibleLimit += 20;
          renderMessageBatch();
          messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
        }
      };
    }

    activeStaffChatUnsubscribe = subscribeToMessages(session.id, (messages) => {
      if (!messagesEl) return;

      markOrderMessagesAsRead(session.id, "staff", isSupport);
      staffSessionUnreadCounts.set(session.id, 0);
      updateStaffNavChatBadge();

      allLoadedMessages = messages;
      renderMessageBatch();

      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, null, isSupport);
  }

  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = chatInput?.value || "";
      if (!text.trim() && !attachedFile) return;
      if (!activeStaffChatSessionId) {
        showToast("Please select a conversation first.", "info");
        return;
      }

      const activeSession = allStaffChatSessions.find((s) => s.id === activeStaffChatSessionId);
      const isSupport = activeSession?.sessionType === "support";
      const replyPayload = activeReplyingMessage
        ? {
            id: activeReplyingMessage.id,
            senderName: activeReplyingMessage.senderName || (activeReplyingMessage.senderRole === "admin" || activeReplyingMessage.senderRole === "staff" ? "Staff Member" : "Customer"),
            text: activeReplyingMessage.text || activeReplyingMessage.content || "[Photo]",
          }
        : null;

      try {
        let attachmentUrl = "";
        if (attachedFile) {
          attachmentUrl = await uploadChatAttachment(
            attachedFile,
            isSupport ? `support_${activeSession?.userId || "user"}` : activeStaffChatSessionId
          );
          attachedFile = null;
          if (fileInput) fileInput.value = "";
          if (attachPreview) attachPreview.style.display = "none";
        }

        await sendChatMessage({
          orderId: isSupport ? null : activeStaffChatSessionId,
          userId: isSupport ? (activeSession?.userId || activeSession?.actualId) : null,
          sessionType: activeSession?.sessionType || "order",
          isUserSupport: isSupport,
          senderId: currentUser ? currentUser.uid : "staff",
          senderName: currentUser?.displayName || "Staff Member",
          senderRole: "staff",
          receiverId: activeSession?.userId || "customer",
          text: text,
          attachmentUrl: attachmentUrl,
          replyTo: replyPayload,
        });

        if (chatInput) chatInput.value = "";
        setReplyingMessage(null);
      } catch (err) {
        console.error("Chat send error:", err);
        showToast(err.message || "Failed to send reply.", "error");
      }
    });
  }
}

setupStaffLiveChat();

