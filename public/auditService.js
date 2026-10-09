/**
 * Lanica Furniture Platform - Centralized Audit Logging Service
 * Records system-wide security, inventory, order, and user operations.
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
 * Log a system activity event into Firestore audit_logs collection.
 * 
 * @param {string} actionType - Event verb e.g. 'AUTH_LOGIN', 'PRODUCT_UPDATE', 'STOCK_ADJUSTMENT', 'ORDER_STATUS_UPDATE'
 * @param {string|object} details - Human-readable summary or structured details object
 * @param {object} metadata - Optional additional context (e.g. { targetId, userRole, category })
 */
export async function logActivity(actionType, details, metadata = {}) {
  try {
    const user = auth.currentUser;
    const userId = user ? user.uid : (metadata.userId || "anonymous");
    const userEmail = user ? (user.email || "") : (metadata.userEmail || "");
    const userName = user ? (user.displayName || user.name || user.email?.split("@")[0] || "System User") : (metadata.userName || "System");
    const userRole = metadata.userRole || (user ? (user.role || "staff") : "system");

    const detailText = typeof details === "object" ? JSON.stringify(details) : String(details || "");

    const logEntry = {
      userId,
      userEmail,
      userName,
      userRole,
      action: actionType,
      actionType,
      details: detailText,
      metadata: typeof details === "object" ? details : metadata,
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      success: metadata.success !== false,
    };

    await addDoc(collection(db, "audit_logs"), logEntry);
    console.log(`[AuditLog] ${actionType} recorded by ${userName} (${userRole}): ${detailText}`);
  } catch (err) {
    console.warn("[AuditLog] Failed to log activity:", err);
  }
}

/**
 * Fetch audit logs from Firestore.
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
      const data = docSnap.data();
      logs.push({
        id: docSnap.id,
        ...data,
      });
    });
    return logs;
  } catch (err) {
    console.warn("Fallback fetching audit logs without order:", err);
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
