/**
 * notificationService.js - Real-Time Push & Email Alert Module for Lanica
 * Handles:
 * 1. Browser Web Notification API & Service Worker integration
 * 2. Real-time audio chimes via Web Audio API (New Order vs New Chat)
 * 3. Tab title pulse alerts when blurred/minimized
 * 4. In-app fallback toasts
 * 5. Serverless transactional email alert dispatch (/api/notify)
 */

import { showToast } from "./uiFeedback.js";

let swRegistration = null;
let titleInterval = null;
let originalTitle = document.title || "Lanica Luxury Living Furniture";
let audioContextInstance = null;

function getAudioContext() {
  if (!audioContextInstance) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContextInstance = new AudioCtx();
    }
  }
  if (audioContextInstance && audioContextInstance.state === "suspended") {
    audioContextInstance.resume().catch(() => {});
  }
  return audioContextInstance;
}

/**
 * Initialize Service Worker and register notification listeners.
 */
export async function initNotifications() {
  if ("serviceWorker" in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("Lanica Notification Service Worker registered successfully.");
    } catch (err) {
      console.warn("Service Worker registration skipped or failed:", err);
    }
  }

  // Restore document title when user focuses back on the tab
  window.addEventListener("focus", () => {
    stopTitleFlashing();
  });

  return getNotificationPermission();
}

/**
 * Returns current permission status: 'granted', 'denied', or 'default'.
 */
export function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Request notification permission from user with graceful error handling.
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.warn("Notifications are not supported in this browser.");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    console.warn("Notification permission was previously denied by user.");
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      showToast("Push notifications enabled! You will receive live order & chat alerts.", "success", 4000);
      return true;
    }
    return false;
  } catch (err) {
    console.warn("Error requesting notification permission:", err);
    return false;
  }
}

/**
 * Play high-end melodic chime for a New Order (Upbeat 4-note ascending chord: C5 -> E5 -> G5 -> C6).
 */
export function playOrderNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const startTime = ctx.currentTime;

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime + index * 0.08);

      gain.gain.setValueAtTime(0, startTime + index * 0.08);
      gain.gain.linearRampToValueAtTime(0.25, startTime + index * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + index * 0.08 + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + index * 0.08);
      osc.stop(startTime + index * 0.08 + 0.35);
    });
  } catch (_) {
    // Autoplay restrictions may mute before user interaction
  }
}

/**
 * Play clean two-tone chime for a New Chat Message (D5 -> A5).
 */
export function playChatNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (_) {}
}

/**
 * Flashes browser tab title when document is hidden/unfocused.
 */
export function flashDocumentTitle(alertText) {
  if (!document.hidden) return;
  stopTitleFlashing();

  originalTitle = document.title || "Lanica Furniture";
  let isOriginal = false;

  titleInterval = setInterval(() => {
    document.title = isOriginal ? originalTitle : alertText;
    isOriginal = !isOriginal;
  }, 1000);
}

export function stopTitleFlashing() {
  if (titleInterval) {
    clearInterval(titleInterval);
    titleInterval = null;
    document.title = originalTitle;
  }
}

/**
 * Shows browser native Web Push Notification banner.
 */
export async function showWebPushNotification(title, options = {}) {
  const mergedOptions = {
    icon: "/assets/lanicalogo.jpg",
    badge: "/assets/lanicalogo.jpg",
    vibrate: [200, 100, 200],
    ...options,
  };

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      if (swRegistration && "showNotification" in swRegistration) {
        await swRegistration.showNotification(title, mergedOptions);
        return;
      }
    } catch (_) {}

    try {
      const notif = new Notification(title, mergedOptions);
      if (mergedOptions.data?.url) {
        notif.onclick = () => {
          window.focus();
          window.location.href = mergedOptions.data.url;
          notif.close();
        };
      }
    } catch (_) {}
  }
}

/**
 * Sends transactional email alert in background via Cloudflare Pages / Express API.
 */
export async function sendEmailAlert(payload) {
  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    // Non-blocking background attempt
    return { success: false, error: err.message };
  }
}

/**
 * High-Level Trigger: NEW ORDER NOTIFICATION
 * Called whenever a new customer order is placed or detected in Firestore.
 */
export async function notifyNewOrder(order, { role = "admin" } = {}) {
  const orderId = order.id || order.orderId || "";
  const shortId = orderId.slice(0, 8);
  const customerName = order.customerName || order.userName || "Customer";
  const totalAmount = Number(order.totalAmount || order.total || 0);
  const formattedTotal = totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 });
  const targetUrl = role === "staff" ? "/staff.html" : "/admin.html";

  // 1. Audio Chime
  playOrderNotificationSound();

  // 2. Tab Title Flasher
  flashDocumentTitle(`(1) 📦 New Order #${shortId}!`);

  // 3. Web Push Notification
  const notifTitle = `📦 New Order Placed! #${shortId}`;
  const notifBody = `${customerName} ordered ₱${formattedTotal}. Tap to review and process.`;
  await showWebPushNotification(notifTitle, {
    body: notifBody,
    tag: `order-${orderId}`,
    data: { url: targetUrl, orderId: orderId },
  });

  // 4. In-App Toast
  showToast(`📦 New Order #${shortId} from ${customerName} (₱${formattedTotal})!`, "success", 8000);

  // 5. Cloudflare Serverless Email Alert (in background)
  sendEmailAlert({
    type: "new_order",
    title: notifTitle,
    body: notifBody,
    orderId: orderId,
    customerName: customerName,
    totalAmount: totalAmount,
  });
}

/**
 * High-Level Trigger: NEW CHAT MESSAGE NOTIFICATION
 * Called when a new unread message arrives from customer or staff.
 */
export async function notifyNewChatMessage(messageText, session, { role = "admin" } = {}) {
  const senderName = session.customerName || session.userName || "Customer";
  const cleanPreview = String(messageText || "Sent a message").slice(0, 100);
  let targetUrl = "/admin.html";
  if (role === "staff") targetUrl = "/staff.html";
  if (role === "customer") targetUrl = "/orders.html";

  // 1. Audio Chime
  playChatNotificationSound();

  // 2. Tab Title Flasher
  flashDocumentTitle(`(1) 💬 Message from ${senderName}`);

  // 3. Web Push Notification
  const notifTitle = `💬 New Message from ${senderName}`;
  await showWebPushNotification(notifTitle, {
    body: cleanPreview,
    tag: `chat-${session.id || "general"}`,
    data: { url: targetUrl, sessionId: session.id },
  });

  // 4. In-App Toast (for customer side, or fallback)
  if (role === "customer") {
    showToast(`💬 Lanica Support: ${cleanPreview}`, "info", 7000);
  }

  // 5. Cloudflare Serverless Email Alert (in background for staff/admin)
  if (role === "admin" || role === "staff") {
    sendEmailAlert({
      type: "new_chat",
      title: notifTitle,
      body: cleanPreview,
      customerName: senderName,
      previewText: cleanPreview,
    });
  }
}
