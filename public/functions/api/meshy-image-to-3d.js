function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const apiKey = String(
      context.env.MESHY_API_KEY ||
        context.env.MESHY_KEY ||
        context.env.MESHY_APIKEY ||
        context.env.MESHY_API ||
        ""
    ).trim();
    if (!apiKey) {
      return jsonResponse(
        { error: "Meshy API key is not configured. Set MESHY_API_KEY (or MESHY_KEY)." },
        500
      );
    }

    const body = await context.request.json().catch(() => null);
    const imageUrl = String(body?.image_url || "").trim();
    if (!imageUrl) {
      return jsonResponse({ error: "Missing image_url." }, 400);
    }

    const upstream = await fetch("https://api.meshy.ai/v1/image-to-3d", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        enable_pbr: body?.enable_pbr !== false,
        ...(body?.prompt ? { prompt: String(body.prompt).trim() } : {}),
      }),
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("Meshy create error:", error);
    return jsonResponse({ error: "Failed to start Meshy API." }, 500);
  }
}
