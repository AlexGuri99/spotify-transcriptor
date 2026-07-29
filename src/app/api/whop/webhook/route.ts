import { NextRequest, NextResponse } from "next/server";
import { identifyProduct } from "@/lib/whop-products";
import { setUserPlan, getUserData } from "@/lib/usage-tracker";

/* ------------------------------------------------------------------ */
/* Types based on Whop webhook events                                 */
/* ------------------------------------------------------------------ */

interface WhopWebhookPayload {
  type: string;
  data: {
    id: string;
    product_id: string;
    customer_email?: string;
    status?: string;
    created_at?: string;
    expires_at?: string;
    [key: string]: unknown;
  };
}

/* ------------------------------------------------------------------ */
/* Webhook handler                                                    */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  /* ---------------------------------------------------------------- */
  /* Verify webhook signature                                         */
  /* ---------------------------------------------------------------- */
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Whop Webhook] WHOP_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-whop-signature") ?? "";
  const rawBody = await req.text();

  // Simple HMAC-SHA256 verification
  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) {
    console.error("[Whop Webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  /* ---------------------------------------------------------------- */
  /* Parse and handle the event                                       */
  /* ---------------------------------------------------------------- */
  let payload: WhopWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, data } = payload;
  const customerEmail = data.customer_email ?? "";
  const productId = data.product_id ?? "";

  if (!customerEmail || !productId) {
    console.error("[Whop Webhook] Missing customer_email or product_id", { type, data });
    return NextResponse.json({ ok: true }); // Acknowledge but don't process
  }

  const identified = identifyProduct(productId);

  console.log(`[Whop Webhook] Event: ${type} | Product: ${productId} → ${identified.type} | Email: ${customerEmail}`);

  try {
    switch (type) {
      /* ------------------------------------------------------------ */
      /* PayGo — one-time purchase: add credits to user's account     */
      /* ------------------------------------------------------------ */
      case "purchase.created":
      case "purchase.completed":
        if (identified.type === "paygo" && identified.credits) {
          const user = await getUserData(customerEmail);
          const currentCredits = user.creditsRemaining ?? 0;
          await setUserPlan(customerEmail, "credits", currentCredits + identified.credits);
          console.log(
            `[Whop Webhook] Added ${identified.credits} credits to ${customerEmail} (was ${currentCredits}, now ${currentCredits + identified.credits})`
          );
        } else if (identified.type === "pro" && identified.pods) {
          // Pro subscription purchase
          await setUserPlan(customerEmail, "pro", identified.pods);
          console.log(`[Whop Webhook] Set ${customerEmail} to Pro (${identified.pods} pods)`);
        }
        break;

      /* ------------------------------------------------------------ */
      /* Pro subscription events                                       */
      /* ------------------------------------------------------------ */
      case "subscription.created":
      case "subscription.updated":
        if (identified.type === "pro" && identified.pods) {
          await setUserPlan(customerEmail, "pro", identified.pods);
          console.log(`[Whop Webhook] Subscription ${type}: ${customerEmail} → Pro (${identified.pods} pods)`);
        }
        break;

      case "subscription.cancelled":
      case "subscription.expired":
        if (identified.type === "pro") {
          // Revert to free plan
          await setUserPlan(customerEmail, "free", 0);
          console.log(`[Whop Webhook] Subscription ${type}: ${customerEmail} reverted to free`);
        }
        break;

      default:
        console.log(`[Whop Webhook] Unhandled event type: ${type}`);
    }
  } catch (err) {
    console.error(`[Whop Webhook] Error processing event ${type}:`, err);
  }

  return NextResponse.json({ ok: true });
}