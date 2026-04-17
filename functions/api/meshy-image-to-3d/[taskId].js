function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function onRequestGet(context) {
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

    const taskId = String(context.params.taskId || "").trim();
    if (!taskId) {
      return jsonResponse({ error: "Missing task id." }, 400);
    }

    const upstream = await fetch(`https://api.meshy.ai/v1/image-to-3d/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    console.error("Meshy status error:", error);
    return jsonResponse({ error: "Failed to fetch Meshy status." }, 500);
  }
}
