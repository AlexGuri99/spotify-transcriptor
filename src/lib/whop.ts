/* ------------------------------------------------------------------ */
/* Whop API client — verify purchases, look up licenses               */
/* Docs: https://docs.whop.com                                        */
/* ------------------------------------------------------------------ */

const WHOP_API_BASE = "https://api.whop.com/v1";

function requireConfig() {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    throw new Error("WHOP_API_KEY is not configured.");
  }
  return apiKey;
}

async function whopFetch(path: string, options?: RequestInit) {
  const apiKey = requireConfig();
  const res = await fetch(`${WHOP_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whop API error (HTTP ${res.status}): ${body}`);
  }
  return res.json();
}

/** Look up a license by its ID — used to verify a purchase is still valid. */
export async function getLicense(licenseId: string): Promise<{
  id: string;
  status: string;
  productId: string;
  customerEmail: string;
  createdAt: string;
  expiresAt: string | null;
} | null> {
  try {
    const data: any = await whopFetch(`/licenses/${licenseId}`);
    return {
      id: data.id,
      status: data.status,
      productId: data.product_id,
      customerEmail: data.customer_email ?? "",
      createdAt: data.created_at,
      expiresAt: data.expires_at ?? null,
    };
  } catch {
    return null;
  }
}

/** Verify a webhook signature. */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require("crypto");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  // timingSafeEqual throws if buffers differ in length, so guard first
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Look up all licenses for a customer email from our company. */
export async function getLicensesForEmail(
  email: string
): Promise<
  Array<{
    id: string;
    status: string;
    productId: string;
    createdAt: string;
  }>
> {
  const companyId = process.env.WHOP_COMPANY_ID;
  if (!companyId) return [];

  try {
    const data: any = await whopFetch(
      `/companies/${companyId}/licenses?customer_email=${encodeURIComponent(email)}`
    );
    return (data.data ?? data.licenses ?? []).map((l: any) => ({
      id: l.id,
      status: l.status,
      productId: l.product_id,
      createdAt: l.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Cancel a Whop license/subscription.
 * Used when a user deletes their account so they aren't billed indefinitely.
 */
export async function cancelLicense(licenseId: string): Promise<boolean> {
  try {
    await whopFetch(`/licenses/${licenseId}/cancel`, { method: "POST" });
    console.log(`[Whop] Cancelled license ${licenseId}`);
    return true;
  } catch (err) {
    console.error(`[Whop] Failed to cancel license ${licenseId}:`, err);
    return false;
  }
}