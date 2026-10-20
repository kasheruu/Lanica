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

    const publicKey = String(
      context.env?.PAYMONGO_PUBLIC_KEY ||
      context.env?.PAYMONGO_PUBLIC ||
      context.env?.PAYMONGO_PUBKEY ||
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

    const orderId = String(body.orderId || "").trim();
    const rawTotal = Number(body.totalAmount);

    if (!orderId) {
      return jsonResponse({ error: "Missing required field: orderId." }, 400);
    }
    if (isNaN(rawTotal) || rawTotal <= 0) {
      return jsonResponse({ error: "Invalid or missing totalAmount. Must be a positive number." }, 400);
    }

    const rawExact = Number(body.exactAmount);
    const hasExact = !isNaN(rawExact) && rawExact > 0;
    const chargePhp = hasExact ? Math.round(rawExact) : Math.round(rawTotal * 0.30);
    const chargeCentavos = hasExact ? Math.round(rawExact * 100) : Math.round(rawTotal * 0.30 * 100);
    const intentDescription = body.description || (hasExact ? `Remaining Delivery Balance for Order #${orderId}` : `30% Downpayment for Order #${orderId}`);

    const secretAuth = "Basic " + btoa(`${secretKey}:`);
    const publicAuth = "Basic " + btoa(`${publicKey || secretKey}:`);

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
            amount: chargeCentavos,
            payment_method_allowed: ["qrph", "gcash", "paymaya"],
            payment_method_options: {
              card: {
                request_three_d_secure: "any",
              },
            },
            currency: "PHP",
            description: intentDescription,
          },
        },
      }),
    });

    const intentData = await intentRes.json().catch(() => ({}));
    if (!intentRes.ok) {
      console.error("PayMongo Intent creation failed:", intentData);
      return jsonResponse(
        {
          error: intentData.errors?.[0]?.detail || "Failed to create PayMongo payment intent.",
          details: intentData.errors,
        },
        intentRes.status || 500
      );
    }

    const intentId = intentData.data?.id;
    const clientKey = intentData.data?.attributes?.client_key;
    if (!intentId) {
      return jsonResponse({ error: "Payment Intent ID missing in PayMongo response." }, 502);
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
      return jsonResponse(
        {
          error: methodData.errors?.[0]?.detail || "Failed to create PayMongo payment method.",
          details: methodData.errors,
        },
        methodRes.status || 500
      );
    }

    const paymentMethodId = methodData.data?.id;
    if (!paymentMethodId) {
      return jsonResponse({ error: "Payment Method ID missing in PayMongo response." }, 502);
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
      return jsonResponse(
        {
          error: attachData.errors?.[0]?.detail || "Failed to attach payment method to intent.",
          details: attachData.errors,
        },
        attachRes.status || 500
      );
    }

    // Extract next_action.code.image_url (Base64 data URI)
    const nextAction = attachData.data?.attributes?.next_action;
    const qrImageUrl =
      nextAction?.code?.image_url ||
      nextAction?.image_url ||
      nextAction?.code?.url ||
      "";

    if (!qrImageUrl) {
      console.error("PayMongo attach response missing QR image url:", attachData);
      return jsonResponse(
        {
          error: "QR image URL was not returned by PayMongo attach action.",
          attachAttributes: attachData.data?.attributes,
        },
        502
      );
    }

    return jsonResponse({
      success: true,
      paymentIntentId: intentId,
      qrImageUrl: qrImageUrl,
      downpaymentPhp: chargePhp,
      chargePhp: chargePhp,
    });
  } catch (err) {
    console.error("PayMongo create-qr error:", err);
    return jsonResponse({ error: err.message || "Internal server error." }, 500);
  }
}
