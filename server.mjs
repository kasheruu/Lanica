import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.post("/api/meshy-image-to-3d", async (req, res) => {
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

    const upstream = await fetch("https://api.meshy.ai/v1/image-to-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        enable_pbr: req.body?.enable_pbr !== false,
        ...(req.body?.prompt ? { prompt: String(req.body.prompt).trim() } : {}),
      }),
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

app.post("/api/paymongo/checkout", async (req, res) => {
  try {
    const paymongoKey = String(
      process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_KEY || ""
    ).trim();

    const { items, subtotal, shippingFee, totalAmount, paymentMethod, successUrl, cancelUrl } = req.body || {};

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

    const lineItems = items.map((item) => ({
      currency: "PHP",
      amount: Math.round(Number(item.price) * 100), // convert to centavos
      name: `${item.name} (${item.material || "Standard"})`,
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

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
