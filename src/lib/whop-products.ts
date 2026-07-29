/* ------------------------------------------------------------------ */
/* Whop product ID mapping                                             */
/* Fill these in from your Whop dashboard after creating the products. */
/* ------------------------------------------------------------------ */

export interface PayGoProduct {
  price: number; // USD
  credits: number; // pods
  envVar: string;
}

export interface ProProduct {
  pods: number;
  pricePerPod: number;
  monthlyPrice: number;
  envVar: string;
}

export const PAYGO_PRODUCTS: PayGoProduct[] = [
  { price: 5, credits: 16, envVar: "WHOP_PRODUCT_PAYGO_5" },
  { price: 10, credits: 33, envVar: "WHOP_PRODUCT_PAYGO_10" },
  { price: 20, credits: 66, envVar: "WHOP_PRODUCT_PAYGO_20" },
  { price: 30, credits: 100, envVar: "WHOP_PRODUCT_PAYGO_30" },
];

function getProTier(pods: number): number {
  if (pods <= 30) return 0.17;
  if (pods <= 75) return 0.14;
  return 0.11;
}

export const PRO_PRODUCTS: ProProduct[] = [];
// Slider snaps to multiples of 5, min 6
for (let pods = 10; pods <= 120; pods += 5) {
  const pricePerPod = getProTier(pods);
  PRO_PRODUCTS.push({
    pods,
    pricePerPod,
    monthlyPrice: Math.round(pods * pricePerPod * 100) / 100,
    envVar: `WHOP_PRODUCT_PRO_${pods}`,
  });
}
// Add 6-pod plan separately (it's not a multiple of 5)
PRO_PRODUCTS.unshift({
  pods: 6,
  pricePerPod: 0.17,
  monthlyPrice: 1.02,
  envVar: "WHOP_PRODUCT_PRO_6",
});

/** Get the Whop product ID for a PayGo product by credit amount. */
export function getPayGoProductId(credits: number): string | null {
  const product = PAYGO_PRODUCTS.find((p) => p.credits === credits);
  if (!product) return null;
  return process.env[product.envVar] ?? null;
}

/** Get the Whop product ID for a Pro plan by pod count. */
export function getProProductId(pods: number): string | null {
  const product = PRO_PRODUCTS.find((p) => p.pods === pods);
  if (!product) return null;
  return process.env[product.envVar] ?? null;
}

/** Get the Whop checkout URL for a given product ID. */
export function getCheckoutUrl(productId: string, email: string): string {
  return `https://whop.com/checkout/${productId}/?email=${encodeURIComponent(email)}`;
}

/** Given a Whop product ID, figure out what plan type it is. */
export function identifyProduct(productId: string): {
  type: "paygo" | "pro" | "unknown";
  pods?: number;
  credits?: number;
} {
  for (const p of PAYGO_PRODUCTS) {
    if (process.env[p.envVar] === productId) {
      return { type: "paygo", credits: p.credits };
    }
  }
  for (const p of PRO_PRODUCTS) {
    if (process.env[p.envVar] === productId) {
      return { type: "pro", pods: p.pods };
    }
  }
  return { type: "unknown" };
}