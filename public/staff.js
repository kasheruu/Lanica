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
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
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
const saveProfileBtn = document.getElementById("staff-save-profile");
const profileHintEl = document.getElementById("staff-profile-hint");
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
    (order.shippingAddress && pickFirstNonEmpty(order.shippingAddress.fullName, order.shippingAddress.name)) ||
    (order.deliveryAddress && pickFirstNonEmpty(order.deliveryAddress.fullName, order.deliveryAddress.name)) ||
    (order.address && pickFirstNonEmpty(order.address.fullName, order.address.name)) ||
    (order.shippingInfo && pickFirstNonEmpty(order.shippingInfo.fullName, order.shippingInfo.name)) ||
    (order.customer && pickFirstNonEmpty(order.customer.fullName, order.customer.name)) ||
    "";

  return pickFirstNonEmpty(
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
  ) || "—";
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

  if (customerId && customerNameByUid.has(customerId)) return customerNameByUid.get(customerId) || "";
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
    ["pending", "accepted", "processing", "shipped", "delivered", "declined", "completed", "received"].includes(
      s
    )
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

async function updateOrderStatus(orderId, newStatus) {
  try {
    const orderRef = doc(db, "orders", orderId);
    await updateDoc(orderRef, {
      status: newStatus,
      updatedAt: Timestamp.now(),
      updatedByUid: currentUser ? currentUser.uid : null,
    });
  } catch (e) {
    console.error("Failed to update order:", e);
    alert("Failed to update order status.");
  }
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
    if (!snap.empty) {
      return ((snap.docs[0].data() || {}).role || "").toLowerCase();
    }
  } catch (e) {
    console.warn("Could not read user role by email:", e);
  }
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
    if (staffAccountNameEl) {
      staffAccountNameEl.textContent = nm || currentUser.displayName || currentUser.email || "My Account";
    }
    if (staffAvatarEl) {
      if (profilePhoto) {
        staffAvatarEl.src = profilePhoto;
      } else {
        const fallbackName = nm || currentUser.displayName || currentUser.email || "Staff";
        staffAvatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          fallbackName
        )}&background=111827&color=fff&size=128`;
      }
    }
  } catch (e) {
    console.warn("Could not load staff profile:", e);
  }
}

async function saveMyProfile(displayName) {
  if (!currentUser) return;
  const trimmed = String(displayName || "").trim();
  if (!trimmed) throw new Error("Name is required.");

  // Ensure the user's profile doc exists and is up to date.
  await setDoc(
    doc(db, "users", currentUser.uid),
    {
      role: "staff",
      email: currentUser.email || null,
      displayName: trimmed,
      name: trimmed,
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
  const role = await getUserRole(user);
  if (role !== "staff") {
    window.location.replace("/admin.html");
    return;
  }

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

if (profileForm && displayNameInput) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saveProfileBtn) {
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = "Saving...";
    }
    if (profileHintEl) profileHintEl.textContent = "Saving…";
    try {
      await saveMyProfile(displayNameInput.value);
      if (profileHintEl)
        profileHintEl.textContent = "Saved. Admin assignment list will show your name.";
      if (staffAccountNameEl) {
        const updatedName = String(displayNameInput.value || "").trim();
        if (updatedName) staffAccountNameEl.textContent = updatedName;
      }
    } catch (err) {
      console.error(err);
      if (profileHintEl) profileHintEl.textContent = err.message || "Could not save profile.";
      alert(err.message || "Could not save profile.");
    } finally {
      if (saveProfileBtn) {
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = "Save";
      }
    }
  });
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
