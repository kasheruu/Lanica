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
  updateDoc,
  addDoc,
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
  if (s === "slot_reserved" || s === "slot reserved" || s === "reserved") return "Slot Reserved";
  if (
    s === "downpayment confirmed" ||
    s === "deposit confirmed" ||
    s === "deposit verified" ||
    s === "payment verified" ||
    s === "confirmed" ||
    s === "downpayment_paid" ||
    s === "accepted"
  ) {
    return "Deposit Verified";
  }
  if (
    s === "in production" ||
    s === "crafting" ||
    s === "fabrication" ||
    s === "upholstery" ||
    s === "processing" ||
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
  if (s === "completed" || s === "order completed") {
    return "Completed";
  }
  if (s === "delivered" || s === "arrived" || s === "received") {
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
 * Determines whether a customer has deposited (downpayment verified or full payment made).
 * Critical thesis defense business rule:
 * Staff can ONLY claim an unassigned order and set its branch (Pila vs Calamba)
 * AFTER customer deposit is verified.
 */
export function hasCustomerDeposited(order) {
  if (!order) return false;
  const st = normalizeOrderStatus(order.status).toLowerCase();
  if (
    st === "deposit verified" ||
    st === "downpayment confirmed" ||
    st === "confirmed" ||
    st === "in production" ||
    st === "quality checked" ||
    st === "shipped" ||
    st === "delivered" ||
    st === "completed"
  ) {
    return true;
  }
  if (Number(order.downpaymentPaid || 0) > 0) return true;
  if (order.depositVerified === true) return true;
  const payStatus = String(order.paymentStatus || "").toLowerCase();
  if (payStatus === "paid" || payStatus === "downpayment_paid" || payStatus === "partial_paid") {
    return true;
  }
  if (order.paymentOption === "full" && payStatus !== "unpaid" && payStatus !== "failed") {
    return true;
  }
  return false;
}

/**
 * Returns the explicitly assigned branch key ("pila" | "calamba") or null if unassigned.
 * Strict rule: NEVER guesses branch based on customer address/location automatically.
 */
export function getOrderBranchKey(order) {
  if (!order) return null;
  const raw = String(
    order.branch ||
    order.branchKey ||
    order.branchName ||
    order.pickupBranch ||
    order.storeBranch ||
    ""
  ).trim().toLowerCase();

  if (raw.includes("pila")) return "pila";
  if (raw.includes("calamba")) return "calamba";
  return null;
}

/**
 * Checks whether an order is cancellable by the customer.
 * Rule: For Made-to-Order furniture, cancellation is STRICTLY FORBIDDEN
 * once materials and crafting have started ("In Production" or later).
 * Only "Placed" or "Downpayment Confirmed" can be cancelled.
 */
export function isOrderCancellable(status) {
  const norm = normalizeOrderStatus(status);
  return (
    norm === "Placed" ||
    norm === "Slot Reserved" ||
    norm === "Deposit Verified" ||
    norm === "Downpayment Confirmed"
  );
}

/**
 * Categorizes an order record into active "Order Page" scope vs terminal "Transaction History" scope.
 *
 * Rules:
 * 1. "Order Page" Scope (Active / On-Process):
 *    - Orders currently in progress: "Placed", "Downpayment Confirmed", "In Production", "Quality Checked", "Shipped".
 *    - Orders marked "Delivered" where remaining balance is STILL PENDING (> 0).
 *    - Orders with active "Request Refund" pending admin review.
 *
 * 2. "Transaction History" Scope (Terminal / Resolved):
 *    - Orders marked "Delivered" AND remaining balance is completely SETTLED (<= 0).
 *    - "Refund Complete" / "refunded" orders.
 *    - "Cancelled" orders.
 *    - "Declined" orders.
 *
 * @param {Object} order
 * @returns {"active" | "history"}
 */
export function classifyOrderScope(order) {
  if (!order) return "history";

  const status = getOrderCanonicalStatus(order);
  const rawStatus = String(order.status || "")
    .trim()
    .toLowerCase();
  const rawOrderStatus = String(order.orderStatus || "")
    .trim()
    .toLowerCase();

  const totalVal = Number(order.totalAmount || order.total || 0);
  const isDownpayment =
    order.paymentOption === "downpayment" ||
    Number(order.downpaymentAmount) > 0 ||
    order.paymentMethod === "walk_in_cash" ||
    order.paymentType === "walk_in_cash";
  const isPaidDownpayment =
    order.paymentStatus === "downpayment_paid" ||
    order.paymentStatus === "Paid" ||
    order.paymentStatus === "paid" ||
    Boolean(order.paymentDetails?.downpaymentPaid);

  let remainingBalance = 0;
  if (order.remainingBalance !== undefined && order.remainingBalance !== null && !isNaN(Number(order.remainingBalance))) {
    remainingBalance = Number(order.remainingBalance);
  } else if (order.balanceDue !== undefined && order.balanceDue !== null && !isNaN(Number(order.balanceDue))) {
    remainingBalance = Number(order.balanceDue);
  } else if (isDownpayment) {
    const downpaymentDueAmount = Math.round(totalVal * 0.30);
    const paidVal = isPaidDownpayment ? Number(order.downpaymentAmount || downpaymentDueAmount) : 0;
    remainingBalance = Math.max(0, totalVal - paidVal);
  } else {
    remainingBalance = isPaidDownpayment ? 0 : totalVal;
  }

  const balanceStatus = String(order.balanceStatus || "")
    .trim()
    .toLowerCase();
  const isBalanceSettled =
    balanceStatus === "settled" ||
    order.isBalanceSettled === true ||
    order.balanceSettled === true ||
    (remainingBalance <= 0 && isPaidDownpayment);

  const refundStatus = String(order.refundStatus || "")
    .trim()
    .toLowerCase();
  const isRefundCompleted =
    refundStatus === "completed" ||
    refundStatus === "approved" ||
    status === "Refund Complete" ||
    status === "Refunded" ||
    rawStatus === "refunded" ||
    rawStatus === "refund complete";

  // 1. Terminal / Completed Statuses strictly belong to Transaction History:
  // - Cancelled
  // - Declined
  // - Refund Complete
  if (
    status === "Cancelled" ||
    status === "Declined" ||
    rawStatus === "cancelled" ||
    rawStatus === "canceled" ||
    rawStatus === "declined" ||
    rawOrderStatus === "cancelled" ||
    rawOrderStatus === "canceled" ||
    rawOrderStatus === "declined" ||
    isRefundCompleted
  ) {
    return "history";
  }

  // 2. Completed Orders:
  // - Orders marked "completed", "order completed", or orderReceived === true belong directly to History.
  if (
    status === "Completed" ||
    rawStatus === "completed" ||
    rawOrderStatus === "completed" ||
    order.orderReceived === true ||
    Boolean(order.completedAt) ||
    Boolean(order.orderReceivedAt)
  ) {
    return "history";
  }

  // 3. Delivered Orders:
  // - Delivered orders remain on the Active Orders page until the customer explicitly clicks "Order Received".
  // - Once the customer taps "Order Received", order.orderReceived is true (or status becomes "Completed"),
  //   which is caught above by rule #2 and routed to History.
  if (status === "Delivered" || rawStatus === "delivered" || rawOrderStatus === "delivered") {
    return "active";
  }

  // 4. Active / On-Process Orders (Placed, Downpayment Confirmed, In Production, Quality Checked, Shipped, or pending refund review)
  return "active";
}

/**
 * Checks whether an order is fully resolved/completed for financial ledger tracking.
 */
export function isOrderFullyResolved(order) {
  return classifyOrderScope(order) === "history";
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
    case "Slot Reserved":
      return 0;
    case "Deposit Verified":
    case "Downpayment Confirmed":
      return 1;
    case "In Production":
      return 2;
    case "Quality Checked":
      return 3;
    case "Shipped":
      return 4;
    case "Delivered":
    case "Completed":
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
    Boolean(Array.isArray(order.items) && order.items.some((i) => i.orderType === "Made-to-Order"));

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

  const formatShort = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const userMap = new Map();
  const customerMap = new Map();

  const emitMerged = () => {
    const mergedMap = new Map();
    // Merge orders from both userId and customerId queries
    for (const [id, order] of userMap.entries()) {
      mergedMap.set(id, order);
    }
    for (const [id, order] of customerMap.entries()) {
      mergedMap.set(id, order);
    }

    const orders = Array.from(mergedMap.values());

    // Sort in-memory by createdAt descending
    orders.sort((a, b) => {
      const getT = (val) => {
        if (!val) return 0;
        if (typeof val.toMillis === "function") return val.toMillis();
        if (val.seconds) return val.seconds * 1000;
        return new Date(val).getTime() || 0;
      };
      return getT(b.createdAt) - getT(a.createdAt);
    });

    if (typeof callback === "function") callback(orders);
  };

  const processSnapshot = (snapshot, targetMap) => {
    targetMap.clear();
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (!data.isDeleted && data.action !== "delete") {
        const canonicalStatus = getOrderCanonicalStatus(data);
        targetMap.set(docSnap.id, {
          orderId: docSnap.id,
          id: docSnap.id,
          ...data,
          canonicalStatus: canonicalStatus,
        });
      }
    });
    emitMerged();
  };

  // Dual query: matches orders placed on web (userId) and orders placed on mobile app (customerId)
  const qUser = query(ordersRef, where("userId", "==", userId));
  const qCustomer = query(ordersRef, where("customerId", "==", userId));

  const unsubUser = onSnapshot(
    qUser,
    (snapshot) => processSnapshot(snapshot, userMap),
    (error) => {
      console.error("Real-time order snapshot (userId) listener error:", error);
      if (typeof errorCallback === "function") errorCallback(error);
      else if (typeof callback === "function") callback([]);
    }
  );

  const unsubCustomer = onSnapshot(
    qCustomer,
    (snapshot) => processSnapshot(snapshot, customerMap),
    (error) => {
      console.warn("Real-time order snapshot (customerId) listener warning:", error);
    }
  );

  return () => {
    unsubUser();
    unsubCustomer();
  };
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

    if (orderData.userId !== userId && orderData.customerId !== userId) {
      throw new Error("Unauthorized to cancel this order.");
    }

    const currentStatus = getOrderCanonicalStatus(orderData);

    if (!isOrderCancellable(currentStatus)) {
      throw new Error(
        `Order cannot be cancelled because its status is already "${currentStatus}".`
      );
    }

    const cancellationPayload = {
      orderStatus: "Cancelled",
      status: "Cancelled",
      cancelledAt: serverTimestamp(),
      cancellationReason: String(reason || "").trim(),
      updatedAt: serverTimestamp(),
    };

    transaction.update(orderRef, cancellationPayload);
  });

  return { success: true, orderId };
}

/**
 * CUSTOMER REFUND REQUEST SUBMISSION FLOW
 */
export async function requestRefundAtomic({ orderId, userId, reason = "", details = "" }) {
  if (!orderId) throw new Error("Order ID is required.");
  if (!userId) throw new Error("User ID is required.");

  const orderRef = doc(db, "orders", orderId);

  await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) {
      throw new Error(`Order ${orderId} does not exist.`);
    }

    const orderData = orderSnap.data();
    if (orderData.userId !== userId) {
      throw new Error("Unauthorized to request refund for this order.");
    }

    transaction.update(orderRef, {
      refundStatus: "refund_requested",
      status: "cancellation_pending_review",
      orderStatus: "Cancellation Pending Review",
      refundReason: String(reason || "").trim(),
      refundDetails: String(details || "").trim(),
      refundRequestedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return { success: true, orderId };
}

/**
 * Executes the Enterprise Order Completion Process (Customer "ORDER RECEIVED" action).
 *
 * Spec Alignment:
 * 1. Prerequisite: role "customer", status "delivered", taps "ORDER RECEIVED".
 * 2. Firestore payload: { "status": "completed", "updatedAt": serverTimestamp() } (+ canonical fields).
 * 3. Side-effects:
 *    - Order Chat Bot (order_chats/{orderId}/messages & orders/{orderId}/messages):
 *      "Order status updated to COMPLETED."
 *
 * @param {string} orderId
 * @param {Object} [userInfo]
 * @returns {Promise<{success: boolean, orderId: string}>}
 */
export async function completeCustomerOrder(orderId, userInfo = null) {
  if (!orderId) throw new Error("Order ID is required to complete order.");

  const orderDocRef = doc(db, "orders", orderId);
  const now = serverTimestamp();

  // 1. Update Firestore Database Payload (Section 2 of Spec)
  await updateDoc(orderDocRef, {
    status: "completed",
    orderStatus: "completed",
    orderReceived: true,
    orderReceivedAt: now,
    completedAt: now,
    updatedAt: now,
  });

  // 2. Automated Chat Bot Broadcast (Section 3 of Spec)
  // Sends message: "Order status updated to COMPLETED."
  // Broadcasts to both mobile Flutter collection 'order_chats/{orderId}/messages'
  // and web collection 'orders/{orderId}/messages' for 100% cross-platform parity.
  const botMessagePayload = {
    text: "Order status updated to COMPLETED.",
    message: "Order status updated to COMPLETED.",
    content: "Order status updated to COMPLETED.",
    sender: "system",
    senderId: "system",
    senderName: "Lanica System Bot",
    senderRole: "system",
    role: "system",
    isSystem: true,
    type: 0,
    timestamp: now,
    createdAt: now,
  };

  try {
    const mobileChatCol = collection(db, "order_chats", orderId, "messages");
    await addDoc(mobileChatCol, botMessagePayload);
  } catch (err) {
    console.warn("Could not write to order_chats messages collection:", err);
  }

  try {
    const webChatCol = collection(db, "orders", orderId, "messages");
    await addDoc(webChatCol, botMessagePayload);
  } catch (err) {
    console.warn("Could not write to orders messages collection:", err);
  }

  // Update order document chat summary so admin/staff queues reflect the bot message
  try {
    await updateDoc(orderDocRef, {
      lastMessage: "Order status updated to COMPLETED.",
      lastMessageAt: now,
      lastSenderRole: "system",
      lastSenderName: "Lanica System Bot",
    });
  } catch (_) {}

  return { success: true, orderId };
}

export function getStatusNotificationMessage(orderId, newStatus) {
  const norm = normalizeOrderStatus(newStatus);
  const ref = orderId ? `#${String(orderId).slice(0, 8)}` : "your order";
  switch (norm) {
    case "slot reserved":
      return `✨ Order Reservation Confirmed (${ref}): Your reservation has been recorded. Our workshop team will review your custom specifications.`;
    case "downpayment confirmed":
      return `💰 Deposit Confirmed (${ref}): 30% downpayment received and verified. Your order is now queued for workshop fabrication!`;
    case "in production":
      return `🔨 In Production (${ref}): Our master artisans have officially begun woodworking, assembly, and upholstery for your handcrafted furniture!`;
    case "quality checked":
      return `🔍 Quality Inspection Passed (${ref}): Your custom furniture has passed final workshop quality control and is being packaged for dispatch!`;
    case "shipped":
      return `🚚 Out for Delivery (${ref}): Your order has been dispatched with our logistics team and is on its way to your delivery address!`;
    case "delivered":
      return `🎉 Order Delivered (${ref}): Your handcrafted furniture has arrived! Please inspect your piece and tap "Order Received" in your orders page to finalize.`;
    case "completed":
      return `🎉 Order Completed (${ref}): Thank you for trusting Lanica Furniture! Your official receipt is ready in your Completed Transactions History.`;
    case "cancelled":
      return `❌ Order Cancelled (${ref}): This order has been cancelled. Please contact workshop support if you need assistance.`;
    default:
      return `📢 Status Update (${ref}): Your order status is now ${newStatus.toUpperCase()}.`;
  }
}

export async function broadcastOrderStatusUpdate(orderId, newStatus, customNote = "") {
  if (!orderId || !newStatus) return;
  const orderDocRef = doc(db, "orders", orderId);
  const now = serverTimestamp();
  const textMsg = customNote
    ? `${getStatusNotificationMessage(orderId, newStatus)}\n${customNote}`
    : getStatusNotificationMessage(orderId, newStatus);

  const payload = {
    text: textMsg,
    message: textMsg,
    content: textMsg,
    sender: "system",
    senderId: "system",
    senderName: "Lanica System",
    senderRole: "system",
    role: "system",
    isSystem: true,
    type: 0,
    timestamp: now,
    createdAt: now,
  };

  try {
    const webCol = collection(db, "orders", orderId, "messages");
    await addDoc(webCol, payload);
  } catch (err) {
    console.warn("Could not write status update to orders/{id}/messages:", err);
  }

  try {
    const mobileCol = collection(db, "order_chats", orderId, "messages");
    await addDoc(mobileCol, payload);
  } catch (err) {
    console.warn("Could not write status update to order_chats/{id}/messages:", err);
  }

  try {
    await updateDoc(orderDocRef, {
      lastMessage: textMsg,
      lastMessageAt: now,
      lastSenderRole: "system",
      lastSenderName: "Lanica System",
    });
  } catch (_) {}
}
