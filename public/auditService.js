/**
 * Lanica Furniture Platform - Enterprise-Grade Centralized Audit Logging Service
 * Records system-wide security, inventory, order, and user operations.
 * Immutable / Append-Only: No update or delete operations permitted.
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { db, auth } from "./firebaseConfig.js";

/**
 * Record an immutable audit log entry into Firestore `audit_logs` collection.
 * 
 * @param {Object} params
 * @param {"ORDER_DELETED"|"ORDER_STATUS_CHANGED"|"DOWNPAYMENT_RECEIVED"|"ORDER_ACCEPTED"|"PRODUCT_CREATED"|"PRODUCT_UPDATED"|"PRODUCT_DELETED"|"SETTINGS_CHANGED"} params.action
 * @param {"order"|"product"|"user"|"settings"} params.targetType
 * @param {string} params.targetId
 * @param {string} params.description
 * @param {Object} [params.diff] - State snapshot/diff e.g. { before: {...}, after: {...} }
 * @param {Object} [params.performedBy] - Explicit actor override e.g. currentUser
 */
export async function recordAuditLog({
  action,
  targetType = "order",
  targetId = "",
  description = "",
  diff = {},
  performedBy = null,
}) {
  try {
    const user = performedBy || auth?.currentUser;
    const uid = user ? (user.uid || "system") : "system";
    const email = user ? (user.email || "No email") : "system";
    const displayName = user
      ? (user.displayName || user.name || (user.email ? user.email.split("@")[0] : "Admin Staff"))
      : "System Automated";
    let detectedRole = (user && user.role) ? user.role : null;
    if (!detectedRole && typeof window !== "undefined") {
      const path = (window.location.pathname || "").toLowerCase();
      if (path.includes("staff")) {
        detectedRole = "staff";
      } else if (path.includes("admin")) {
        detectedRole = "admin";
      } else {
        detectedRole = sessionStorage.getItem("userRole") || (user && user.uid ? "staff" : "system");
      }
    }
    const role = detectedRole || (user && user.uid ? "staff" : "system");

    const clientDateString = new Date().toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + " PST";

    const logPayload = {
      // 1. WHO
      performedBy: {
        uid: String(uid),
        email: String(email),
        displayName: String(displayName),
        role: String(role).toLowerCase(),
      },

      // 2. WHAT
      action: String(action),
      targetType: String(targetType),
      targetId: String(targetId || ""),
      description: String(description || ""),

      // STATE SNAPSHOT / DIFF (Before vs After)
      diff: diff && typeof diff === "object" ? diff : {},

      // 3. WHEN
      timestamp: serverTimestamp(),
      clientFormattedDate: clientDateString,
      createdAt: new Date().toISOString(),

      // Legacy compatibility fields
      userId: String(uid),
      userEmail: String(email),
      userName: String(displayName),
      userRole: String(role).toLowerCase(),
      actionType: String(action),
      details: String(description || ""),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    };

    const docRef = await addDoc(collection(db, "audit_logs"), logPayload);
    console.log(`[AuditTrail] Log #${docRef.id} recorded: [${action}] on ${targetType} #${targetId} by ${displayName}`);
    return docRef.id;
  } catch (error) {
    console.error("[AuditTrail] Failed to write audit log:", error);
    return null;
  }
}

/**
 * Backward compatibility helper for legacy logActivity calls.
 */
export async function logActivity(actionType, details, metadata = {}) {
  const description = typeof details === "object" ? JSON.stringify(details) : String(details || "");
  const targetType = metadata.targetType || (
    actionType.includes("ORDER") ? "order" :
    actionType.includes("PRODUCT") ? "product" :
    actionType.includes("USER") ? "user" : "settings"
  );
  const targetId = metadata.targetId || metadata.productId || metadata.orderId || metadata.userId || "";
  const diff = metadata.diff || (typeof details === "object" ? details : {});

  return recordAuditLog({
    action: actionType,
    targetType,
    targetId,
    description,
    diff,
    performedBy: metadata.performedBy || null,
  });
}

/**
 * Fetch immutable audit logs from Firestore.
 */
export async function fetchAuditLogs(maxLogs = 300) {
  try {
    const q = query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(maxLogs)
    );
    const snap = await getDocs(q);
    const logs = [];
    snap.forEach((docSnap) => {
      logs.push({
        id: docSnap.id,
        ...docSnap.data(),
      });
    });
    return logs;
  } catch (err) {
    console.warn("Fallback fetching audit logs without index ordering:", err);
    const snap = await getDocs(collection(db, "audit_logs"));
    const logs = [];
    snap.forEach((docSnap) => {
      logs.push({ id: docSnap.id, ...docSnap.data() });
    });
    logs.sort((a, b) => {
      const getMs = (l) =>
        l.timestamp?.toMillis?.() ||
        (l.createdAt ? new Date(l.createdAt).getTime() : 0);
      return getMs(b) - getMs(a);
    });
    return logs.slice(0, maxLogs);
  }
}
