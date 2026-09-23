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
}) {
  if (!userId) throw new Error("Customer user ID is required for live support chat.");
  if (!senderId) throw new Error("Sender ID is required.");
  if (!text.trim() && !attachmentUrl) throw new Error("Cannot send an empty message.");

  const messagesColRef = collection(db, "users", userId, "messages");
  const userDocRef = doc(db, "users", userId);

  const messageText = text.trim();
  const fileUrl = attachmentUrl || null;
  const isCustomer = senderRole === "customer";
  const defaultReceiverId = isCustomer ? "support_admin" : userId;

  const messagePayload = {
    senderId,
    senderName: senderName || (isCustomer ? "Customer" : "Lanica Support"),
    senderRole,
    receiverId: receiverId || defaultReceiverId,
    userId: userId,

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

  const docRef = await addDoc(messagesColRef, messagePayload);

  // Update parent user document metadata for staff/admin dashboard queues
  const summaryUpdate = {
    hasSupportChat: true,
    lastMessage: messageText || (fileUrl ? "[Photo Attachment]" : ""),
    lastMessageAt: serverTimestamp(),
    lastSenderRole: senderRole,
    lastSenderName: senderName || (isCustomer ? "Customer" : "Lanica Support"),
    hasUnreadStaff: isCustomer,
    hasUnreadCustomer: !isCustomer,
  };

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
        const isFromStaff =
          d.senderRole === "admin" ||
          d.senderRole === "staff" ||
          d.senderId === "support_admin";

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
          senderName: d.senderName || (isFromStaff ? "Lanica Support" : "Customer"),
          senderRole: d.senderRole || (isFromStaff ? "admin" : "customer"),
          receiverId: d.receiverId || "",
          type: d.type ?? (fileUrl ? 1 : 0),
          isRead: d.isRead ?? true,
          isEdited: Boolean(d.isEdited),
          isUnsent: Boolean(d.isUnsent),
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

      if ((role === "admin" || role === "staff") && !isFromStaff && data.isRead === false) {
        unreadDocs.push(d.ref);
      } else if (role === "customer" && isFromStaff && data.isRead === false) {
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

  const messagePayload = {
    senderId,
    senderName: senderName || (isCustomer ? "Customer" : "Lanica Workshop"),
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

  const docRef = await addDoc(messagesColRef, messagePayload);

  // Update parent order summary metadata for staff/admin dashboard queues
  const summaryUpdate = {
    lastMessage: messageText || (fileUrl ? "[Photo Attachment]" : ""),
    lastMessageAt: serverTimestamp(),
    lastSenderRole: senderRole,
    lastSenderName: senderName || senderRole,
    hasUnreadCustomer: !isCustomer,
    hasUnreadStaff: isCustomer,
  };

  await updateDoc(orderDocRef, summaryUpdate).catch(() => {});

  return { id: docRef.id, ...messagePayload };
}

/**
 * Subscribes to real-time messages for either an order or a user support thread.
 */
export function subscribeToMessages(targetId, callback, errorCallback, isUserSupport = false) {
  if (!targetId) {
    if (callback) callback([]);
    return () => {};
  }

  if (isUserSupport || String(targetId).startsWith("user_")) {
    return subscribeToUserSupportMessages(targetId, callback, errorCallback);
  }

  const messagesColRef = collection(db, "orders", targetId, "messages");

  return onSnapshot(
    messagesColRef,
    (snapshot) => {
      const messages = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const textContent = d.content || d.text || d.message || "";
        const fileUrl = d.attachmentUrl || d.imageUrl || (d.type === 1 ? d.content : "") || "";
        const isFromStaff =
          d.senderRole === "admin" ||
          d.senderRole === "staff" ||
          d.senderId === "support_admin";

        messages.push({
          id: docSnap.id,
          orderId: targetId,
          sessionType: "order",
          content: textContent,
          text: textContent,
          message: textContent,
          attachmentUrl: fileUrl,
          imageUrl: fileUrl,
          senderId: d.senderId,
          senderName: d.senderName || (isFromStaff ? "Lanica Workshop" : "Customer"),
          senderRole: d.senderRole || (isFromStaff ? "admin" : "customer"),
          receiverId: d.receiverId || "",
          type: d.type ?? (fileUrl ? 1 : 0),
          isRead: d.isRead ?? true,
          isEdited: Boolean(d.isEdited),
          isUnsent: Boolean(d.isUnsent),
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
      console.warn(`Error subscribing to orders/${targetId}/messages:`, err);
      if (errorCallback) errorCallback(err);
    }
  );
}

/**
 * Marks messages in an order or user support thread as read.
 */
export async function markOrderMessagesAsRead(targetId, role = "admin", isUserSupport = false) {
  if (!targetId) return;

  if (isUserSupport || String(targetId).startsWith("user_")) {
    return markUserSupportMessagesAsRead(targetId, role);
  }

  try {
    const messagesColRef = collection(db, "orders", targetId, "messages");
    const snap = await getDocs(messagesColRef);
    const unreadDocs = [];

    snap.forEach((d) => {
      const data = d.data();
      const isFromStaff =
        data.senderRole === "admin" ||
        data.senderRole === "staff" ||
        data.senderId === "support_admin";

      if ((role === "admin" || role === "staff") && !isFromStaff && data.isRead === false) {
        unreadDocs.push(d.ref);
      } else if (role === "customer" && isFromStaff && data.isRead === false) {
        unreadDocs.push(d.ref);
      }
    });

    if (unreadDocs.length > 0) {
      await Promise.all(
        unreadDocs.map((docRef) => updateDoc(docRef, { isRead: true }).catch(() => {}))
      );
    }

    if (role === "admin" || role === "staff") {
      await updateDoc(doc(db, "orders", targetId), { hasUnreadStaff: false }).catch(() => {});
    } else {
      await updateDoc(doc(db, "orders", targetId), { hasUnreadCustomer: false }).catch(() => {});
    }
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
  const scannedUserIds = new Set();

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
      orderSessions = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        orderSessions.push({
          id: docSnap.id,
          sessionType: "order",
          orderId: d.orderId || docSnap.id,
          userId: d.userId,
          customerName: d.address?.recipientName || d.userName || d.customerName || "Customer",
          customerEmail: d.customerEmail || d.email || "",
          status: d.orderStatus || d.status || "Placed",
          lastMessage: d.lastMessage || `Order #${d.orderId || docSnap.id} placed`,
          updatedAt: d.lastMessageAt || d.createdAt,
          createdAt: d.createdAt,
          totalAmount: d.totalAmount || 0,
          items: d.items || [],
        });
      });
      emitCombined();
    },
    (err) => {
      console.warn("Fallback query without orderBy for orders:", err);
      if (errorCallback) errorCallback(err);
    }
  );

  // 2. Listen to users for overall customer support chat
  const usersColRef = collection(db, "users");
  const unsubUsers = onSnapshot(
    usersColRef,
    async (snapshot) => {
      const activeUserSessions = [];

      for (const docSnap of snapshot.docs) {
        const d = docSnap.data();
        const uid = docSnap.id;

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
          activeUserSessions.push({
            id: `user_${uid}`,
            actualId: uid,
            sessionType: "support",
            isUserSupport: true,
            userId: uid,
            customerName: d.displayName || d.name || d.fullName || (d.email ? d.email.split("@")[0] : "Customer"),
            customerEmail: d.email || "",
            status: "Live Support",
            lastMessage: d.lastMessage || "Live customer inquiry",
            updatedAt: d.lastMessageAt || d.createdAt,
            createdAt: d.createdAt || d.lastMessageAt,
            hasUnreadStaff: Boolean(d.hasUnreadStaff),
          });
        }
      }

      userSupportSessions = activeUserSessions;
      emitCombined();
    },
    (err) => {
      console.warn("Could not listen to users for live support chats:", err);
    }
  );

  return () => {
    unsubOrders();
    unsubUsers();
  };
}

/**
 * Uploads an image or document attachment to Firebase Storage (lanica_chats/{orderId}/{fileName})
 */
export async function uploadChatAttachment(file, orderId) {
  if (!file) throw new Error("No file provided.");
  const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const path = `lanica_chats/${orderId || "general"}/${safeName}`;
  const fileRef = storageRef(storage, path);

  const snapshot = await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}
