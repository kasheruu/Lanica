import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const actionCodeSettings = () => ({
  url: `${window.location.origin}${window.location.pathname}`,
  handleCodeInApp: false,
});

const VERIFY_EMAIL_THROTTLE_MS = 10 * 60 * 1000; // Increased to 10 minutes to respect Firebase limits
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000; // 15 minutes for rate limit errors

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

async function getUserRole(user) {
  if (!user) return null;
  try {
    const roleByUid = await getDoc(doc(db, "users", user.uid));
    if (roleByUid.exists()) return (roleByUid.data().role || "").toLowerCase();
  } catch (e) {
    console.warn("Could not read user role by uid:", e);
  }

  try {
    const q = query(collection(db, "users"), where("email", "==", user.email || ""));
    const snap = await getDocs(q);
    if (!snap.empty) return ((snap.docs[0].data() || {}).role || "").toLowerCase();
  } catch (e) {
    console.warn("Could not read user role by email:", e);
  }
  return null;
}

async function routeUserByRole(user) {
  const role = await getUserRole(user);

  console.log("=== LOGIN ROUTING DEBUG ===");
  console.log("Login - User UID:", user.uid);
  console.log("Login - User Email:", user.email);
  console.log("Login - Detected Role:", role);

  if (role === "admin") {
    window.location.replace("/admin.html");
  } else if (role === "staff") {
    window.location.replace("/staff.html");
  } else {
    window.location.replace("/staff.html");
  }
}

const loginFormWrapper = document.getElementById("login-form-wrapper");
const verificationPanel = document.getElementById("verification-pending");
const verificationEmailEl = document.getElementById("verification-email");
const loginForm = document.getElementById("login-form");
const errorMsg = document.getElementById("login-error");
const submitBtn = document.querySelector(".login-btn");
const resendBtn = document.getElementById("resend-verification-btn");
const signOutPendingBtn = document.getElementById("sign-out-pending-btn");

function getRecaptchaSiteKey() {
  return String((typeof window !== "undefined" && window.LANICA_RECAPTCHA_SITE_KEY) || "").trim();
}

function getRecaptchaWidgetId() {
  const wid = typeof window !== "undefined" ? window.LANICA_RECAPTCHA_WIDGET_ID : undefined;
  if (wid === undefined || wid === null) return null;
  return wid;
}

function resetRecaptcha() {
  const wid = getRecaptchaWidgetId();
  if (wid === null || typeof window.grecaptcha === "undefined") return;
  try {
    window.grecaptcha.reset(wid);
  } catch (_) {
    /* ignore */
  }
}

function showLoginFormOnly() {
  if (loginFormWrapper) loginFormWrapper.classList.remove("is-hidden");
  if (verificationPanel) verificationPanel.classList.add("is-hidden");
}

function showVerificationPendingUi(user) {
  if (loginFormWrapper) loginFormWrapper.classList.add("is-hidden");
  if (verificationPanel) verificationPanel.classList.remove("is-hidden");
  if (verificationEmailEl && user && user.email) {
    verificationEmailEl.textContent = user.email;
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
}

async function maybeSendVerificationEmail(user) {
  console.log("=== EMAIL VERIFICATION DEBUG ===");
  console.log("User:", user?.uid, user?.email);
  console.log("Should auto send:", shouldAutoSendVerification(user?.uid));
  console.log("Is rate limited:", isRateLimited(user?.uid));

  if (!user || !shouldAutoSendVerification(user.uid)) {
    console.log("Skipping email verification - user not found or not ready");
    return;
  }

  // Check if user is currently rate limited
  if (isRateLimited(user.uid)) {
    console.log("User is rate limited for email verification");
    if (errorMsg) {
      errorMsg.textContent =
        "Too many verification attempts. Please wait 15 minutes before trying again.";
      errorMsg.style.color = "#c5221f";
    }
    return;
  }

  console.log("Attempting to send email verification...");
  try {
    const actionSettings = actionCodeSettings();
    console.log("Action code settings:", actionSettings);

    await sendEmailVerification(user, actionSettings);
    console.log("Email verification sent successfully");

    recordAutoSendVerification(user.uid);
    clearRateLimit(user.uid); // Clear any existing rate limit on success
    if (errorMsg) {
      errorMsg.textContent = "";
      errorMsg.style.color = "#c5221f";
    }
  } catch (e) {
    console.error("sendEmailVerification failed:", e);
    console.error("Error code:", e.code);
    console.error("Error message:", e.message);

    // Handle specific rate limiting error
    if (e.code === "auth/too-many-requests") {
      console.log("Rate limit detected, setting rate limit");
      setRateLimit(user.uid);
      if (errorMsg) {
        errorMsg.textContent =
          "Too many verification attempts. Please wait 15 minutes before trying again.";
        errorMsg.style.color = "#c5221f";
      }
    } else {
      // Handle other errors
      console.log("Other error occurred:", e.code);
      if (errorMsg) {
        errorMsg.textContent =
          e && e.message
            ? "Could not send verification email. Use Resend or try again later."
            : "Could not send verification email.";
        errorMsg.style.color = "#c5221f";
      }
    }
  }
}

async function syncLoginUi(user) {
  if (!user) {
    showLoginFormOnly();
    return;
  }

  try {
    await reload(user);
  } catch (e) {
    console.warn("reload user:", e);
  }

  if (!user.emailVerified) {
    showVerificationPendingUi(user);
    await maybeSendVerificationEmail(user);
    resetRecaptcha();
    return;
  }

  await routeUserByRole(user);
}

onAuthStateChanged(auth, (user) => {
  syncLoginUi(user);
});

if (resendBtn) {
  resendBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    console.log("=== RESEND VERIFICATION DEBUG ===");
    console.log("User:", user?.uid, user?.email);

    if (!user) {
      console.log("No user found for resend");
      return;
    }

    // Check if user is rate limited
    if (isRateLimited(user.uid)) {
      console.log("User is rate limited for resend");
      if (errorMsg) {
        errorMsg.textContent =
          "Too many verification attempts. Please wait 15 minutes before trying again.";
        errorMsg.style.color = "#c5221f";
      }
      return;
    }

    resendBtn.disabled = true;
    resendBtn.textContent = "Sending…";
    console.log("Attempting to resend verification email...");

    try {
      const actionSettings = actionCodeSettings();
      console.log("Action code settings:", actionSettings);

      await sendEmailVerification(user, actionSettings);
      console.log("Resend verification email sent successfully");

      recordAutoSendVerification(user.uid);
      clearRateLimit(user.uid); // Clear any existing rate limit on success
      if (errorMsg) {
        errorMsg.textContent = "Verification link sent. Check your inbox.";
        errorMsg.style.color = "#059669";
      }
    } catch (e) {
      console.error("Resend verification failed:", e);
      console.error("Error code:", e.code);
      console.error("Error message:", e.message);

      // Handle specific rate limiting error
      if (e.code === "auth/too-many-requests") {
        console.log("Rate limit detected during resend");
        setRateLimit(user.uid);
        if (errorMsg) {
          errorMsg.textContent =
            "Too many verification attempts. Please wait 15 minutes before trying again.";
          errorMsg.style.color = "#c5221f";
        }
      } else {
        // Handle other errors
        console.log("Other error during resend:", e.code);
        if (errorMsg) {
          errorMsg.textContent = e.message || "Could not resend email.";
          errorMsg.style.color = "#c5221f";
        }
      }
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend verification email";
    }
  });
}

if (signOutPendingBtn) {
  signOutPendingBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    resetRecaptcha();
    showLoginFormOnly();
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("admin-email").value;
    const password = document.getElementById("admin-pwd").value;

    const siteKey = getRecaptchaSiteKey();
    if (siteKey) {
      if (typeof window.grecaptcha === "undefined") {
        if (errorMsg) {
          errorMsg.textContent = "Captcha is still loading. Wait a moment and try again.";
          errorMsg.style.color = "#c5221f";
        }
        return;
      }
      const wid = getRecaptchaWidgetId();
      if (wid === null) {
        if (errorMsg) {
          errorMsg.textContent = "Captcha is still loading. Wait a moment and try again.";
          errorMsg.style.color = "#c5221f";
        }
        return;
      }
      const token = window.grecaptcha.getResponse(wid);
      if (!token) {
        if (errorMsg) {
          errorMsg.textContent = "Please complete the captcha.";
          errorMsg.style.color = "#c5221f";
        }
        return;
      }
    }

    try {
      if (submitBtn) {
        submitBtn.textContent = "Verifying...";
        submitBtn.disabled = true;
      }
      if (errorMsg) {
        errorMsg.textContent = "";
        errorMsg.style.color = "#c5221f";
      }

      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Login Error:", error);
      if (submitBtn) {
        submitBtn.textContent = "Sign In";
        submitBtn.disabled = false;
      }
      resetRecaptcha();

      if (errorMsg) {
        switch (error.code) {
          case "auth/invalid-credential":
            errorMsg.textContent = "Invalid email or password.";
            break;
          case "auth/user-not-found":
            errorMsg.textContent = "No admin account found with this email.";
            break;
          case "auth/wrong-password":
            errorMsg.textContent = "Incorrect password.";
            break;
          case "auth/too-many-requests":
            errorMsg.textContent = "Too many failed attempts. Try again later.";
            break;
          default:
            errorMsg.textContent = "Authentication failed. Please try again.";
        }
      }
    }
  });
}
