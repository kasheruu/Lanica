import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(__dirname));

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
