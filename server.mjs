import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    if (!parsed.hostname.endsWith("meshy.ai")) {
      res.status(400).json({ error: "Only meshy.ai URLs are allowed." });
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

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
