import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  auth,
  signUpUser,
  signInUser,
  signInWithGoogle,
  sendPasswordReset,
  validatePasswordStrength,
} from "./authService.js";

/**
 * Mobile-App Matched Enterprise Auth Modal Controller
 */
export function initAuthModalController() {
  const authModal = document.getElementById("auth-modal");
  const authModalBtns = document.querySelectorAll("#auth-modal-btn, .btn-open-auth-modal");
  const closeAuthBtn = document.getElementById("close-auth-modal-btn");

  const loginView = document.getElementById("auth-login-view");
  const registerView = document.getElementById("auth-register-view");
  const signedInView = document.getElementById("customer-signed-in-view");
  const signedOutView = document.getElementById("customer-signed-out-view");

  const switchToSignupBtn = document.getElementById("switch-to-signup-btn");
  const switchToLoginBtn = document.getElementById("switch-to-login-btn");
  const forgotPasswordLink = document.getElementById("auth-forgot-password-link");

  const loginForm = document.getElementById("customer-login-form");
  const registerForm = document.getElementById("customer-register-form");
  const googleBtns = document.querySelectorAll(".google-signin-btn");
  const signOutBtn = document.getElementById("customer-signout-btn");

  const regPasswordInput = document.getElementById("reg-password");
  const regConfirmPasswordInput = document.getElementById("reg-confirm-password");

  // 1. Modal Open / Close Handlers
  if (authModalBtns.length > 0 && authModal) {
    authModalBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (auth?.currentUser && !auth.currentUser.isAnonymous) {
          window.location.href = "profile.html";
          return;
        }
        authModal.classList.add("active");
        document.body.style.overflow = "hidden";
      });
    });
  }

  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener("click", () => {
      authModal.classList.remove("active");
      document.body.style.overflow = "";
    });
  }

  if (authModal) {
    authModal.addEventListener("click", (e) => {
      if (e.target === authModal) {
        authModal.classList.remove("active");
        document.body.style.overflow = "";
      }
    });
  }

  // 2. View Switchers (LOGIN <-> REGISTER)
  if (switchToSignupBtn && loginView && registerView) {
    switchToSignupBtn.addEventListener("click", () => {
      loginView.style.display = "none";
      registerView.style.display = "block";
    });
  }

  if (switchToLoginBtn && loginView && registerView) {
    switchToLoginBtn.addEventListener("click", () => {
      registerView.style.display = "none";
      loginView.style.display = "block";
    });
  }

  // 3. Eye Toggle Buttons
  document.querySelectorAll(".eye-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";

      btn.innerHTML = isPassword
        ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    });
  });

  // 4. Interactive Password Strength Evaluator (Live on Typing)
  if (regPasswordInput) {
    regPasswordInput.addEventListener("input", () => {
      evaluateLivePasswordStrength(regPasswordInput.value);
    });
  }

  function evaluateLivePasswordStrength(pwd) {
    const evalRes = validatePasswordStrength(pwd);
    const { score, criteria } = evalRes;

    const warningBanner = document.getElementById("strength-warning-banner");
    const statusLabel = document.getElementById("strength-status-label");
    const progressBar = document.getElementById("strength-progress-bar");

    const ruleLength = document.getElementById("rule-length");
    const ruleUppercase = document.getElementById("rule-uppercase");
    const ruleNumber = document.getElementById("rule-number");
    const ruleSpecial = document.getElementById("rule-special");

    // Update Rule Checkbox Items
    updateRuleItem(ruleLength, criteria.length, "8+ characters");
    updateRuleItem(ruleUppercase, criteria.uppercase, "1 uppercase (A-Z)");
    updateRuleItem(ruleNumber, criteria.number, "1 number (0-9)");
    updateRuleItem(ruleSpecial, criteria.special, "1 special (!@#$)");

    // Compute Strength Category
    let category = "weak";
    let pct = "25%";
    let labelText = "WEAK PASSWORD";

    if (!pwd) {
      pct = "0%";
      category = "weak";
      labelText = "WEAK PASSWORD";
    } else if (score < 3) {
      pct = score === 1 ? "25%" : "50%";
      category = "weak";
      labelText = "WEAK PASSWORD";
    } else if (score === 3) {
      pct = "75%";
      category = "medium";
      labelText = "MEDIUM PASSWORD";
    } else {
      pct = "100%";
      category = "strong";
      labelText = "STRONG PASSWORD";
    }

    // Update Progress Bar & Status Badge
    if (statusLabel) {
      statusLabel.textContent = labelText;
      statusLabel.className = `strength-status-badge ${category}`;
    }

    if (progressBar) {
      progressBar.style.width = pct;
      progressBar.className = `strength-progress-fill ${category}`;
    }

    // Update Warning Banner & Red Input Border
    if (warningBanner) {
      if (pwd.length > 0 && score < 3) {
        warningBanner.style.display = "flex";
        regPasswordInput.classList.add("input-error");
      } else {
        warningBanner.style.display = "none";
        regPasswordInput.classList.remove("input-error");
      }
    }
  }

  function updateRuleItem(el, passed, labelText) {
    if (!el) return;
    if (passed) {
      el.classList.add("passed");
      el.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${labelText}</span>
      `;
    } else {
      el.classList.remove("passed");
      el.innerHTML = `
        <span class="rule-icon" style="color:#9CA3AF; font-size:0.8rem;">○</span>
        <span>${labelText}</span>
      `;
    }
  }

  // 5. Sign-In Form Submission
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email")?.value;
      const pass = document.getElementById("login-password")?.value;
      const errorBanner = document.getElementById("login-error-banner");

      if (errorBanner) errorBanner.style.display = "none";

      try {
        const res = await signInUser({ email, password: pass });
        showAuthToast(res.message, "success");
        authModal?.classList.remove("active");
        document.body.style.overflow = "";
      } catch (err) {
        if (errorBanner) {
          errorBanner.textContent = err.message || "Failed to sign in.";
          errorBanner.style.display = "block";
        }
        showAuthToast(err.message, "error");
      }
    });
  }

  // 6. Registration Form Submission
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("reg-name")?.value;
      const email = document.getElementById("reg-email")?.value;
      const pass = document.getElementById("reg-password")?.value;
      const confirmPass = document.getElementById("reg-confirm-password")?.value;
      const errorBanner = document.getElementById("register-error-banner");

      if (errorBanner) errorBanner.style.display = "none";

      // A. Confirm Password Check
      if (pass !== confirmPass) {
        if (errorBanner) {
          errorBanner.textContent = "Passwords do not match. Please verify your password confirmation.";
          errorBanner.style.display = "block";
        }
        showAuthToast("Passwords do not match.", "error");
        return;
      }

      // B. Client-side Password Strength Check (>=3 of 4 rules required)
      const strengthEval = validatePasswordStrength(pass);
      if (!strengthEval.valid) {
        if (errorBanner) {
          errorBanner.textContent = "Weak password! Medium or Strong password is required (must satisfy at least 3 rules).";
          errorBanner.style.display = "block";
        }
        showAuthToast("Weak password! Medium or Strong password is required.", "error");
        return;
      }

      try {
        const res = await signUpUser({ email, password: pass, displayName: name });
        showAuthToast(res.message, "info");
        authModal?.classList.remove("active");
        document.body.style.overflow = "";

        // Switch active view back to WELCOME BACK (Login)
        if (registerView && loginView) {
          registerView.style.display = "none";
          loginView.style.display = "block";
        }
      } catch (err) {
        if (errorBanner) {
          errorBanner.textContent = err.message || "Failed to create account.";
          errorBanner.style.display = "block";
        }
        showAuthToast(err.message, "error");
      }
    });
  }

  // 7. Google Sign-In Buttons
  if (googleBtns.length > 0) {
    googleBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const res = await signInWithGoogle();
          showAuthToast(res.message, "success");
          authModal?.classList.remove("active");
          document.body.style.overflow = "";
        } catch (err) {
          showAuthToast(err.message, "error");
        }
      });
    });
  }

  // 8. Forgot Password Link
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const loginEmailInput = document.getElementById("login-email");
      let email = loginEmailInput ? loginEmailInput.value.trim() : "";

      if (!email) {
        email = prompt("Please enter your email address to receive a password reset link:");
      }

      if (email) {
        try {
          const res = await sendPasswordReset(email);
          showAuthToast(res.message, "success");
        } catch (err) {
          showAuthToast(err.message, "error");
        }
      }
    });
  }

  // 9. Sign Out Button
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      await signOut(auth);
      showAuthToast("Signed out successfully.", "info");
      authModal?.classList.remove("active");
      document.body.style.overflow = "";
      window.location.reload();
    });
  }

  // 10. Auth State Listener
  onAuthStateChanged(auth, (user) => {
    const custAvatar = document.getElementById("cust-avatar-initial");
    const custName = document.getElementById("cust-signedin-name");
    const custEmail = document.getElementById("cust-signedin-email");
    const navWishlistBtns = document.querySelectorAll("#nav-wishlist-btn, .nav-wishlist-btn");
    const navMyOrdersLinks = document.querySelectorAll(".nav-my-orders-link, a[href='orders.html']");

    if (user && !user.isAnonymous) {
      if (signedOutView) signedOutView.style.display = "none";
      if (signedInView) signedInView.style.display = "block";

      navWishlistBtns.forEach((btn) => (btn.style.display = "inline-flex"));
      navMyOrdersLinks.forEach((link) => (link.style.display = "inline-block"));

      const name = user.displayName || user.email?.split("@")[0] || "Customer";
      const initial = name.charAt(0).toUpperCase();

      if (custAvatar) custAvatar.textContent = initial;
      if (custName) custName.textContent = name;
      if (custEmail) custEmail.textContent = user.email || "";
    } else {
      if (signedOutView) signedOutView.style.display = "block";
      if (signedInView) signedInView.style.display = "none";

      navWishlistBtns.forEach((btn) => (btn.style.display = "none"));
      navMyOrdersLinks.forEach((link) => (link.style.display = "none"));
    }
  });
}

function showAuthToast(msg, type = "info") {
  if (window.showToast) {
    window.showToast(msg, type);
  } else {
    alert(msg);
  }
}
