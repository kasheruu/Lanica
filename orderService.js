import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
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
export { ensureAuth } from "./cartService.js";

/**
 * Standardizes order status values into canonical UI strings.
 * Canonical statuses: "Pending", "Processing", "To Ship", "To Receive", "Delivered", "Cancelled"
 */
export function normalizeOrderStatus(rawStatus) {
  if (!rawStatus) return "Pending";
  const s = String(rawStatus).trim().toLowerCase();
  
  if (s === "pending" || s === "order placed") return "Pending";
  if (s === "processing" || s === "accepted") return "Processing";
  if (s === "to ship" || s === "shipped" || s === "shipping") return "To Ship";
  if (s === "to receive" || s === "out for delivery" || s === "in transit") return "To Receive";
  if (s === "delivered" || s === "completed" || s === "received") return "Delivered";
  if (s === "cancelled" || s === "canceled" || s === "declined") return "Cancelled";
  
  // Capitalize fallback
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Checks whether an order is cancellable by the customer.
 * Strict Rule: Only "Pending" or "Processing" orders can be cancelled.
 */
export function isOrderCancellable(status) {
  const norm = normalizeOrderStatus(status);
  return norm === "Pending" || norm === "Processing";
}

/**
 * Returns tracking step index for the visual progress stepper:
 * 0: Order Placed (Pending)
 * 1: Processing
 * 2: To Ship
 * 3: To Receive
 * 4: Delivered
 * Returns -1 for Cancelled
 */
export function getTrackingStepIndex(status) {
  const norm = normalizeOrderStatus(status);
  switch (norm) {
    case "Pending":
      return 0;
    case "Processing":
      return 1;
    case "To Ship":
      return 2;
    case "To Receive":
      return 3;
    case "Delivered":
      return 4;
    case "Cancelled":
    default:
      return -1;
  }
}

/**
 * Calculates estimated delivery date window (+3 to +5 business days from order placement).
 */
export function calculateEstimatedDelivery(createdAt) {
  let baseDate = new Date();
  if (createdAt) {
    if (typeof createdAt.toDate === "function") {
      baseDate = createdAt.toDate();
    } else if (createdAt.seconds) {
      baseDate = new Date(createdAt.seconds * 1000);
    } else {
      const parsed = new Date(createdAt);
      if (!isNaN(parsed.getTime())) baseDate = parsed;
    }
  }

  // Add business days helper
  const addBusinessDays = (date, days) => {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const dayOfWeek = result.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        added++;
      }
    }
    return result;
  };

  const minDate = addBusinessDays(baseDate, 3);
  const maxDate = addBusinessDays(baseDate, 5);

  const formatShort = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatFull = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (minDate.getMonth() === maxDate.getMonth()) {
    return `${formatShort(minDate)} - ${maxDate.getDate()}, ${maxDate.getFullYear()}`;
  }
  return `${formatShort(minDate)} - ${formatFull(maxDate)}`;
}

/**
 * Formats Firestore timestamps to readable string.
 */
export function formatOrderDate(createdAt) {
  if (!createdAt) return "N/A";
  let d = new Date();
  if (typeof createdAt.toDate === "function") {
    d = createdAt.toDate();
  } else if (createdAt.seconds) {
    d = new Date(createdAt.seconds * 1000);
  } else {
    const parsed = new Date(createdAt);
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Real-time listener for customer orders.
 * Path: orders/ where userId == auth.currentUser.uid ordered by createdAt desc.
 */
export function subscribeToUserOrders(userId, callback) {
  if (!userId) {
    callback([]);
    return () => {};
  }

  const ordersRef = collection(db, "orders");
  const q = query(
    ordersRef,
    where("userId", "==", userId),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const orders = snapshot.docs.map((docSnap) => ({
        orderId: docSnap.id,
        id: docSnap.id,
        ...docSnap.data(),
      }));
      callback(orders);
    },
    (error) => {
      console.error("Order history snapshot listener error:", error);
      callback([]);
    }
  );
}

/**
 * ATOMIC ORDER CANCELLATION FLOW WITH INVENTORY ROLLBACK (Phase 5 Synchronization)
 * Executes a Firestore Atomic Transaction:
 * 1. Verify Current Status (must be "Pending" or "Processing")
 * 2. Restock Inventory (increments FabricStocks, LeatherStocks, or stock for each item)
 * 3. Status Update (orderStatus = "Cancelled", status = "Cancelled", cancelledAt = serverTimestamp())
 */
export async function cancelOrderAtomic({ orderId, userId, reason = "" }) {
  if (!orderId) throw new Error("Order ID is required to cancel an order.");
  if (!userId) throw new Error("User ID is required.");

  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async (transaction) => {
    // Step 1: Read order document inside transaction to verify status
    const orderSnap = await transaction.get(orderRef);

    if (!orderSnap.exists()) {
      throw new Error(`Order ${orderId} does not exist.`);
    }

    const orderData = orderSnap.data();

    if (orderData.userId !== userId) {
      throw new Error("Unauthorized to cancel this order.");
    }

    const currentStatus = normalizeOrderStatus(orderData.orderStatus || orderData.status);

    if (!isOrderCancellable(currentStatus)) {
      throw new Error(
        `Order cannot be cancelled because its status is already "${currentStatus}".`
      );
    }

    // Step 2: Restock Inventory for each item
    const items = Array.isArray(orderData.items) ? orderData.items : [];

    for (const item of items) {
      if (!item.productId) continue;

      const productRef = doc(db, "products", item.productId);
      const productSnap = await transaction.get(productRef);

      if (!productSnap.exists()) {
        console.warn(`Product ${item.productId} not found during stock rollback.`);
        continue;
      }

      const pData = productSnap.data();
      const mat = (item.material || "Fabric").toLowerCase();
      const qty = Math.max(1, Number(item.quantity || 1));

      const updatePayload = {};

      // Restock material variant stocks if present
      if (mat === "fabric") {
        if (typeof pData.FabricStocks === "number") {
          updatePayload.FabricStocks = pData.FabricStocks + qty;
        }
        if (typeof pData.fabricStock === "number") {
          updatePayload.fabricStock = pData.fabricStock + qty;
        }
      } else if (mat === "leather") {
        if (typeof pData.LeatherStocks === "number") {
          updatePayload.LeatherStocks = pData.LeatherStocks + qty;
        }
        if (typeof pData.leatherStock === "number") {
          updatePayload.leatherStock = pData.leatherStock + qty;
        }
      }

      // Restock general stock field
      if (typeof pData.stock === "number") {
        updatePayload.stock = pData.stock + qty;
      }

      if (Object.keys(updatePayload).length > 0) {
        transaction.update(productRef, updatePayload);
      }
    }

    // Step 3: Update Order Document Status to Cancelled
    const cancellationPayload = {
      orderStatus: "Cancelled",
      status: "Cancelled",
      cancelledAt: serverTimestamp(),
      cancellationReason: String(reason || "").trim(),
    };

    transaction.update(orderRef, cancellationPayload);
  });

  return { success: true, orderId };
}
