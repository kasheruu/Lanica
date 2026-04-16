function buildJsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function onRequestGet(context) {
  try {
    const rawUrl = String(context.request.url ? new URL(context.request.url).searchParams.get("url") || "" : "").trim();
    if (!rawUrl) {
      return buildJsonResponse({ error: "Missing url query parameter." }, 400);
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return buildJsonResponse({ error: "Invalid URL." }, 400);
    }

    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.endsWith("meshy.ai")) {
      return buildJsonResponse({ error: "Only meshy.ai URLs are allowed." }, 400);
    }

    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      const bodyText = await upstream.text();
      return new Response(bodyText || "Failed to fetch GLB.", {
        status: upstream.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        },
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") || "model/gltf-binary",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return buildJsonResponse({ error: "Proxy request failed." }, 500);
  }
}
