import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
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
  if (role === "staff") {
    window.location.replace("/staff.html");
    return;
  }
  window.location.replace("/admin.html");
}

// Check if user is already logged in
onAuthStateChanged(auth, (user) => {
  if (user) {
    routeUserByRole(user);
  }
});

// Handle Login Form Submission
const loginForm = document.getElementById("login-form");
const errorMsg = document.getElementById("login-error");
const submitBtn = document.querySelector(".login-btn");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("admin-email").value;
    const password = document.getElementById("admin-pwd").value;

    try {
      submitBtn.textContent = "Verifying...";
      submitBtn.disabled = true;
      errorMsg.textContent = "";

      // Attempt Sign In
      await signInWithEmailAndPassword(auth, email, password);

      // Success! The onAuthStateChanged listener will route to admin/staff dashboard.
    } catch (error) {
      console.error("Login Error:", error);
      submitBtn.textContent = "Sign In";
      submitBtn.disabled = false;

      // Provide user-friendly error messages
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
  });
}
