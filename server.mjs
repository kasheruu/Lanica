import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Trust proxy headers from Cloudflare (CF-Connecting-IP / X-Forwarded-For)
app.set("trust proxy", 1);

// General API Rate Limiter (100 requests per 15 minutes per IP)
const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after 15 minutes." },
});

// Strict Rate Limiter for AI 3D Generation API (10 requests per 15 minutes per IP)
const meshyApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Generation limit reached. Please wait 15 minutes before initiating more 3D models." },
});

// Strict Rate Limiter for Checkout API (15 requests per 15 minutes per IP)
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checkout requests from this IP. Please try again after 15 minutes." },
});

// Apply global rate limiter to all /api/ routes
app.use("/api/", globalApiLimiter);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.static(__dirname));

function sendMeshyError(res, message, status = 500) {
  res.status(status).json({ error: message });
}

app.post("/api/meshy-image-to-3d", meshyApiLimiter, async (req, res) => {
  try {
    const apiKey = String(
      process.env.MESHY_API_KEY || process.env.MESHY_KEY || process.env.MESHY_APIKEY || process.env.MESHY_API || ""
    ).trim();
    if (!apiKey) {
      sendMeshyError(res, "Meshy API key is not configured on the server. Set MESHY_API_KEY (or MESHY_KEY).", 500);
      return;
    }

    const imageUrl = String(req.body?.image_url || "").trim();
    if (!imageUrl) {
      sendMeshyError(res, "Missing image_url.", 400);
      return;
    }

    const meshyPayload = {
      image_url: imageUrl,
      enable_pbr: req.body?.enable_pbr !== false,
      ...(req.body?.left_image_url ? { left_image_url: String(req.body.left_image_url).trim() } : {}),
      ...(req.body?.right_image_url ? { right_image_url: String(req.body.right_image_url).trim() } : {}),
      ...(req.body?.back_image_url ? { back_image_url: String(req.body.back_image_url).trim() } : {}),
      ...(req.body?.prompt ? { prompt: String(req.body.prompt).trim() } : {}),
    };

    const upstream = await fetch("https://api.meshy.ai/v1/image-to-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(meshyPayload),
    });

    const bodyText = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") || "application/json")
      .send(bodyText);
  } catch (error) {
    console.error("Meshy create error:", error);
    sendMeshyError(res, "Failed to start Meshy API.");
  }
});

app.get("/api/meshy-image-to-3d/:taskId", async (req, res) => {
  try {
    const apiKey = String(
      process.env.MESHY_API_KEY || process.env.MESHY_KEY || process.env.MESHY_APIKEY || process.env.MESHY_API || ""
    ).trim();
    if (!apiKey) {
      sendMeshyError(res, "Meshy API key is not configured on the server. Set MESHY_API_KEY (or MESHY_KEY).", 500);
      return;
    }

    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      sendMeshyError(res, "Missing task id.", 400);
      return;
    }

    const upstream = await fetch(`https://api.meshy.ai/v1/image-to-3d/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const bodyText = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get("content-type") || "application/json")
      .send(bodyText);
  } catch (error) {
    console.error("Meshy status error:", error);
    sendMeshyError(res, "Failed to fetch Meshy status.");
  }
});

app.get("/api/meshy-glb", async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url query parameter." });
      return;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: "Invalid URL." });
      return;
    }

    const isMeshy = parsed.hostname.endsWith("meshy.ai");
    const isFirebase =
      parsed.hostname.includes("firebasestorage.googleapis.com") ||
      parsed.hostname.includes("firebasestorage.app") ||
      parsed.hostname.includes("firebaseapp.com");

    if (!isMeshy && !isFirebase) {
      res.status(400).json({ error: "Only meshy.ai or Firebase Storage URLs are allowed." });
      return;
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      const bodyText = await upstream.text();
      res.status(upstream.status).send(bodyText || "Failed to fetch GLB.");
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "model/gltf-binary");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!upstream.body) {
      res.status(502).send("No upstream body.");
      return;
    }

    const arr = await upstream.arrayBuffer();
    res.status(200).send(Buffer.from(arr));
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Proxy request failed." });
  }
});

app.post("/api/paymongo/checkout", checkoutLimiter, async (req, res) => {
  try {
    const paymongoKey = String(
      process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_KEY || ""
    ).trim();

    const { items, subtotal, shippingFee, totalAmount, paymentMethod, paymentOption, successUrl, cancelUrl } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided for checkout." });
      return;
    }

    const host = req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const defaultSuccessUrl = `${protocol}://${host}/?payment=success`;
    const defaultCancelUrl = `${protocol}://${host}/?payment=cancel`;

    const finalSuccessUrl = successUrl || defaultSuccessUrl;
    const finalCancelUrl = cancelUrl || defaultCancelUrl;

    const isDownpayment = paymentOption === "downpayment";
    const multiplier = isDownpayment ? 0.30 : 1.0;

    const lineItems = items.map((item) => ({
      currency: "PHP",
      amount: Math.round(Number(item.price) * multiplier * 100), // convert to centavos (30% if downpayment)
      name: `${item.name} (${item.material || "Standard"})${isDownpayment ? " [30% Downpayment]" : ""}`,
      quantity: Number(item.quantity) || 1,
      images: item.url ? [item.url] : undefined,
    }));

    if (shippingFee && Number(shippingFee) > 0) {
      lineItems.push({
        currency: "PHP",
        amount: Math.round(Number(shippingFee) * 100),
        name: "Shipping Fee",
        quantity: 1,
      });
    }

    // Determine PayMongo payment methods based on selected payment method
    let paymentMethodTypes = ["gcash", "dob", "paymaya", "card"];
    if (paymentMethod === "GCash") {
      paymentMethodTypes = ["gcash"];
    } else if (paymentMethod === "Bank Transfer") {
      paymentMethodTypes = ["dob", "brankas"];
    }

    if (!paymongoKey) {
      console.warn("PayMongo secret key not set. Returning test mode checkout response.");
      res.status(200).json({
        checkout_url: `${finalSuccessUrl}&mock=true&method=${encodeURIComponent(paymentMethod || "online")}`,
        checkout_session_id: `cs_test_mock_${Date.now()}`,
        is_mock: true,
      });
      return;
    }

    const authHeader = `Basic ${Buffer.from(`${paymongoKey}:`).toString("base64")}`;

    const paymongoRes = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            line_items: lineItems,
            payment_method_types: paymentMethodTypes,
            success_url: finalSuccessUrl,
            cancel_url: finalCancelUrl,
          },
        },
      }),
    });

    const data = await paymongoRes.json();

    if (!paymongoRes.ok) {
      console.error("PayMongo API error:", data);
      res.status(paymongoRes.status).json({
        error: data.errors?.[0]?.detail || "Failed to create PayMongo checkout session.",
      });
      return;
    }

    const checkoutUrl = data.data?.attributes?.checkout_url;
    const sessionId = data.data?.id;

    res.status(200).json({
      checkout_url: checkoutUrl,
      checkout_session_id: sessionId,
    });
  } catch (error) {
    console.error("PayMongo error:", error);
    res.status(500).json({ error: "Failed to process online checkout." });
  }
});

app.post("/api/paymongo/create-qr", checkoutLimiter, async (req, res) => {
  try {
    const secretKey = String(
      process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_SECRET || process.env.PAYMONGO_KEY || ""
    ).trim();
    const publicKey = String(
      process.env.PAYMONGO_PUBLIC_KEY || process.env.PAYMONGO_PUBLIC || process.env.PAYMONGO_PUBKEY || ""
    ).trim();

    if (!secretKey) {
      res.status(500).json({ error: "PayMongo secret key is not configured on the server. Set PAYMONGO_SECRET_KEY." });
      return;
    }

    const { orderId, totalAmount } = req.body || {};
    const cleanOrderId = String(orderId || "").trim();
    const rawTotal = Number(totalAmount);

    if (!cleanOrderId) {
      res.status(400).json({ error: "Missing required field: orderId." });
      return;
    }
    if (isNaN(rawTotal) || rawTotal <= 0) {
      res.status(400).json({ error: "Invalid or missing totalAmount. Must be a positive number." });
      return;
    }

    const downpaymentAmount = Math.round(rawTotal * 0.30 * 100);
    const downpaymentPhp = Math.round(rawTotal * 0.30);

    const secretAuth = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
    const publicAuth = `Basic ${Buffer.from(`${publicKey || secretKey}:`).toString("base64")}`;

    // Step 1: POST to https://api.paymongo.com/v1/payment_intents
    const intentRes = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers: {
        Authorization: secretAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: downpaymentAmount,
            payment_method_allowed: ["qrph", "gcash", "paymaya"],
            payment_method_options: {
              card: {
                request_three_d_secure: "any",
              },
            },
            currency: "PHP",
            description: `30% Downpayment for Order #${cleanOrderId}`,
          },
        },
      }),
    });

    const intentData = await intentRes.json().catch(() => ({}));
    if (!intentRes.ok) {
      console.error("PayMongo Intent creation failed:", intentData);
      res.status(intentRes.status || 500).json({
        error: intentData.errors?.[0]?.detail || "Failed to create PayMongo payment intent.",
        details: intentData.errors,
      });
      return;
    }

    const intentId = intentData.data?.id;
    const clientKey = intentData.data?.attributes?.client_key;
    if (!intentId) {
      res.status(502).json({ error: "Payment Intent ID missing in PayMongo response." });
      return;
    }

    // Step 2: POST to https://api.paymongo.com/v1/payment_methods
    const methodRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers: {
        Authorization: publicAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            type: "qrph",
          },
        },
      }),
    });

    const methodData = await methodRes.json().catch(() => ({}));
    if (!methodRes.ok) {
      console.error("PayMongo Payment Method creation failed:", methodData);
      res.status(methodRes.status || 500).json({
        error: methodData.errors?.[0]?.detail || "Failed to create PayMongo payment method.",
        details: methodData.errors,
      });
      return;
    }

    const paymentMethodId = methodData.data?.id;
    if (!paymentMethodId) {
      res.status(502).json({ error: "Payment Method ID missing in PayMongo response." });
      return;
    }

    // Step 3: POST to https://api.paymongo.com/v1/payment_intents/{intentId}/attach
    const attachPayload = {
      data: {
        attributes: {
          payment_method: paymentMethodId,
          ...(clientKey ? { client_key: clientKey } : {}),
        },
      },
    };

    const attachRes = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(intentId)}/attach`,
      {
        method: "POST",
        headers: {
          Authorization: secretAuth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(attachPayload),
      }
    );

    const attachData = await attachRes.json().catch(() => ({}));
    if (!attachRes.ok) {
      console.error("PayMongo Payment Intent Attach failed:", attachData);
      res.status(attachRes.status || 500).json({
        error: attachData.errors?.[0]?.detail || "Failed to attach payment method to intent.",
        details: attachData.errors,
      });
      return;
    }

    const nextAction = attachData.data?.attributes?.next_action;
    const qrImageUrl =
      nextAction?.code?.image_url ||
      nextAction?.image_url ||
      nextAction?.code?.url ||
      "";

    if (!qrImageUrl) {
      console.error("PayMongo attach response missing QR image url:", attachData);
      res.status(502).json({
        error: "QR image URL was not returned by PayMongo attach action.",
      });
      return;
    }

    res.status(200).json({
      success: true,
      paymentIntentId: intentId,
      qrImageUrl: qrImageUrl,
      downpaymentPhp: downpaymentPhp,
    });
  } catch (error) {
    console.error("PayMongo create-qr error:", error);
    res.status(500).json({ error: error.message || "Failed to create QR code." });
  }
});

app.post("/api/paymongo/verify-payment", checkoutLimiter, async (req, res) => {
  try {
    const secretKey = String(
      process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_SECRET || process.env.PAYMONGO_KEY || ""
    ).trim();

    if (!secretKey) {
      res.status(500).json({ error: "PayMongo secret key is not configured on the server. Set PAYMONGO_SECRET_KEY." });
      return;
    }

    const { paymentIntentId, orderId } = req.body || {};
    const cleanIntentId = String(paymentIntentId || "").trim();
    const cleanOrderId = String(orderId || "").trim();

    if (!cleanIntentId) {
      res.status(400).json({ error: "Missing required field: paymentIntentId." });
      return;
    }

    const secretAuth = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

    const getRes = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(cleanIntentId)}`,
      {
        method: "GET",
        headers: {
          Authorization: secretAuth,
          Accept: "application/json",
        },
      }
    );

    const piData = await getRes.json().catch(() => ({}));
    if (!getRes.ok) {
      console.error("PayMongo verify fetch failed:", piData);
      res.status(getRes.status || 500).json({
        error: piData.errors?.[0]?.detail || "Failed to retrieve PayMongo payment intent.",
        details: piData.errors,
      });
      return;
    }

    const attributes = piData.data?.attributes || {};
    const status = attributes.status || "";
    const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
    const hasPaidPayment = payments.some(
      (p) => p.attributes?.status === "paid" || p.attributes?.status === "succeeded"
    );

    const isPaid = status === "succeeded" || status === "paid" || hasPaidPayment;

    if (isPaid && cleanOrderId) {
      try {
        const authHeader = req.headers.authorization;
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/jobsync-745a6/databases/(default)/documents/orders/${encodeURIComponent(cleanOrderId)}?updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentIntentId&updateMask.fieldPaths=downpaymentPaidAt&updateMask.fieldPaths=orderStatus&updateMask.fieldPaths=status`;

        const patchHeaders = { "Content-Type": "application/json" };
        if (authHeader) patchHeaders["Authorization"] = authHeader;

        await fetch(firestoreUrl, {
          method: "PATCH",
          headers: patchHeaders,
          body: JSON.stringify({
            fields: {
              paymentStatus: { stringValue: "downpayment_paid" },
              paymentIntentId: { stringValue: cleanIntentId },
              downpaymentPaidAt: { timestampValue: new Date().toISOString() },
              orderStatus: { stringValue: "downpayment confirmed" },
              status: { stringValue: "Deposit Verified" },
            },
          }),
        });
      } catch (fsErr) {
        console.warn("Could not patch Firestore from server:", fsErr);
      }
    }

    res.status(200).json({
      isPaid: isPaid,
      status: status,
      paymentIntentId: cleanIntentId,
    });
  } catch (error) {
    console.error("PayMongo verify error:", error);
    res.status(500).json({ error: error.message || "Failed to verify payment." });
  }
});

app.post("/api/notify", async (req, res) => {
  try {
    const { type, title, body, orderId, customerName, totalAmount, previewText, recipientEmail } = req.body || {};
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    const adminEmail = String(process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || "").trim();

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        emailSent: false,
        warning: "RESEND_API_KEY environment variable is not configured. Web Push notification active.",
      });
    }

    const targetRecipient = recipientEmail || adminEmail;
    if (!targetRecipient) {
      return res.status(200).json({
        success: true,
        emailSent: false,
        warning: "No recipient email configured. Set ADMIN_NOTIFICATION_EMAIL in environment variables.",
      });
    }

    let subject = title || "Lanica Notification";
    if (type === "new_order") {
      subject = `[Lanica] 📦 New Order Alert #${(orderId || "").slice(0, 8)}`;
    } else if (type === "new_chat") {
      subject = `[Lanica] 💬 New Chat Message from ${customerName || "Customer"}`;
    }

    const htmlContent = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">${subject}</h2>
        <p style="color: #475569; font-size: 15px;">${body || previewText || "A new real-time event was triggered in Lanica Furniture."}</p>
        ${orderId ? `<p><strong>Order ID:</strong> ${orderId}<br><strong>Customer:</strong> ${customerName || "Customer"}<br><strong>Total:</strong> ₱${Number(totalAmount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</p>` : ""}
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Lanica Luxury Living Furniture • Real-Time Notification System</p>
      </div>
    `;

    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lanica Furniture <onboarding@resend.dev>",
        to: [targetRecipient],
        subject: subject,
        html: htmlContent,
      }),
    });

    const resData = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(200).json({ success: true, emailSent: false, error: resData.message });
    }

    res.status(200).json({ success: true, emailSent: true, emailId: resData.id });
  } catch (error) {
    console.error("Local notify endpoint error:", error);
    res.status(500).json({ error: "Failed to process notification." });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
