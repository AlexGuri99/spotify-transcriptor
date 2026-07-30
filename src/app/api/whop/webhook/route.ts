import { NextRequest, NextResponse } from "next/server";
import { identifyProduct } from "@/lib/whop-products";
import { verifyWebhookSignature } from "@/lib/whop";
import { setUserPlan, getUserData } from "@/lib/usage-tracker";

/* ------------------------------------------------------------------ */
/* Idempotency — deduplicate webhook events within a 5-minute window  */
/* ------------------------------------------------------------------ */
const PROCESSED_EVENT_IDS = new Set<string>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

function markProcessed(eventId: string) {
  PROCESSED_EVENT_IDS.add(eventId);
  setTimeout(() => PROCESSED_EVENT_IDS.delete(eventId), IDEMPOTENCY_TTL_MS);
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

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.error("[Whop Webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  /* ---------------------------------------------------------------- */
  /* Parse the event                                                  */
  /* ---------------------------------------------------------------- */
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType: string = payload.type ?? "";
  const eventData: any = payload.data ?? {};

  // Log the full event for debugging (first time)
  console.log(`[Whop Webhook] Event: ${eventType}`);
  console.log(`[Whop Webhook] Payload keys: ${Object.keys(payload).join(", ")}`);
  console.log(`[Whop Webhook] Data keys: ${Object.keys(eventData).join(", ")}`);

  /* ---------------------------------------------------------------- */
  /* Idempotency — skip if we've already processed this event         */
  /* ---------------------------------------------------------------- */
  const eventId = payload.id ?? eventData.id ?? "";
  if (eventId && PROCESSED_EVENT_IDS.has(eventId)) {
    console.log(`[Whop Webhook] ⏭️ Skipping duplicate event ${eventId} (${eventType})`);
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (eventId) markProcessed(eventId);

  /* ---------------------------------------------------------------- */
  /* Extract identifiers — Whop may nest them differently per event   */
  /* ---------------------------------------------------------------- */

  // Try multiple possible locations for product_id and customer email
  const productId =
    eventData.product_id ??
    eventData.product?.id ??
    eventData.membership?.product_id ??
    eventData.payment?.product_id ??
    "";

  const customerEmail =
    eventData.customer_email ??
    eventData.email ??
    eventData.customer?.email ??
    eventData.user?.email ??
    eventData.membership?.user_email ??
    eventData.payment?.customer_email ??
    "";

  console.log(`[Whop Webhook] Extracted — productId: ${productId}, email: ${customerEmail}`);

  if (!productId || !customerEmail) {
    console.log("[Whop Webhook] Missing product_id or customer_email — acknowledging but not processing");
    return NextResponse.json({ ok: true });
  }

  const identified = identifyProduct(productId);

  try {
    switch (eventType) {
      /* ------------------------------------------------------------ */
      /* PayGo — one-time payment succeeded: add credits              */
      /* ------------------------------------------------------------ */
      case "payment.succeeded":
        if (identified.type === "paygo" && identified.credits) {
          const user = await getUserData(customerEmail);
          const currentCredits = user.creditsRemaining ?? 0;
          await setUserPlan(customerEmail, "credits", currentCredits + identified.credits);
          console.log(
            `[Whop Webhook] ✅ Added ${identified.credits} credits to ${customerEmail} (${currentCredits} → ${currentCredits + identified.credits})`
          );
        }
        break;

      /* ------------------------------------------------------------ */
      /* Payment failed — subscription renewal failure                */
      /* ------------------------------------------------------------ */
      case "payment.failed":
        if (identified.type === "pro") {
          console.log(
            `[Whop Webhook] ⚠️ Payment failed for ${customerEmail} on Pro plan — subscription may lapse`
          );
          // Don't change plan immediately — Whop will retry payments.
          // If all retries fail, Whop sends membership.deactivated.
        }
        break;

      /* ------------------------------------------------------------ */
      /* Pro subscription events                                       */
      /* ------------------------------------------------------------ */
      case "membership.activated":
        if (identified.type === "pro" && identified.pods) {
          await setUserPlan(customerEmail, "pro", identified.pods);
          console.log(`[Whop Webhook] ✅ ${eventType}: ${customerEmail} → Pro (${identified.pods} pods)`);
        }
        break;

      case "membership.cancel_at_period_end_changed": {
        // This fires when the user toggles cancel/uncancel.
        // The event data includes cancel_at_period_end — true means they cancelled,
        // false means they un-cancelled. Only set to Pro on un-cancel.
        const cancelAtPeriodEnd = eventData.cancel_at_period_end ?? eventData.membership?.cancel_at_period_end;
        if (cancelAtPeriodEnd === true) {
          console.log(`[Whop Webhook] ${eventType}: ${customerEmail} cancelled (will lapse at period end) — no plan change`);
        } else if (identified.type === "pro" && identified.pods) {
          await setUserPlan(customerEmail, "pro", identified.pods);
          console.log(`[Whop Webhook] ✅ ${eventType}: ${customerEmail} un-cancelled → Pro (${identified.pods} pods)`);
        } else {
          console.log(`[Whop Webhook] ℹ️ ${eventType}: ${customerEmail} — unknown product, no action`);
        }
        break;
      }

      case "membership.deactivated":
        if (identified.type === "pro") {
          await setUserPlan(customerEmail, "free", 0);
          console.log(`[Whop Webhook] ✅ ${eventType}: ${customerEmail} reverted to free`);
        }
        break;

      /* ------------------------------------------------------------ */
      /* Refunds — reverse the credits or revert Pro to free          */
      /* ------------------------------------------------------------ */
      case "refund.created":
      case "refund.updated":
        if (identified.type === "paygo" && identified.credits) {
          const user = await getUserData(customerEmail);
          const currentCredits = user.creditsRemaining ?? 0;
          const newCredits = Math.max(0, currentCredits - identified.credits);
          await setUserPlan(customerEmail, currentCredits - newCredits <= 0 ? "free" : "credits", newCredits);
          console.log(
            `[Whop Webhook] 🔄 Refund: removed ${identified.credits} credits from ${customerEmail} (${currentCredits} → ${newCredits})`
          );
        } else if (identified.type === "pro") {
          await setUserPlan(customerEmail, "free", 0);
          console.log(`[Whop Webhook] 🔄 Refund: ${customerEmail} reverted to free`);
        }
        break;

      /* ------------------------------------------------------------ */
      /* Also handle payment.created as a fallback for PayGo          */
      /* ------------------------------------------------------------ */
      case "payment.created":
        // payment.created fires before payment.succeeded;
        // we only act on payment.succeeded to avoid double-crediting.
        console.log(`[Whop Webhook] ℹ️ Ignoring payment.created — waiting for payment.succeeded`);
        break;

      default:
        console.log(`[Whop Webhook] ℹ️ Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`[Whop Webhook] Error processing ${eventType}:`, err);
  }

  return NextResponse.json({ ok: true });
}