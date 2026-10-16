import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  reload,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
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

let app;
try {
  app = getApp();
} catch {
  app = initializeApp(firebaseConfig);
}

const auth = getAuth(app);
const db = getFirestore(app);

const actionCodeSettings = () => ({
  url: `${window.location.origin}/login.html`,
  handleCodeInApp: false,
});

const VERIFY_EMAIL_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes session throttle
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes for rate limit backoff

// DOM Elements
const loginFormWrapper = document.getElementById("login-form-wrapper");
const verificationPanel = document.getElementById("verification-pending");
const verificationEmailEl = document.getElementById("verification-email");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("admin-email");
const pwdInput = document.getElementById("admin-pwd");
const alertBanner = document.getElementById("login-error");
const submitBtn = document.getElementById("login-submit-btn");
const checkVerificationBtn = document.getElementById("check-verification-btn");
const resendBtn = document.getElementById("resend-verification-btn");
const signOutPendingBtn = document.getElementById("sign-out-pending-btn");
const togglePwdBtn = document.getElementById("toggle-pwd-btn");

let resendCountdownTimer = null;

/* ==========================================================================
   Helper Utilities & Alerts
   ========================================================================== */

function showAlert(message, type = "error") {
  if (!alertBanner) return;
  if (!message) {
    alertBanner.className = "login-alert is-hidden";
    alertBanner.innerHTML = "";
    return;
  }

  let iconSvg;
  if (type === "success") {
    iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    alertBanner.className = "login-alert alert-success";
  } else if (type === "warning") {
    iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    alertBanner.className = "login-alert alert-warning";
  } else {
    iconSvg = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    alertBanner.className = "login-alert alert-error";
  }

  alertBanner.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  alertBanner.classList.remove("is-hidden");
}

function clearAlert() {
  showAlert("");
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

function shouldAutoSendVerification(uid) {
  if (!uid) return false;
  const last = sessionStorage.getItem(`lanica_verify_sent_${uid}`);
  if (!last) return true;
  return Date.now() - Number(last) > VERIFY_EMAIL_THROTTLE_MS;
}

function isRateLimited(uid) {
  if (!uid) return false;
  const last = sessionStorage.getItem(`lanica_rate_limited_${uid}`);
  if (!last) return false;
  return Date.now() - Number(last) < RATE_LIMIT_BACKOFF_MS;
}

function setRateLimit(uid) {
  if (uid) sessionStorage.setItem(`lanica_rate_limited_${uid}`, String(Date.now()));
}

function clearRateLimit(uid) {
  if (uid) sessionStorage.removeItem(`lanica_rate_limited_${uid}`);
}

function recordAutoSendVerification(uid) {
  if (uid) sessionStorage.setItem(`lanica_verify_sent_${uid}`, String(Date.now()));
}

/* ==========================================================================
   UI State Changers
   ========================================================================== */

function showLoginFormOnly() {
  if (loginFormWrapper) loginFormWrapper.classList.remove("is-hidden");
  if (verificationPanel) verificationPanel.classList.add("is-hidden");
  resetSubmitBtn();
}

function showVerificationPendingUi(user) {
  if (loginFormWrapper) loginFormWrapper.classList.add("is-hidden");
  if (verificationPanel) verificationPanel.classList.remove("is-hidden");
  if (verificationEmailEl && user && user.email) {
    verificationEmailEl.textContent = user.email;
  }
  resetSubmitBtn();
}

function setSubmitLoading(isLoading) {
  if (!submitBtn) return;
  if (isLoading) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="spinner-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
      <span>Authenticating...</span>
    `;
  } else {
    resetSubmitBtn();
  }
}

function resetSubmitBtn() {
  if (!submitBtn) return;
  submitBtn.disabled = false;
  submitBtn.innerHTML = `
    <span class="btn-text">Sign In to Dashboard</span>
    <svg class="btn-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12"></line>
      <polyline points="12 5 19 12 12 19"></polyline>
    </svg>
  `;
}

function startResendCooldown(seconds = 60) {
  if (!resendBtn) return;
  resendBtn.disabled = true;
  let remaining = seconds;
  resendBtn.innerHTML = `<span>Resend in ${remaining}s</span>`;
  clearInterval(resendCountdownTimer);
  resendCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendCountdownTimer);
      resendBtn.disabled = false;
      resendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
        <span>Resend Verification Email</span>
      `;
    } else {
      resendBtn.innerHTML = `<span>Resend in ${remaining}s</span>`;
    }
  }, 1000);
}

/* ==========================================================================
   User Profile & Role-Based Routing
   ========================================================================== */

async function getUserProfile(user) {
  if (!user) return null;
  try {
    const snapByUid = await getDoc(doc(db, "users", user.uid));
    if (snapByUid.exists()) return snapByUid.data();
  } catch (e) {
    console.warn("Could not read user profile by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].data();
  } catch (e) {
    console.warn("Could not read user profile by email:", e);
  }
  return null;
}

async function routeUserByRole(user) {
  const profile = await getUserProfile(user);
  const role = (profile?.role || "").toLowerCase();
  const status = (profile?.status || "active").toLowerCase();

  console.log("Portal login routing for user:", user.email, "role:", role, "status:", status);

  if (status === "inactive" || status === "suspended") {
    showAlert("Your account has been deactivated or suspended by an administrator. Portal access denied.", "error");
    showLoginFormOnly();
    try {
      await signOut(auth);
    } catch (_) {
      // Ignored
    }
    return;
  }

  if (role === "admin") {
    window.location.replace("/admin.html");
  } else if (role === "staff") {
    window.location.replace("/staff.html");
  } else {
    showAlert("Access denied. Only authorized staff and administrator accounts can access this portal.", "error");
    showLoginFormOnly();
    try {
      await signOut(auth);
    } catch (_) {
      // Ignored
    }
  }
}

/* ==========================================================================
   Email Verification Sender
   ========================================================================== */

async function maybeSendVerificationEmail(user) {
  if (!user || !shouldAutoSendVerification(user.uid)) return;

  if (isRateLimited(user.uid)) {
    showAlert("Too many verification attempts. Please wait a few minutes before requesting another link.", "warning");
    return;
  }

  try {
    await sendEmailVerification(user, actionCodeSettings());
    recordAutoSendVerification(user.uid);
    clearRateLimit(user.uid);
    startResendCooldown(60);
    showAlert("A verification link has been sent to your email. Please check your inbox.", "success");
  } catch (e) {
    console.error("sendEmailVerification failed:", e);
    if (e.code === "auth/too-many-requests") {
      setRateLimit(user.uid);
      showAlert("Too many attempts. Please wait 15 minutes before requesting a new verification link.", "warning");
    } else {
      showAlert("Could not send verification email right now. Please use Resend or try again later.", "warning");
    }
  }
}

/* ==========================================================================
   Auth State Synchronization
   ========================================================================== */

async function syncLoginUi(user) {
  if (!user) {
    showLoginFormOnly();
    return;
  }

  try {
    await reload(user);
  } catch (e) {
    console.warn("Could not reload auth user token:", e);
  }

  // Enforce email verification for admin & staff
  if (!user.emailVerified) {
    showVerificationPendingUi(user);
    await maybeSendVerificationEmail(user);
    return;
  }

  // Verified user -> route to portal
  await routeUserByRole(user);
}

onAuthStateChanged(auth, (user) => {
  syncLoginUi(user);
});

/* ==========================================================================
   Interactive Event Listeners
   ========================================================================== */

// 1. Password Visibility Eye Toggle
if (togglePwdBtn && pwdInput) {
  togglePwdBtn.addEventListener("click", () => {
    const isPassword = pwdInput.type === "password";
    pwdInput.type = isPassword ? "text" : "password";

    togglePwdBtn.innerHTML = isPassword
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`
      : `<svg class="eye-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });
}

// 2. Immediate Email Verification Check Button
if (checkVerificationBtn) {
  checkVerificationBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      showLoginFormOnly();
      return;
    }

    checkVerificationBtn.disabled = true;
    const originalContent = checkVerificationBtn.innerHTML;
    checkVerificationBtn.innerHTML = `
      <svg class="spinner-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle></svg>
      <span>Checking Verification...</span>
    `;

    try {
      await reload(user);
      if (user.emailVerified) {
        showAlert("Email verified successfully! Entering dashboard...", "success");
        setTimeout(() => {
          routeUserByRole(user);
        }, 700);
        return;
      }
      showAlert("Email is not verified yet. Please check your inbox and click the verification link, then try again.", "warning");
    } catch (err) {
      showAlert(err.message || "Failed to check email verification status.", "error");
    } finally {
      checkVerificationBtn.disabled = false;
      checkVerificationBtn.innerHTML = originalContent;
    }
  });
}

// 3. Resend Verification Button
if (resendBtn) {
  resendBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      showLoginFormOnly();
      return;
    }

    if (isRateLimited(user.uid)) {
      showAlert("Too many verification attempts. Please wait 15 minutes before trying again.", "warning");
      return;
    }

    resendBtn.disabled = true;
    resendBtn.innerHTML = `<span>Sending Link...</span>`;

    try {
      await sendEmailVerification(user, actionCodeSettings());
      recordAutoSendVerification(user.uid);
      clearRateLimit(user.uid);
      startResendCooldown(60);
      showAlert("Verification link sent! Please check your inbox or spam folder.", "success");
    } catch (e) {
      console.error("Resend verification error:", e);
      if (e.code === "auth/too-many-requests") {
        setRateLimit(user.uid);
        showAlert("Too many attempts. Please wait 15 minutes before trying again.", "warning");
      } else {
        showAlert(e.message || "Could not resend email. Please try again later.", "error");
        resendBtn.disabled = false;
        resendBtn.innerHTML = `<span>Resend Verification Email</span>`;
      }
    }
  });
}

// 4. Sign Out / Switch Account Button
if (signOutPendingBtn) {
  signOutPendingBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Sign out error:", e);
    }
    clearInterval(resendCountdownTimer);
    clearAlert();
    showLoginFormOnly();
  });
}

// 5. Sign-In Form Submission
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput ? emailInput.value.trim() : "";
    const password = pwdInput ? pwdInput.value : "";

    if (!email || !password) {
      showAlert("Please enter both email address and password.", "warning");
      return;
    }

    clearAlert();
    setSubmitLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      try {
        await reload(user);
      } catch (_) {
        // Ignored
      }

      if (!user.emailVerified) {
        showVerificationPendingUi(user);
        await maybeSendVerificationEmail(user);
      } else {
        await routeUserByRole(user);
      }
    } catch (error) {
      console.error("Portal Sign-In Error:", error);
      setSubmitLoading(false);

      switch (error.code) {
        case "auth/invalid-credential":
          showAlert("Invalid email address or password. Please verify your credentials.", "error");
          break;
        case "auth/user-not-found":
          showAlert("No registered account found with this email.", "error");
          break;
        case "auth/wrong-password":
          showAlert("Incorrect password. Please try again.", "error");
          break;
        case "auth/invalid-email":
          showAlert("Please enter a valid email address.", "error");
          break;
        case "auth/too-many-requests":
          showAlert("Too many failed sign-in attempts. Please wait a few moments or try again later.", "warning");
          break;
        case "auth/user-disabled":
          showAlert("This account has been disabled. Please contact an administrator.", "error");
          break;
        default:
          showAlert(error.message || "Authentication failed. Please try again.", "error");
      }
    }
  });
}

// Handle URL query parameters (e.g. redirected from session timeout or suspension)
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("suspended") === "true") {
  showAlert("Your account has been deactivated or suspended by an administrator. Access denied.", "error");
} else if (urlParams.get("reason") === "session_expired") {
  showAlert("Your session has expired. Please sign in again to continue.", "warning");
}
