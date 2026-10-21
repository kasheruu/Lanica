import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-storage.js";

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
export const storage = getStorage(app);

/**
 * Fetches all orders belonging to a specific customer.
 */
export async function getCustomerOrders(userId) {
  if (!userId) return [];
  try {
    const q = query(collection(db, "orders"), where("userId", "==", userId));
    const snap = await getDocs(q);
    const orders = [];
    snap.forEach((d) => orders.push({ id: d.id, ...d.data() }));
    // Sort by createdAt desc
    orders.sort((a, b) => {
      const tA = a.createdAt?.seconds || 0;
      const tB = b.createdAt?.seconds || 0;
      return tB - tA;
    });
    return orders;
  } catch (err) {
    console.warn("Could not fetch customer orders:", err);
    return [];
  }
}

/**
 * Retrieves the order session document to verify or initialize order chat metadata.
 */
export async function getOrCreateUserChatSession(orderIdOrUserId, userEmail = "", userName = "") {
  if (!orderIdOrUserId) return null;

  // 1. Try directly as an order ID
  try {
    const orderDocRef = doc(db, "orders", orderIdOrUserId);
    const snap = await getDoc(orderDocRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }
  } catch (e) {
    // If not direct order doc, continue
  }

  // 2. Otherwise assume it's a userId and find their latest order
  const orders = await getCustomerOrders(orderIdOrUserId);
  if (orders.length > 0) {
    return orders[0];
  }

  return {
    id: null,
    userId: orderIdOrUserId,
    customerEmail: userEmail,
    customerName: userName,
    noOrders: true,
  };
}

/**
 * Resolves the true customer display name from Firestore (users or orders collections)
 * if senderName was omitted, empty, or defaulted to "Customer".
 */
async function resolveCustomerName(senderId, targetOrderId, providedName) {
  let name = String(providedName || "").trim();
  if (name && name.toLowerCase() !== "customer" && name.toLowerCase() !== "user") {
    return name;
  }

  const cleanUserId = senderId ? String(senderId).replace(/^user_/, "") : "";
  if (cleanUserId) {
    try {
      const uSnap = await getDoc(doc(db, "users", cleanUserId));
      if (uSnap.exists()) {
        const u = uSnap.data();
        const found =
          u.displayName ||
          u.name ||
          u.fullName ||
          (u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : "") ||
          u.customerName ||
          u.customerDisplayName ||
          (u.email ? u.email.split("@")[0] : "");
        if (found && found.trim() && found.trim().toLowerCase() !== "customer") {
          return found.trim();
        }
      }
    } catch (_) {}
  }

  if (targetOrderId) {
    try {
      const oSnap = await getDoc(doc(db, "orders", targetOrderId));
      if (oSnap.exists()) {
        const o = oSnap.data();
        const found =
          o.address?.recipientName ||
          o.userName ||
          o.customerName ||
          o.customerDisplayName ||
          "";
        if (found && found.trim() && found.trim().toLowerCase() !== "customer") {
          return found.trim();
        }
      }
    } catch (_) {}
  }

  return name || "Customer";
}

/**
 * Sends a message into users/{userId}/messages (Customer overall concern live support chat).
 * Stores all fields compatible with mobile app ('content', 'type', 'receiverId', 'timestamp', 'isRead', 'isUnsent')
 * and web app ('text', 'message', 'attachmentUrl', 'imageUrl', 'createdAt').
 */
export async function sendUserSupportMessage({
  userId,
  senderId,
  senderName,
  senderRole = "customer", // "customer" | "admin" | "staff"
  receiverId = "",
  text = "",
  attachmentUrl = "",
  replyTo = null,
}) {
  if (!userId) throw new Error("Customer user ID is required for live support chat.");
  if (!senderId) throw new Error("Sender ID is required.");
  if (!text.trim() && !attachmentUrl) throw new Error("Cannot send an empty message.");

  const cleanUserId = userId.startsWith("user_") ? userId.replace(/^user_/, "") : userId;
  const messagesColRef = collection(db, "users", cleanUserId, "messages");
  const userDocRef = doc(db, "users", cleanUserId);

  const messageText = text.trim();
  const fileUrl = attachmentUrl || null;
  const isCustomer = senderRole === "customer";
  const defaultReceiverId = isCustomer ? "support_admin" : cleanUserId;

  let finalSenderName = senderName;
  if (isCustomer && (!finalSenderName || finalSenderName.toLowerCase() === "customer")) {
    finalSenderName = await resolveCustomerName(senderId || cleanUserId, null, senderName);
  }
  if (!finalSenderName) {
    finalSenderName = isCustomer ? "Customer" : "Lanica Support";
  }

  const messagePayload = {
    senderId,
    senderName: finalSenderName,
    senderRole,
    receiverId: receiverId || defaultReceiverId,
    userId: cleanUserId,

    // Web fields
    text: messageText,
    message: messageText,
    attachmentUrl: fileUrl,
    imageUrl: fileUrl,
    createdAt: serverTimestamp(),

    // Mobile App compatibility fields
    content: messageText || fileUrl || "",
    timestamp: serverTimestamp(),
    type: fileUrl ? 1 : 0,
    isRead: false,
    isEdited: false,
    isUnsent: false,
  };

  if (replyTo && replyTo.id) {
    messagePayload.replyTo = {
      id: replyTo.id,
      senderName: replyTo.senderName || "User",
      text: (replyTo.text || replyTo.content || "").slice(0, 150),
    };
  }

  const docRef = await addDoc(messagesColRef, messagePayload);

  // Update parent user document metadata for staff/admin dashboard queues
  const summaryUpdate = {
    hasSupportChat: true,
    lastMessage: messageText || (fileUrl ? "[Photo Attachment]" : ""),
    lastMessageAt: serverTimestamp(),
    lastSenderRole: senderRole,
    lastSenderName: finalSenderName,
    hasUnreadStaff: isCustomer,
    hasUnreadCustomer: !isCustomer,
    isChatClosed: false,
    chatStatus: "open",
  };
  if (isCustomer && finalSenderName && finalSenderName !== "Customer") {
    summaryUpdate.displayName = finalSenderName;
  }

  await setDoc(userDocRef, summaryUpdate, { merge: true }).catch(() => {});

  return { id: docRef.id, ...messagePayload };
}

/**
 * Subscribes to real-time messages in users/{userId}/messages.
 * Unconditionally retrieves all documents without restrictive orderBy clauses,
 * ensuring messages from both web (createdAt) and mobile app (timestamp, content) appear.
 */
export function subscribeToUserSupportMessages(userId, callback, errorCallback) {
  if (!userId) {
    if (callback) callback([]);
    return () => {};
  }

  const cleanUserId = userId.startsWith("user_") ? userId.replace(/^user_/, "") : userId;
  const messagesColRef = collection(db, "users", cleanUserId, "messages");

  return onSnapshot(
    messagesColRef,
    (snapshot) => {
      const messages = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const textContent = d.content || d.text || d.message || "";
        const fileUrl = d.attachmentUrl || d.imageUrl || (d.type === 1 ? d.content : "") || "";
        const isSystem =
          Boolean(d.isSystem) ||
          d.senderRole === "system" ||
          d.senderRole === "bot" ||
          d.sender === "system" ||
          d.senderId === "system" ||
          (typeof d.senderName === "string" && (d.senderName.toLowerCase().includes("system") || d.senderName.toLowerCase().includes("bot")));

        const isFromStaff =
          !isSystem &&
          (d.senderRole === "admin" ||
          d.senderRole === "staff" ||
          d.senderId === "support_admin");

        messages.push({
          id: docSnap.id,
          userId: cleanUserId,
          sessionType: "support",
          content: textContent,
          text: textContent,
          message: textContent,
          attachmentUrl: fileUrl,
          imageUrl: fileUrl,
          senderId: d.senderId,
          senderName: isSystem ? (d.senderName || "Lanica System") : (d.senderName || (isFromStaff ? "Lanica Support" : "Customer")),
          senderRole: isSystem ? "system" : (d.senderRole || (isFromStaff ? "admin" : "customer")),
          isSystem,
          receiverId: d.receiverId || "",
          type: d.type ?? (fileUrl ? 1 : 0),
          isRead: d.isRead === true || d.read === true,
          isEdited: Boolean(d.isEdited),
          isUnsent: Boolean(d.isUnsent),
          replyTo: d.replyTo || null,
          photoURL: d.photoURL || d.senderPhoto || d.senderPhotoURL || d.avatarUrl || d.senderAvatar || "",
          createdAt: d.timestamp || d.createdAt,
          timestamp: d.timestamp || d.createdAt,
        });
      });

      // Robust client-side sort supporting timestamp (mobile) and createdAt (web)
      messages.sort((a, b) => {
        const getMs = (m) =>
          m.timestamp?.toMillis?.() ||
          m.createdAt?.toMillis?.() ||
          (m.timestamp?.seconds ? m.timestamp.seconds * 1000 : 0) ||
          (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0) ||
          0;
        return getMs(a) - getMs(b);
      });

      callback(messages);
    },
    (err) => {
      console.warn(`Error subscribing to users/${cleanUserId}/messages:`, err);
      if (errorCallback) errorCallback(err);
    }
  );
}

/**
 * Marks messages in a user live support thread as read.
 */
export async function markUserSupportMessagesAsRead(userId, role = "admin") {
  if (!userId) return;
  const cleanUserId = userId.startsWith("user_") ? userId.replace(/^user_/, "") : userId;
  try {
    const messagesColRef = collection(db, "users", cleanUserId, "messages");
    const snap = await getDocs(messagesColRef);
    const unreadDocs = [];

    snap.forEach((d) => {
      const data = d.data();
      const isFromStaff =
        data.senderRole === "admin" ||
        data.senderRole === "staff" ||
        data.senderId === "support_admin";

      if ((role === "admin" || role === "staff") && !isFromStaff && data.isRead !== true && data.read !== true) {
        unreadDocs.push(d.ref);
      } else if (role === "customer" && isFromStaff && data.isRead !== true && data.read !== true) {
        unreadDocs.push(d.ref);
      }
    });

    if (unreadDocs.length > 0) {
      await Promise.all(
        unreadDocs.map((docRef) => updateDoc(docRef, { isRead: true }).catch(() => {}))
      );
    }

    if (role === "admin" || role === "staff") {
      await updateDoc(doc(db, "users", cleanUserId), { hasUnreadStaff: false }).catch(() => {});
    } else {
      await updateDoc(doc(db, "users", cleanUserId), { hasUnreadCustomer: false }).catch(() => {});
    }
  } catch (err) {
    console.warn("Could not mark user support messages as read:", err);
  }
}

/**
 * Sends a chat message. Intelligently routes to either:
 * - General Live Support: users/{userId}/messages (when isUserSupport or sessionType === 'support' or userId without orderId)
 * - Order Crafting Channel: orders/{orderId}/messages (when orderId provided)
 */
export async function sendChatMessage({
  orderId,
  chatId, // fallback if caller passes chatId
  userId,
  sessionType, // "support" | "order"
  isUserSupport = false,
  senderId,
  senderName,
  senderRole = "customer", // "customer" | "admin" | "staff"
  receiverId = "",
  text = "",
  attachmentUrl = "",
  replyTo = null,
}) {
  const targetId = orderId || chatId || userId;
  const isSupport =
    isUserSupport ||
    sessionType === "support" ||
    (targetId && String(targetId).startsWith("user_")) ||
    (!orderId && Boolean(userId));

  if (isSupport) {
    const targetUserId = (userId || targetId || "").replace(/^user_/, "");
    return sendUserSupportMessage({
      userId: targetUserId,
      senderId,
      senderName,
      senderRole,
      receiverId,
      text,
      attachmentUrl,
      replyTo,
    });
  }

  const targetOrderId = orderId || chatId;
  if (!targetOrderId) throw new Error("Order ID is required to send a message.");
  if (!senderId) throw new Error("Sender ID is required.");
  if (!text.trim() && !attachmentUrl) throw new Error("Cannot send an empty message.");

  const messagesColRef = collection(db, "orders", targetOrderId, "messages");
  const orderDocRef = doc(db, "orders", targetOrderId);

  const messageText = text.trim();
  const fileUrl = attachmentUrl || null;
  const isCustomer = senderRole === "customer";
  const defaultReceiverId = isCustomer ? "support_admin" : "customer";

  let finalSenderName = senderName;
  if (isCustomer && (!finalSenderName || finalSenderName.toLowerCase() === "customer")) {
    finalSenderName = await resolveCustomerName(senderId, targetOrderId, senderName);
  }
  if (!finalSenderName) {
    finalSenderName = isCustomer ? "Customer" : "Lanica Workshop";
  }

  const messagePayload = {
    senderId,
    senderName: finalSenderName,
    senderRole,
    receiverId: receiverId || defaultReceiverId,
    orderId: targetOrderId,

    // Web fields
    text: messageText,
    message: messageText,
    attachmentUrl: fileUrl,
    imageUrl: fileUrl,
    createdAt: serverTimestamp(),

    // Mobile App compatibility fields
    content: messageText || fileUrl || "",
    timestamp: serverTimestamp(),
    type: fileUrl ? 1 : 0,
    isRead: false,
    isEdited: false,
    isUnsent: false,
  };

  if (replyTo && replyTo.id) {
    messagePayload.replyTo = {
      id: replyTo.id,
      senderName: replyTo.senderName || "User",
      text: (replyTo.text || replyTo.content || "").slice(0, 150),
    };
  }

  const docRef = await addDoc(messagesColRef, messagePayload);

  // Update parent order summary metadata for staff/admin dashboard queues
  const summaryUpdate = {
    lastMessage: messageText || (fileUrl ? "[Photo Attachment]" : ""),
    lastMessageAt: serverTimestamp(),
    lastSenderRole: senderRole,
    lastSenderName: finalSenderName,
    hasUnreadCustomer: !isCustomer,
    hasUnreadStaff: isCustomer,
    isChatClosed: false,
    chatStatus: "open",
  };

  await setDoc(orderDocRef, summaryUpdate, { merge: true }).catch((err) => {
    console.warn("Could not update order chat summary:", err);
  });

  // Cross-Platform Dual-Write: Mirror message to mobile app collection 'order_chats/{orderId}/messages'
  try {
    const mobileChatDocRef = doc(db, "order_chats", targetOrderId, "messages", docRef.id);
    await setDoc(mobileChatDocRef, messagePayload);
    await setDoc(doc(db, "order_chats", targetOrderId), summaryUpdate, { merge: true }).catch(() => {});
  } catch (err) {
    console.warn("Could not mirror chat message to order_chats collection:", err);
  }

  return { id: docRef.id, ...messagePayload };
}

/**
 * Subscribes to real-time messages for either an order or a user support thread.
 * Unified Dual-Listener: Listens to BOTH 'orders/{id}/messages' (web/app) AND 'order_chats/{id}/messages' (app)
 * to ensure 100% real-time synchronization between the mobile application and website.
 */
export function subscribeToMessages(targetId, callback, errorCallback, isUserSupport = false) {
  if (!targetId) {
    if (callback) callback([]);
    return () => {};
  }

  if (isUserSupport || String(targetId).startsWith("user_")) {
    return subscribeToUserSupportMessages(targetId, callback, errorCallback);
  }

  const ordersColRef = collection(db, "orders", targetId, "messages");
  const orderChatsColRef = collection(db, "order_chats", targetId, "messages");

  const combinedMessagesMap = new Map();

  function parseDoc(docSnap, sourceCol) {
    const d = docSnap.data();
    const textContent = d.content || d.text || d.message || "";
    const fileUrl = d.attachmentUrl || d.imageUrl || (d.type === 1 ? d.content : "") || "";
    const isSystem =
      Boolean(d.isSystem) ||
      d.senderRole === "system" ||
      d.senderRole === "bot" ||
      d.sender === "system" ||
      d.senderId === "system" ||
      (typeof d.senderName === "string" &&
        (d.senderName.toLowerCase().includes("system") || d.senderName.toLowerCase().includes("bot")));

    const isFromStaff =
      !isSystem &&
      (d.senderRole === "admin" ||
        d.senderRole === "staff" ||
        d.senderId === "support_admin");

    return {
      id: docSnap.id,
      orderId: targetId,
      sessionType: "order",
      content: textContent,
      text: textContent,
      message: textContent,
      attachmentUrl: fileUrl,
      imageUrl: fileUrl,
      senderId: d.senderId,
      senderName: isSystem
        ? d.senderName || "Lanica System"
        : d.senderName || (isFromStaff ? "Lanica Workshop" : "Customer"),
      senderRole: isSystem ? "system" : d.senderRole || (isFromStaff ? "admin" : "customer"),
      isSystem,
      receiverId: d.receiverId || "",
      type: d.type ?? (fileUrl ? 1 : 0),
      isRead: d.isRead === true || d.read === true,
      isEdited: Boolean(d.isEdited),
      isUnsent: Boolean(d.isUnsent),
      replyTo: d.replyTo || null,
      photoURL: d.photoURL || d.senderPhoto || d.senderPhotoURL || d.avatarUrl || d.senderAvatar || "",
      createdAt: d.timestamp || d.createdAt,
      timestamp: d.timestamp || d.createdAt,
      sourceCol,
    };
  }

  function emitUnified() {
    const messages = Array.from(combinedMessagesMap.values());
    messages.sort((a, b) => {
      const getMs = (m) =>
        m.timestamp?.toMillis?.() ||
        m.createdAt?.toMillis?.() ||
        (m.timestamp?.seconds ? m.timestamp.seconds * 1000 : 0) ||
        (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0) ||
        0;
      return getMs(a) - getMs(b);
    });
    callback(messages);
  }

  const unsubOrders = onSnapshot(
    ordersColRef,
    (snapshot) => {
      snapshot.forEach((docSnap) => {
        combinedMessagesMap.set(docSnap.id, parseDoc(docSnap, "orders"));
      });
      emitUnified();
    },
    (err) => {
      console.warn(`Error subscribing to orders/${targetId}/messages:`, err);
      if (errorCallback) errorCallback(err);
    }
  );

  let unsubOrderChats = () => {};
  try {
    unsubOrderChats = onSnapshot(
      orderChatsColRef,
      (snapshot) => {
        snapshot.forEach((docSnap) => {
          combinedMessagesMap.set(docSnap.id, parseDoc(docSnap, "order_chats"));
        });
        emitUnified();
      },
      (err) => {
        // order_chats might not exist yet for brand new orders, ignore gracefully
      }
    );
  } catch (err) {
    console.warn("Could not listen to order_chats:", err);
  }

  return () => {
    try {
      unsubOrders();
    } catch (_) {}
    try {
      unsubOrderChats();
    } catch (_) {}
  };
}

/**
 * Marks messages in an order or user support thread as read.
 * Checks both 'orders/{id}/messages' and 'order_chats/{id}/messages'.
 */
export async function markOrderMessagesAsRead(targetId, role = "admin", isUserSupport = false) {
  if (!targetId) return;

  if (isUserSupport || String(targetId).startsWith("user_")) {
    return markUserSupportMessagesAsRead(targetId, role);
  }

  try {
    const unreadDocs = [];
    const checkDoc = (d) => {
      const data = d.data();
      const isFromStaff =
        data.senderRole === "admin" ||
        data.senderRole === "staff" ||
        data.senderId === "support_admin";

      if ((role === "admin" || role === "staff") && !isFromStaff && data.isRead !== true && data.read !== true) {
        unreadDocs.push(d.ref);
      } else if (role === "customer" && isFromStaff && data.isRead !== true && data.read !== true) {
        unreadDocs.push(d.ref);
      }
    };

    const snapOrders = await getDocs(collection(db, "orders", targetId, "messages")).catch(() => ({ forEach: () => {} }));
    const snapOrderChats = await getDocs(collection(db, "order_chats", targetId, "messages")).catch(() => ({ forEach: () => {} }));

    snapOrders.forEach(checkDoc);
    snapOrderChats.forEach(checkDoc);

    if (unreadDocs.length > 0) {
      await Promise.all(
        unreadDocs.map((docRef) => updateDoc(docRef, { isRead: true }).catch(() => {}))
      );
    }

    const updatePayload = (role === "admin" || role === "staff") ? { hasUnreadStaff: false } : { hasUnreadCustomer: false };
    await setDoc(doc(db, "orders", targetId), updatePayload, { merge: true }).catch(() => {});
    await setDoc(doc(db, "order_chats", targetId), updatePayload, { merge: true }).catch(() => {});
  } catch (err) {
    console.warn("Could not mark order messages as read:", err);
  }
}

/**
 * Subscribes to all active conversations for the Admin & Staff Live Chat.
 * Combines both:
 * 1) Overall Concern Live Support: users/{userId}/messages
 * 2) Order Crafting Channels: orders/{orderId}/messages
 */
export function subscribeToAllChats(callback, errorCallback) {
  let orderSessions = [];
  let userSupportSessions = [];
  let rawOrdersDocs = [];
  const userProfileMap = new Map();
  const scannedUserIds = new Set();

  const orderChatsMap = new Map();

  function enrichOrderSessions() {
    orderSessions = rawOrdersDocs
      .filter((d) => !d.chatDeleted && !d.isChatDeleted)
      .map((d) => {
        const userProfile = userProfileMap.get(d.userId);
        const oc = orderChatsMap.get(d.id) || orderChatsMap.get(d.orderId);
        const isArch = Boolean(
          d.isArchived ||
          d.chatStatus === "archived" ||
          d.isChatClosed ||
          d.chatStatus === "closed" ||
          oc?.isArchived ||
          oc?.isChatClosed ||
          oc?.chatStatus === "archived" ||
          oc?.chatStatus === "closed"
        );
        const resolvedName =
          d.address?.recipientName ||
          d.userName ||
          d.customerName ||
          d.customerDisplayName ||
          oc?.customerName ||
          oc?.customerDisplayName ||
          userProfile?.name ||
          userProfile?.displayName ||
          "Customer";
        return {
          id: d.id,
          sessionType: "order",
          orderId: d.orderId || d.id,
          userId: d.userId || oc?.userId,
          photoURL: d.customerPhotoURL || d.photoURL || oc?.customerPhotoURL || userProfile?.photoURL || "",
          customerName: resolvedName,
          customerEmail: d.customerEmail || d.email || oc?.customerEmail || userProfile?.email || "",
          status: d.orderStatus || d.status || oc?.status || "Placed",
          isClosed: isArch,
          isArchived: isArch,
          lastMessage: d.lastMessage || oc?.lastMessage || `Order #${d.orderId || d.id} placed`,
          updatedAt: d.lastMessageAt || oc?.lastMessageAt || d.createdAt || oc?.createdAt,
          createdAt: d.createdAt || oc?.createdAt,
          totalAmount: d.totalAmount || 0,
          items: d.items || [],
          hasUnreadStaff: Boolean(d.hasUnreadStaff || oc?.hasUnreadStaff),
        };
      });
  }

  function emitCombined() {
    const combined = [...userSupportSessions, ...orderSessions];
    combined.sort((a, b) => {
      const getMs = (s) =>
        s.updatedAt?.toMillis?.() ||
        s.createdAt?.toMillis?.() ||
        (s.updatedAt?.seconds ? s.updatedAt.seconds * 1000 : 0) ||
        (s.createdAt?.seconds ? s.createdAt.seconds * 1000 : 0) ||
        0;
      return getMs(b) - getMs(a);
    });
    callback(combined);
  }

  // 1. Listen to orders
  const ordersColRef = collection(db, "orders");
  const unsubOrders = onSnapshot(
    ordersColRef,
    (snapshot) => {
      rawOrdersDocs = [];
      snapshot.forEach((docSnap) => {
        rawOrdersDocs.push({ ...docSnap.data(), id: docSnap.id });
      });
      enrichOrderSessions();
      emitCombined();
    },
    (err) => {
      console.warn("Fallback query without orderBy for orders:", err);
      if (errorCallback) errorCallback(err);
    }
  );

  // 2. Listen to order_chats (cross-platform real-time mobile app compatibility)
  let unsubOrderChats = () => {};
  try {
    const orderChatsColRef = collection(db, "order_chats");
    unsubOrderChats = onSnapshot(
      orderChatsColRef,
      (snapshot) => {
        orderChatsMap.clear();
        snapshot.forEach((docSnap) => {
          orderChatsMap.set(docSnap.id, docSnap.data());
        });
        enrichOrderSessions();
        emitCombined();
      },
      (err) => {
        console.warn("Could not listen to order_chats:", err);
      }
    );
  } catch (err) {
    console.warn("Could not attach order_chats snapshot listener:", err);
  }

  // 2. Listen to users for overall customer support chat and profile photos
  const usersColRef = collection(db, "users");
  const unsubUsers = onSnapshot(
    usersColRef,
    async (snapshot) => {
      const activeUserSessions = [];

      for (const docSnap of snapshot.docs) {
        const d = docSnap.data();
        const uid = docSnap.id;

        const photo = d.photoURL || d.profilePic || d.avatarUrl || "";
        const name =
          d.displayName ||
          d.name ||
          d.fullName ||
          (d.firstName ? `${d.firstName} ${d.lastName || ""}`.trim() : "") ||
          d.address?.recipientName ||
          d.lastSenderName ||
          (d.email ? d.email.split("@")[0] : "Customer");
        userProfileMap.set(uid, {
          photoURL: photo,
          name: name,
          email: d.email || "",
        });

        // Skip chats marked as deleted
        if (d.chatDeleted || d.isChatDeleted) {
          continue;
        }

        // An active support session if user has hasSupportChat, lastMessage, or has messages subcollection
        let hasSupport = Boolean(d.hasSupportChat || d.lastMessage || d.hasUnreadStaff != null);

        // For existing users who sent messages before hasSupportChat flag was added:
        if (!hasSupport && !scannedUserIds.has(uid) && d.role !== "admin" && d.role !== "staff") {
          scannedUserIds.add(uid);
          try {
            const msgCheck = await getDocs(collection(db, "users", uid, "messages"));
            if (!msgCheck.empty) {
              hasSupport = true;
              // update user document so future checks are instant
              await setDoc(doc(db, "users", uid), { hasSupportChat: true }, { merge: true }).catch(() => {});
            }
          } catch (e) {
            // ignore
          }
        }

        if (hasSupport) {
          const isArch = Boolean(d.isArchived || d.chatStatus === "archived" || d.isChatClosed || d.chatStatus === "closed");
          activeUserSessions.push({
            id: `user_${uid}`,
            actualId: uid,
            sessionType: "support",
            isUserSupport: true,
            userId: uid,
            photoURL: photo,
            customerName: name,
            customerEmail: d.email || "",
            status: "Live Support",
            isClosed: isArch,
            isArchived: isArch,
            lastMessage: d.lastMessage || "Live customer inquiry",
            updatedAt: d.lastMessageAt || d.createdAt,
            createdAt: d.createdAt || d.lastMessageAt,
            hasUnreadStaff: Boolean(d.hasUnreadStaff),
          });
        }
      }

      userSupportSessions = activeUserSessions;
      enrichOrderSessions();
      emitCombined();
    },
    (err) => {
      console.warn("Could not listen to users for live support chats:", err);
    }
  );

  return () => {
    unsubOrders();
    unsubUsers();
    try {
      unsubOrderChats();
    } catch (_) {}
  };
}

/**
 * Marks a message as unsent across either order messages or user support messages.
 * Messenger style: supports unsendFor: "everyone" | "you".
 */
export async function unsendChatMessage({
  targetId,
  messageId,
  isUserSupport = false,
  unsendFor = "everyone",
  currentUserId = null,
}) {
  if (!targetId || !messageId) throw new Error("Target ID and message ID are required.");

  const isSupport = isUserSupport || String(targetId).startsWith("user_");
  const cleanId = String(targetId).replace(/^user_/, "");

  const msgRef = isSupport
    ? doc(db, "users", cleanId, "messages", messageId)
    : doc(db, "orders", cleanId, "messages", messageId);

  if (unsendFor === "everyone") {
    await updateDoc(msgRef, {
      isUnsent: true,
      unsentBy: currentUserId || null,
      content: "This message was unsent",
      text: "This message was unsent",
      message: "This message was unsent",
      attachmentUrl: null,
      imageUrl: null,
      unsentAt: serverTimestamp(),
    });

    const parentRef = isSupport
      ? doc(db, "users", cleanId)
      : doc(db, "orders", cleanId);

    await updateDoc(parentRef, {
      lastMessage: "A message was unsent",
      lastMessageAt: serverTimestamp(),
    }).catch(() => {});
  } else {
    // Hidden only for the current user
    const hideKey = currentUserId ? `hiddenFor_${currentUserId}` : `hiddenFor_user`;
    await updateDoc(msgRef, {
      [hideKey]: true,
    }).catch(() => {});
  }
}

/**
 * Displays Facebook Messenger-style modal dialog asking:
 * "Who do you want to unsend this for?"
 * Returns Promise<{ unsendFor: "everyone" | "you" } | null>
 */
export function showMessengerUnsendModal({ canUnsendForEveryone = true } = {}) {
  return new Promise((resolve) => {
    // Remove any existing dialog
    const existing = document.querySelector(".messenger-unsend-backdrop");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "messenger-unsend-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");

    backdrop.innerHTML = `
      <div class="messenger-unsend-modal">
        <div class="messenger-unsend-header">
          <h3 class="messenger-unsend-title">Who do you want to unsend this for?</h3>
        </div>
        <div class="messenger-unsend-body">
          ${
            canUnsendForEveryone
              ? `
            <label class="messenger-unsend-radio-row">
              <input type="radio" name="messenger_unsend_choice" value="everyone" checked />
              <div class="messenger-unsend-radio-info">
                <span class="messenger-unsend-radio-title">Unsend for everyone</span>
                <span class="messenger-unsend-radio-desc">This message will be removed for everyone in the chat.</span>
              </div>
            </label>
            `
              : ""
          }
          <label class="messenger-unsend-radio-row">
            <input type="radio" name="messenger_unsend_choice" value="you" ${!canUnsendForEveryone ? "checked" : ""} />
            <div class="messenger-unsend-radio-info">
              <span class="messenger-unsend-radio-title">Unsend for you</span>
              <span class="messenger-unsend-radio-desc">This message will be removed from your view only. Others in the chat will still see it.</span>
            </div>
          </label>
        </div>
        <div class="messenger-unsend-footer">
          <button type="button" class="messenger-btn-cancel">Cancel</button>
          <button type="button" class="messenger-btn-confirm">Unsend</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("visible"));

    const closeWith = (val) => {
      backdrop.classList.remove("visible");
      setTimeout(() => {
        try { backdrop.remove(); } catch (_) {}
      }, 200);
      resolve(val);
    };

    backdrop.querySelector(".messenger-btn-cancel").onclick = () => closeWith(null);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeWith(null);
    };

    backdrop.querySelector(".messenger-btn-confirm").onclick = () => {
      const selected = backdrop.querySelector('input[name="messenger_unsend_choice"]:checked');
      closeWith({ unsendFor: selected ? selected.value : "everyone" });
    };
  });
}

/**
 * Archives an order or support chat session (Messenger style: moves to Archived folder).
 */
export async function archiveChatSession({ targetId, isUserSupport = false }) {
  if (!targetId) throw new Error("Target ID is required.");

  const isSupport = isUserSupport || String(targetId).startsWith("user_");
  const cleanId = String(targetId).replace(/^user_/, "");

  const parentRef = isSupport
    ? doc(db, "users", cleanId)
    : doc(db, "orders", cleanId);

  await updateDoc(parentRef, {
    isArchived: true,
    isChatClosed: true,
    chatStatus: "archived",
    archivedAt: serverTimestamp(),
  });
}

/**
 * Unarchives a chat session (Messenger style: restores back to Inbox).
 */
export async function unarchiveChatSession({ targetId, isUserSupport = false }) {
  if (!targetId) throw new Error("Target ID is required.");

  const isSupport = isUserSupport || String(targetId).startsWith("user_");
  const cleanId = String(targetId).replace(/^user_/, "");

  const parentRef = isSupport
    ? doc(db, "users", cleanId)
    : doc(db, "orders", cleanId);

  await updateDoc(parentRef, {
    isArchived: false,
    isChatClosed: false,
    chatStatus: "open",
    unarchivedAt: serverTimestamp(),
  });
}

/**
 * Deletes an entire conversation permanently from Firestore (Messenger style: Delete conversation).
 */
export async function deleteConversation({ targetId, isUserSupport = false }) {
  if (!targetId) throw new Error("Target ID is required.");

  const isSupport = isUserSupport || String(targetId).startsWith("user_");
  const cleanId = String(targetId).replace(/^user_/, "");

  const messagesColRef = isSupport
    ? collection(db, "users", cleanId, "messages")
    : collection(db, "orders", cleanId, "messages");

  const snap = await getDocs(messagesColRef);
  if (!snap.empty) {
    const batch = writeBatch(db);
    snap.forEach((d) => {
      batch.delete(d.ref);
    });
    await batch.commit();
  }

  const parentRef = isSupport
    ? doc(db, "users", cleanId)
    : doc(db, "orders", cleanId);

  if (isSupport) {
    await updateDoc(parentRef, {
      hasSupportChat: false,
      chatDeleted: true,
      lastMessage: "",
      lastMessageAt: null,
      isArchived: false,
      isChatClosed: false,
      chatStatus: "deleted",
      hasUnreadStaff: false,
      hasUnreadCustomer: false,
    }).catch(() => {});
  } else {
    await updateDoc(parentRef, {
      chatDeleted: true,
      lastMessage: "",
      lastMessageAt: null,
      isArchived: false,
      isChatClosed: false,
      chatStatus: "deleted",
      hasUnreadStaff: false,
      hasUnreadCustomer: false,
    }).catch(() => {});
  }
}

// Aliases for compatibility
export const closeChatSession = archiveChatSession;
export const reopenChatSession = unarchiveChatSession;
export const deleteChatHistory = deleteConversation;

import { compressAndResizeImage } from "./imageOptimizationService.js";

/**
 * Uploads an image or document attachment to Firebase Storage (lanica_chats/{orderId}/{fileName})
 */
export async function uploadChatAttachment(file, orderId) {
  if (!file) throw new Error("No file provided.");

  let uploadFile = file;
  if (file.type && file.type.startsWith("image/")) {
    uploadFile = await compressAndResizeImage(file, 800, 800, 100 * 1024);
  }

  const safeName = `${Date.now()}_${uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const path = `lanica_chats/${orderId || "general"}/${safeName}`;
  const fileRef = storageRef(storage, path);

  const metadata = {
    cacheControl: "public, max-age=31536000, immutable",
    contentType: uploadFile.type || "application/octet-stream",
  };

  const snapshot = await uploadBytes(fileRef, uploadFile, metadata);
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}
