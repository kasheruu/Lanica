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
 * Standardizes order status values into Made-to-Order Canonical Strings:
 * 0. "Placed"                 (Step 0: Order received, awaiting downpayment/review)
 * 1. "Downpayment Confirmed"  (Step 1: Downpayment/payment confirmed, ready for crafting)
 * 2. "In Production"          (Step 2: Carpentry/framing, upholstery & crafting active)
 * 3. "Quality Checked"        (Step 3: Crafting complete, passed QC inspection)
 * 4. "Shipped"                (Step 4: Out for delivery / dispatched)
 * 5. "Delivered"              (Step 5: Handed over to client)
 * -1. "Cancelled"             (-1: Cancelled prior to production)
 */
export function normalizeOrderStatus(rawStatus) {
  if (!rawStatus) return "Placed";
  const s = String(rawStatus).trim().toLowerCase();

  if (s === "pending" || s === "order placed" || s === "placed") return "Placed";
  if (
    s === "downpayment confirmed" ||
    s === "deposit confirmed" ||
    s === "payment verified" ||
    s === "confirmed"
  ) {
    return "Downpayment Confirmed";
  }
  if (
    s === "in production" ||
    s === "crafting" ||
    s === "fabrication" ||
    s === "upholstery" ||
    s === "processing" ||
    s === "accepted" ||
    s === "packed"
  ) {
    return "In Production";
  }
  if (
    s === "quality checked" ||
    s === "quality check" ||
    s === "ready" ||
    s === "ready to ship" ||
    s === "ready for delivery"
  ) {
    return "Quality Checked";
  }
  if (
    s === "to ship" ||
    s === "shipped" ||
    s === "shipping" ||
    s === "in transit" ||
    s === "to receive" ||
    s === "out for delivery"
  ) {
    return "Shipped";
  }
  if (s === "delivered" || s === "completed" || s === "arrived" || s === "received") {
    return "Delivered";
  }
  if (s === "cancelled" || s === "canceled" || s === "declined") {
    return "Cancelled";
  }

  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Intelligently resolves the active canonical status from an order object.
 * Checks both `status` and `orderStatus` and prioritizes status updates.
 */
export function getOrderCanonicalStatus(order) {
  if (!order) return "Placed";
  const rawStatus = order.status;
  const rawOrderStatus = order.orderStatus;

  const normStatus = rawStatus ? normalizeOrderStatus(rawStatus) : null;
  const normOrderStatus = rawOrderStatus ? normalizeOrderStatus(rawOrderStatus) : null;

  if (normStatus && normStatus !== "Placed") return normStatus;
  if (normOrderStatus && normOrderStatus !== "Placed") return normOrderStatus;

  return normStatus || normOrderStatus || "Placed";
}

/**
 * Helper to retrieve assigned Rider / Staff name from order.
 */
export function getRiderName(order) {
  if (!order) return null;
  return (
    order.assignedToName ||
    order.riderName ||
    order.staffName ||
    (typeof order.assignedTo === "string" ? order.assignedTo : null)
  );
}

/**
 * Checks whether an order is cancellable by the customer.
 * Rule: For Made-to-Order furniture, cancellation is STRICTLY FORBIDDEN
 * once materials and crafting have started ("In Production" or later).
 * Only "Placed" or "Downpayment Confirmed" can be cancelled.
 */
export function isOrderCancellable(status) {
  const norm = normalizeOrderStatus(status);
  return norm === "Placed" || norm === "Downpayment Confirmed";
}

/**
 * Returns tracking step index matching the 6-Stage Made-to-Order Stepper:
 * 0: PLACED
 * 1: DOWNPAYMENT CONFIRMED
 * 2: IN PRODUCTION
 * 3: QUALITY CHECKED
 * 4: SHIPPED
 * 5: DELIVERED
 * Returns -1 for Cancelled
 */
export function getTrackingStepIndex(status) {
  const norm = normalizeOrderStatus(status);
  switch (norm) {
    case "Placed":
      return 0;
    case "Downpayment Confirmed":
      return 1;
    case "In Production":
      return 2;
    case "Quality Checked":
      return 3;
    case "Shipped":
      return 4;
    case "Delivered":
      return 5;
    case "Cancelled":
    default:
      return -1;
  }
}

/**
 * Calculates or formats estimated delivery date window.
 * For Made-to-Order items: Default is 14 to 21 business days lead time.
 * For Ready-to-Ship items: 3 to 5 business days.
 * Syncs with admin/staff overrides.
 */
export function calculateEstimatedDelivery(orderOrCreatedAt) {
  let order = {};
  let createdAt;

  if (
    orderOrCreatedAt &&
    typeof orderOrCreatedAt === "object" &&
    !orderOrCreatedAt.seconds &&
    !orderOrCreatedAt.toDate
  ) {
    order = orderOrCreatedAt;
    createdAt = order.createdAt;
  } else {
    createdAt = orderOrCreatedAt;
  }

  // Check for admin/staff manual override or specific min/max estimate strings
  if (order.estimatedDeliveryMin && order.estimatedDeliveryMax) {
    if (order.estimatedDeliveryMin === order.estimatedDeliveryMax) {
      return order.estimatedDeliveryMin;
    }
    return `${order.estimatedDeliveryMin} - ${order.estimatedDeliveryMax}`;
  }
  if (order.manualDeliveryOverride) {
    return order.manualDeliveryOverride;
  }
  if (order.estimatedDeliveryDate) {
    return order.estimatedDeliveryDate;
  }

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

  const isMTO =
    order.isMadeToOrder ||
    Boolean(
      Array.isArray(order.items) &&
        order.items.some((i) => i.orderType === "Made-to-Order")
    );

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

  const minDays = isMTO ? 14 : 3;
  const maxDays = isMTO ? 21 : 5;

  const minDate = addBusinessDays(baseDate, minDays);
  const maxDate = addBusinessDays(baseDate, maxDays);

  const formatShort = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const formatFull = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (minDate.getMonth() === maxDate.getMonth()) {
    return `${formatShort(minDate)} - ${maxDate.getDate()}, ${maxDate.getFullYear()}${isMTO ? " (Crafting Lead Time)" : ""}`;
  }
  return `${formatShort(minDate)} - ${formatFull(maxDate)}${isMTO ? " (Crafting Lead Time)" : ""}`;
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
 * Real-Time Customer Orders Subscription Hook / Listener (`onSnapshot`).
 * Queries collection(db, "orders") where userId == auth.currentUser.uid ordered by createdAt desc.
 * Reactively updates component state whenever admin or staff modifies order documents.
 */
export function subscribeToUserOrders(userId, callback, errorCallback) {
  if (!userId) {
    if (typeof callback === "function") callback([]);
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
      const orders = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const canonicalStatus = getOrderCanonicalStatus(data);
        return {
          orderId: docSnap.id,
          id: docSnap.id,
          ...data,
          canonicalStatus: canonicalStatus,
        };
      });
      if (typeof callback === "function") callback(orders);
    },
    (error) => {
      console.error("Real-time order snapshot listener error:", error);
      if (typeof errorCallback === "function") errorCallback(error);
      else if (typeof callback === "function") callback([]);
    }
  );
}

/**
 * Custom Hook Alias for useCustomerOrders(userId, callback)
 */
export function useCustomerOrders(userId, callback, errorCallback) {
  return subscribeToUserOrders(userId, callback, errorCallback);
}

/**
 * ATOMIC ORDER CANCELLATION FLOW WITH INVENTORY ROLLBACK
 */
export async function cancelOrderAtomic({ orderId, userId, reason = "" }) {
  if (!orderId) throw new Error("Order ID is required to cancel an order.");
  if (!userId) throw new Error("User ID is required.");

  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);

    if (!orderSnap.exists()) {
      throw new Error(`Order ${orderId} does not exist.`);
    }

    const orderData = orderSnap.data();

    if (orderData.userId !== userId) {
      throw new Error("Unauthorized to cancel this order.");
    }

    const currentStatus = getOrderCanonicalStatus(orderData);

    if (!isOrderCancellable(currentStatus)) {
      throw new Error(
        `Order cannot be cancelled because its status is already "${currentStatus}".`
      );
    }

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

      if (typeof pData.stock === "number") {
        updatePayload.stock = pData.stock + qty;
      }

      if (Object.keys(updatePayload).length > 0) {
        transaction.update(productRef, updatePayload);
      }
    }

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
