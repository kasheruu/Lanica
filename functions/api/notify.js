function buildJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
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
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json().catch(() => ({}));
    const { type, title, body, orderId, customerName, totalAmount, previewText, recipientEmail } =
      payload;

    const apiKey = String(context.env?.RESEND_API_KEY || "").trim();
    const adminEmail = String(
      context.env?.ADMIN_NOTIFICATION_EMAIL || context.env?.ADMIN_EMAIL || ""
    ).trim();

    if (!apiKey) {
      console.warn("RESEND_API_KEY environment variable is not configured in Cloudflare Pages.");
      return buildJsonResponse({
        success: false,
        emailSent: false,
        warning:
          "RESEND_API_KEY environment variable is not configured in Cloudflare Pages. Please set it in Settings > Environment variables and trigger a redeployment.",
      });
    }

    const targetRecipient =
      type === "new_order" || type === "new_chat"
        ? adminEmail || recipientEmail
        : recipientEmail || adminEmail;
    if (!targetRecipient) {
      console.warn("No recipient email configured. ADMIN_NOTIFICATION_EMAIL is missing.");
      return buildJsonResponse({
        success: false,
        emailSent: false,
        warning:
          "No recipient email configured. Set ADMIN_NOTIFICATION_EMAIL in Cloudflare environment variables.",
      });
    }

    let subject = title || "Lanica Notification";
    let htmlContent = "";

    if (type === "new_order") {
      subject = `[Lanica] 📦 New Order Alert #${(orderId || "").slice(0, 8)}`;
      htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 24px 32px; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em; color: #f8fafc;">Lanica Furniture</h1>
            <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px;">Real-Time Order Alert System</p>
          </div>
          <div style="padding: 32px;">
            <div style="display: inline-block; background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px;">
              New Order Received
            </div>
            <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px;">Order #${orderId || "N/A"}</h2>
            <p style="margin: 0 0 20px; color: #475569; font-size: 14px; line-height: 1.5;">
              A customer has just placed a new order on Lanica Storefront.
            </p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 14px;">
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;">Customer:</td>
                <td style="padding: 10px 0; color: #0f172a; font-weight: 600; text-align: right;">${customerName || "Customer"}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b;">Total Amount:</td>
                <td style="padding: 10px 0; color: #059669; font-weight: 700; font-size: 16px; text-align: right;">₱${Number(totalAmount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #64748b;">Timestamp:</td>
                <td style="padding: 10px 0; color: #0f172a; text-align: right;">${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td>
              </tr>
            </table>
            <div style="text-align: center; margin-top: 28px;">
              <a href="https://lanicafurniture.com/login" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; font-weight: 600; font-size: 14px; border-radius: 8px; display: inline-block;">Open Admin Orders Hub</a>
            </div>
          </div>
          <div style="background: #f8fafc; padding: 16px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
            Lanica Luxury Living Furniture • Real-Time Notification System
          </div>
        </div>
      `;
    } else if (type === "new_chat") {
      const chatHeading = orderId ? `Order #${(orderId || "").slice(0, 8)} Message` : "Live Support Message";
      subject = `[Lanica] 💬 ${chatHeading} from ${customerName || "Customer"}`;
      htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #1e293b, #0f172a); padding: 24px 32px; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #f8fafc;">Lanica Customer Support</h1>
            <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px;">${orderId ? `Order #${(orderId || "").slice(0, 8)} Chat Notification` : "Live Chat Notification"}</p>
          </div>
          <div style="padding: 32px;">
            <div style="display: inline-block; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px;">
              ${chatHeading}
            </div>
            <p style="margin: 0 0 16px; color: #0f172a; font-size: 15px;">
              <strong>${customerName || "Customer"}</strong> sent a message:
            </p>
            <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 0 8px 8px 0; margin-bottom: 24px; color: #334155; font-size: 14px; font-style: italic;">
              "${previewText || "Sent a message / attachment"}"
            </div>
            <div style="text-align: center;">
              <a href="https://lanicafurniture.com/login" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; font-weight: 600; font-size: 14px; border-radius: 8px; display: inline-block;">Reply in Admin Chat</a>
            </div>
          </div>
          <div style="background: #f8fafc; padding: 16px 32px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
            Lanica Luxury Living Furniture • Real-Time Notification System
          </div>
        </div>
      `;
    } else {
      htmlContent = `<p>${body || title || "Lanica System Notification"}</p>`;
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
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

    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      console.warn("Resend email delivery notice:", resendData);
      return buildJsonResponse({
        success: false,
        emailSent: false,
        error: resendData.message || "Resend email gateway responded with error",
        details: resendData,
      });
    }

    return buildJsonResponse({
      success: true,
      emailSent: true,
      emailId: resendData.id,
      recipient: targetRecipient,
    });
  } catch (err) {
    console.error("Pages function notify error:", err);
    return buildJsonResponse({ success: false, error: err.message }, 500);
  }
}
