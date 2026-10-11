function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const secretKey = String(
      context.env?.PAYMONGO_SECRET_KEY ||
      context.env?.PAYMONGO_SECRET ||
      context.env?.PAYMONGO_KEY ||
      ""
    ).trim();

    if (!secretKey) {
      return jsonResponse(
        { error: "PayMongo secret key is not configured on the server. Set env.PAYMONGO_SECRET_KEY." },
        500
      );
    }

    const body = await context.request.json().catch(() => null);
    if (!body) {
      return jsonResponse({ error: "Invalid JSON request body." }, 400);
    }

    const paymentIntentId = String(body.paymentIntentId || "").trim();
    const orderId = String(body.orderId || "").trim();

    if (!paymentIntentId) {
      return jsonResponse({ error: "Missing required field: paymentIntentId." }, 400);
    }

    const secretAuth = "Basic " + btoa(`${secretKey}:`);

    // Fetch Payment Intent from PayMongo
    const getRes = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
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
      console.error("PayMongo Payment Intent verification fetch failed:", piData);
      return jsonResponse(
        {
          error: piData.errors?.[0]?.detail || "Failed to retrieve PayMongo payment intent.",
          details: piData.errors,
        },
        getRes.status || 500
      );
    }

    const attributes = piData.data?.attributes || {};
    const status = attributes.status || "";
    const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
    const hasPaidPayment = payments.some(
      (p) => p.attributes?.status === "paid" || p.attributes?.status === "succeeded"
    );

    const isPaid = status === "succeeded" || status === "paid" || hasPaidPayment;

    // Upon verification: Update Firestore orders/{orderId}
    if (isPaid && orderId) {
      try {
        const authHeader = context.request.headers.get("Authorization");
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/jobsync-745a6/databases/(default)/documents/orders/${encodeURIComponent(orderId)}?updateMask.fieldPaths=paymentStatus&updateMask.fieldPaths=paymentIntentId&updateMask.fieldPaths=downpaymentPaidAt&updateMask.fieldPaths=orderStatus&updateMask.fieldPaths=status`;

        const patchHeaders = {
          "Content-Type": "application/json",
        };
        if (authHeader) {
          patchHeaders["Authorization"] = authHeader;
        }

        await fetch(firestoreUrl, {
          method: "PATCH",
          headers: patchHeaders,
          body: JSON.stringify({
            fields: {
              paymentStatus: { stringValue: "downpayment_paid" },
              paymentIntentId: { stringValue: paymentIntentId },
              downpaymentPaidAt: { timestampValue: new Date().toISOString() },
              orderStatus: { stringValue: "downpayment confirmed" },
              status: { stringValue: "Downpayment Confirmed" },
            },
          }),
        });
      } catch (fsErr) {
        console.warn("Could not patch Firestore from Cloudflare backend:", fsErr);
      }
    }

    return jsonResponse({
      isPaid: isPaid,
      status: status,
      paymentIntentId: paymentIntentId,
    });
  } catch (err) {
    console.error("PayMongo verify-payment error:", err);
    return jsonResponse({ error: err.message || "Internal server error." }, 500);
  }
}
