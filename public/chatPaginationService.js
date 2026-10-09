/**
 * Lanica Furniture Platform - Chat Pagination & Reverse Infinite Scroll Engine
 * Cursor-based real-time messaging architecture for Order Crafting & Support Channels
 */

import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  doc,
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { db } from "./firebaseConfig.js";

const DEFAULT_BATCH_SIZE = 5;

/**
 * Initializes a cursor-based Reverse Infinite Scroll Chat Controller.
 */
export function createChatPaginationController({
  targetId,              // Order ID or User ID
  isUserSupport = false, // Boolean
  chatContainerEl,       // DOM Element containing chat messages
  renderMessageCallback, // Function(messageObj, isPrepend) -> HTMLElement
  onUnreadStateChange,   // Optional callback
}) {
  if (!targetId || !chatContainerEl) {
    return { destroy: () => {} };
  }

  let earliestDoc = null;
  let hasMoreOlder = true;
  let isLoadingOlder = false;
  let unsubscribeLive = null;
  let initialLoaded = false;

  const collectionPath = isUserSupport || String(targetId).startsWith("user_")
    ? `users/${String(targetId).replace(/^user_/, "")}/messages`
    : `orders/${targetId}/messages`;

  const messagesColRef = collection(db, ...collectionPath.split("/"));

  // 1. Initial Snapshot Listener for Recent Messages
  const initialQuery = query(
    messagesColRef,
    orderBy("createdAt", "desc"),
    limit(DEFAULT_BATCH_SIZE)
  );

  unsubscribeLive = onSnapshot(
    initialQuery,
    (snapshot) => {
      if (snapshot.empty) {
        hasMoreOlder = false;
        if (!initialLoaded) {
          chatContainerEl.innerHTML = `
            <div style="text-align: center; padding: 32px 16px; color: #94a3b8; font-size: 0.85rem;">
              No messages yet. Send a message to start the conversation! 💬
            </div>
          `;
          initialLoaded = true;
        }
        return;
      }

      const docs = snapshot.docs;
      // Cursor to earliest document in this initial batch
      earliestDoc = docs[docs.length - 1];

      // Convert docs to message objects in chronological order (oldest to newest)
      const chronDocs = [...docs].reverse();

      // Check if user is scrolled near bottom before update
      const isNearBottom =
        chatContainerEl.scrollHeight - chatContainerEl.scrollTop - chatContainerEl.clientHeight < 120;

      if (!initialLoaded) {
        chatContainerEl.innerHTML = "";
        chronDocs.forEach((docSnap) => {
          const msgObj = parseMessageDoc(docSnap, targetId);
          const msgEl = renderMessageCallback(msgObj);
          if (msgEl) chatContainerEl.appendChild(msgEl);
        });
        initialLoaded = true;
        // Scroll to bottom on initial load
        chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
      } else {
        // Real-time new message appended at bottom
        const newestDoc = docs[0];
        const msgObj = parseMessageDoc(newestDoc, targetId);
        
        // Append if not already rendered
        const existingEl = chatContainerEl.querySelector(`[data-msg-id="${newestDoc.id}"]`);
        if (!existingEl) {
          const msgEl = renderMessageCallback(msgObj);
          if (msgEl) chatContainerEl.appendChild(msgEl);
          if (isNearBottom) {
            chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
          }
        }
      }
    },
    (err) => {
      console.warn("Real-time chat snapshot error:", err);
    }
  );

  // 2. Fetch Older Messages (Reverse Scroll Up)
  async function fetchOlderMessages() {
    if (isLoadingOlder || !hasMoreOlder || !earliestDoc) return;

    isLoadingOlder = true;

    // Insert Top Spinner Bar
    let loadingBar = chatContainerEl.querySelector(".chat-reverse-loading-bar");
    if (!loadingBar) {
      loadingBar = document.createElement("div");
      loadingBar.className = "chat-reverse-loading-bar";
      loadingBar.innerHTML = `<div class="chat-spinner-icon"></div><span>Loading earlier messages…</span>`;
      chatContainerEl.insertBefore(loadingBar, chatContainerEl.firstChild);
    }

    const prevScrollHeight = chatContainerEl.scrollHeight;

    try {
      const olderQuery = query(
        messagesColRef,
        orderBy("createdAt", "desc"),
        startAfter(earliestDoc),
        limit(DEFAULT_BATCH_SIZE)
      );

      const snapshot = await getDocs(olderQuery);

      if (loadingBar) loadingBar.remove();

      if (snapshot.empty) {
        hasMoreOlder = false;
        isLoadingOlder = false;
        return;
      }

      const docs = snapshot.docs;
      earliestDoc = docs[docs.length - 1];
      if (docs.length < DEFAULT_BATCH_SIZE) {
        hasMoreOlder = false;
      }

      // Prepend older messages in chronological order above current messages
      const fragment = document.createDocumentFragment();
      docs.forEach((docSnap) => {
        const msgObj = parseMessageDoc(docSnap, targetId);
        const msgEl = renderMessageCallback(msgObj);
        if (msgEl) fragment.appendChild(msgEl);
      });

      chatContainerEl.insertBefore(fragment, chatContainerEl.firstChild);

      // Retain Scroll Position seamlessly without jump
      const newScrollHeight = chatContainerEl.scrollHeight;
      chatContainerEl.scrollTop = newScrollHeight - prevScrollHeight;
    } catch (err) {
      console.error("Failed to load older messages:", err);
      if (loadingBar) loadingBar.remove();
    } finally {
      isLoadingOlder = false;
    }
  }

  // 3. Attach Scroll Listener for Reverse Infinite Scroll Trigger
  const handleScroll = () => {
    if (chatContainerEl.scrollTop <= 40 && hasMoreOlder && !isLoadingOlder) {
      fetchOlderMessages();
    }
  };

  chatContainerEl.addEventListener("scroll", handleScroll, { passive: true });

  return {
    destroy: () => {
      if (unsubscribeLive) unsubscribeLive();
      if (chatContainerEl) chatContainerEl.removeEventListener("scroll", handleScroll);
    },
    scrollToBottom: () => {
      if (chatContainerEl) chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
    },
  };
}

/**
 * Normalizes Firestore document snapshot into standardized message object.
 */
function parseMessageDoc(docSnap, targetId) {
  const d = docSnap.data();
  const textContent = d.content || d.text || d.message || "";
  const fileUrl = d.attachmentUrl || d.imageUrl || (d.type === 1 ? d.content : "") || "";
  const isFromStaff =
    d.senderRole === "admin" ||
    d.senderRole === "staff" ||
    d.senderId === "support_admin";

  return {
    id: docSnap.id,
    orderId: targetId,
    content: textContent,
    text: textContent,
    attachmentUrl: fileUrl,
    senderId: d.senderId,
    senderName: d.senderName || (isFromStaff ? "Lanica Workshop" : "Customer"),
    senderRole: d.senderRole || (isFromStaff ? "admin" : "customer"),
    type: d.type ?? (fileUrl ? 1 : 0),
    createdAt: d.createdAt || d.timestamp,
  };
}
