import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  query,
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
 * Creates or retrieves the active chat session document for a user.
 * Document ID is the userId (or specific chatId).
 */
export async function getOrCreateUserChatSession(userId, userEmail = "", userName = "") {
  if (!userId) return null;
  const chatDocRef = doc(db, "chats", userId);
  const snap = await getDoc(chatDocRef);

  if (!snap.exists()) {
    const payload = {
      userId: userId,
      customerEmail: userEmail || "Anonymous Customer",
      customerName: userName || "Customer",
      lastMessage: "Conversation opened",
      lastSender: "system",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      unreadCountAdmin: 0,
      unreadCountCustomer: 0,
    };
    await setDoc(chatDocRef, payload);
    return { id: userId, ...payload };
  }

  return { id: snap.id, ...snap.data() };
}

/**
 * Sends a chat message into chats/{chatId}/messages
 */
export async function sendChatMessage({
  chatId,
  senderId,
  senderName,
  senderRole = "customer", // "customer" | "admin" | "staff"
  text = "",
  attachmentUrl = "",
  orderId = null,
}) {
  if (!chatId || !senderId) throw new Error("chatId and senderId are required.");
  if (!text.trim() && !attachmentUrl) throw new Error("Cannot send an empty message.");

  const messagesColRef = collection(db, "chats", chatId, "messages");
  const chatDocRef = doc(db, "chats", chatId);

  const messagePayload = {
    senderId,
    senderName: senderName || (senderRole === "customer" ? "Customer" : "Lanica Staff"),
    senderRole,
    text: text.trim(),
    attachmentUrl: attachmentUrl || null,
    orderId: orderId || null,
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(messagesColRef, messagePayload);

  // Update parent chat summary metadata
  const summaryUpdate = {
    lastMessage: text.trim() || (attachmentUrl ? "[Attachment / Photo]" : ""),
    lastSender: senderRole,
    lastSenderName: senderName || senderRole,
    updatedAt: serverTimestamp(),
  };

  if (senderRole === "customer") {
    summaryUpdate.unreadCountAdmin = (summaryUpdate.unreadCountAdmin || 0) + 1;
  } else {
    summaryUpdate.unreadCountCustomer = (summaryUpdate.unreadCountCustomer || 0) + 1;
  }

  await updateDoc(chatDocRef, summaryUpdate).catch(() => {
    // If doc didn't exist yet, set it
    setDoc(chatDocRef, summaryUpdate, { merge: true });
  });

  return { id: docRef.id, ...messagePayload };
}

/**
 * Subscribes to real-time messages in a specific chat session.
 */
export function subscribeToMessages(chatId, callback, errorCallback) {
  if (!chatId) return () => {};
  const messagesColRef = collection(db, "chats", chatId, "messages");
  const q = query(messagesColRef, orderBy("createdAt", "asc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const msgs = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      if (typeof callback === "function") callback(msgs);
    },
    (err) => {
      console.error("Chat subscription error:", err);
      if (typeof errorCallback === "function") errorCallback(err);
    }
  );
}

/**
 * Subscribes to all chat threads (Used by Admin and Staff Dashboard).
 */
export function subscribeToAllChats(callback, errorCallback) {
  const chatsColRef = collection(db, "chats");
  const q = query(chatsColRef, orderBy("updatedAt", "desc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const chatList = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      if (typeof callback === "function") callback(chatList);
    },
    (err) => {
      console.error("All chats subscription error:", err);
      if (typeof errorCallback === "function") errorCallback(err);
    }
  );
}

/**
 * Uploads an image or document attachment to Firebase Storage (lanica_chats/{fileName})
 */
export async function uploadChatAttachment(file, chatId) {
  if (!file) throw new Error("No file provided.");
  const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const path = `lanica_chats/${chatId || "general"}/${safeName}`;
  const fileRef = storageRef(storage, path);

  const snapshot = await uploadBytes(fileRef, file);
  const downloadUrl = await getDownloadURL(snapshot.ref);
  return downloadUrl;
}
