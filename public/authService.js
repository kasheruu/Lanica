import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
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

export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * Client-Side Password Validation (3 out of 4 criteria required)
 * 1. Length >= 8 characters
 * 2. At least 1 uppercase letter (A-Z)
 * 3. At least 1 numeric digit (0-9)
 * 4. At least 1 special character ([!@#$%^&*()_+\-=\[\]{}|;:'",.<>/?])
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== "string") {
    return {
      valid: false,
      score: 0,
      criteria: { length: false, uppercase: false, number: false, special: false },
      message: "Password is required.",
    };
  }

  const length = password.length >= 8;
  const uppercase = /[A-Z]/.test(password);
  const number = /[0-9]/.test(password);
  const special = /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\~`-]/.test(password);

  const criteriaList = [
    { key: "length", pass: length, label: "At least 8 characters" },
    { key: "uppercase", pass: uppercase, label: "At least 1 uppercase letter (A-Z)" },
    { key: "number", pass: number, label: "At least 1 numeric digit (0-9)" },
    { key: "special", pass: special, label: "At least 1 special character" },
  ];

  const passedCount = criteriaList.filter((c) => c.pass).length;
  const valid = passedCount >= 3;

  let message = "";
  if (!valid) {
    const missing = criteriaList.filter((c) => !c.pass).map((c) => c.label);
    message = `Password must meet at least 3 out of 4 criteria. Missing criteria: ${missing.join(", ")}.`;
  }

  return {
    valid,
    score: passedCount,
    criteria: { length, uppercase, number, special },
    message,
  };
}

/**
 * Friendly Firebase Auth error mapping
 */
export function getFriendlyAuthErrorMessage(error) {
  if (!error) return "An unexpected error occurred.";
  const code = error.code || "";
  switch (code) {
    case "auth/email-already-in-use":
      return "This email address is already registered. Please sign in instead.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password. Please verify your credentials.";
    case "auth/user-not-found":
      return "No account found with this email address.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password is too weak. Please meet the required password strength criteria.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again later.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/multi-factor-auth-required":
      return "Multi-Factor Authentication (MFA) is required for this account.";
    case "auth/popup-closed-by-user":
      return "Google Sign-In was cancelled.";
    case "auth/requires-recent-login":
      return "Please re-authenticate before performing this action.";
    default:
      return error.message || "An authentication error occurred. Please try again.";
  }
}

/**
 * Sign-Up Flow (Email & Password)
 * 1. Validate password strength.
 * 2. Call createUserWithEmailAndPassword.
 * 3. Call sendEmailVerification.
 * 4. Update display name via updateProfile.
 * 5. Create/merge user document in Firestore at users/{uid}.
 * 6. Immediately call signOut(auth) to prevent unverified session access.
 * 7. Return user notification message.
 */
export async function signUpUser({ email, password, displayName }) {
  // Step 1: Validate password strength
  const passEval = validatePasswordStrength(password);
  if (!passEval.valid) {
    throw new Error(passEval.message);
  }

  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanDisplayName = String(displayName || "").trim() || cleanEmail.split("@")[0];

  let userCredential;
  try {
    userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  } catch (err) {
    throw new Error(getFriendlyAuthErrorMessage(err));
  }

  const user = userCredential.user;

  // Step 3: Send verification email
  try {
    await sendEmailVerification(user);
  } catch (verr) {
    console.warn("Could not send verification email immediately:", verr);
  }

  // Step 4: Update display name
  try {
    await updateProfile(user, { displayName: cleanDisplayName });
  } catch (perr) {
    console.warn("Could not update profile display name immediately:", perr);
  }

  // Step 5: Create/merge user document in Firestore at users/{uid}
  const userRef = doc(db, "users", user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: cleanEmail,
      displayName: cleanDisplayName,
      role: "customer",
      isEmailVerified: false,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    },
    { merge: true }
  );

  // Step 6: Immediately sign out to prevent unverified session access
  await signOut(auth);

  // Step 7: Return notification
  return {
    success: true,
    user,
    message: "Verification Link Sent - Please check your inbox before logging in.",
  };
}

/**
 * Sign-In Flow (Email & Password)
 * 1. Call signInWithEmailAndPassword.
 * 2. Check email verification status via Firestore & Auth user.emailVerified.
 * 3. Catch MFA and return resolver if required.
 * 4. On success: update lastLogin in users/{uid}.
 */
export async function signInUser({ email, password }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  let userCredential;

  try {
    userCredential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  } catch (err) {
    if (err.code === "auth/multi-factor-auth-required") {
      err.isMfaRequired = true;
      throw err;
    }
    throw new Error(getFriendlyAuthErrorMessage(err));
  }

  const user = userCredential.user;

  // Step 2: Check email verification status
  const userRef = doc(db, "users", user.uid);
  const userDocSnap = await getDoc(userRef);
  const userData = userDocSnap.exists() ? userDocSnap.data() : {};

  const isVerified =
    Boolean(user.emailVerified) ||
    Boolean(userData.isEmailVerified) ||
    Boolean(userData.emailVerified) ||
    Boolean(userData.verified) ||
    Boolean(userData.preSeeded) ||
    userData.role === "admin" ||
    userData.role === "staff";

  if (!isVerified) {
    await signOut(auth);
    throw new Error("Please verify your email address before logging in.");
  }

  // Step 4: Update lastLogin in Firestore
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || userData.displayName || user.email.split("@")[0],
      role: userData.role || "customer",
      isEmailVerified: true,
      lastLogin: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    success: true,
    user,
    message: "Signed in successfully!",
  };
}

/**
 * Multi-Factor Authentication (SMS MFA) - Initiate Challenge
 */
export async function initiateMfaVerification(multiFactorError, phoneIndex = 0, recaptchaVerifier) {
  const resolver = getMultiFactorResolver(auth, multiFactorError);
  const phoneHint = resolver.hints[phoneIndex];
  if (!phoneHint) {
    throw new Error("No MFA phone number option available for this account.");
  }
  const phoneAuthProvider = new PhoneAuthProvider(auth);
  const verificationId = await phoneAuthProvider.verifyPhoneNumber(
    { multiFactorHint: phoneHint, session: resolver.session },
    recaptchaVerifier
  );
  return { resolver, verificationId, phoneHint };
}

/**
 * Multi-Factor Authentication (SMS MFA) - Resolve Code
 */
export async function completeMfaSignIn(resolver, verificationId, verificationCode) {
  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const multiFactorAssertion = PhoneMultiFactorGenerator.assertion(cred);
  const userCredential = await resolver.resolveSignIn(multiFactorAssertion);
  const user = userCredential.user;

  const userRef = doc(db, "users", user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email,
      lastLogin: serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, user, message: "MFA Verification successful!" };
}

/**
 * Google Sign-In Flow
 * 1. Trigger Google OAuth.
 * 2. Sync/merge document to users/{uid}.
 * 3. Return user (Google accounts bypass manual email verification).
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  let userCredential;
  try {
    userCredential = await signInWithPopup(auth, provider);
  } catch (err) {
    throw new Error(getFriendlyAuthErrorMessage(err));
  }

  const user = userCredential.user;
  const userRef = doc(db, "users", user.uid);
  const userDocSnap = await getDoc(userRef);

  if (!userDocSnap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || user.email.split("@")[0],
      role: "customer",
      isEmailVerified: true,
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
    });
  } else {
    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email.split("@")[0],
        isEmailVerified: true,
        lastLogin: serverTimestamp(),
      },
      { merge: true }
    );
  }

  return {
    success: true,
    user,
    message: "Signed in with Google successfully!",
  };
}

/**
 * Password Reset Flow
 * 1. Call sendPasswordResetEmail.
 * 2. Return confirmation message.
 */
export async function sendPasswordReset(email) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error("Please enter your email address to reset your password.");
  }

  try {
    await sendPasswordResetEmail(auth, cleanEmail);
    return {
      success: true,
      message: "Password reset link sent to your email address.",
    };
  } catch (err) {
    throw new Error(getFriendlyAuthErrorMessage(err));
  }
}
