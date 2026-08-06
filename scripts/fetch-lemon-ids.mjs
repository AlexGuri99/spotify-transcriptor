/* ------------------------------------------------------------------ */
/* Fetch Lemon Squeezy variant IDs — run AFTER creating products in    */
/* the Lemon Squeezy dashboard.                                        */
/*                                                                    */
/* Usage:                                                              */
/*   1. Create products in the LS dashboard first (see instructions)   */
/*   2. env LEMON_SQUEEZY_API_KEY="..." node scripts/fetch-lemon-ids.mjs */
/* ------------------------------------------------------------------ */

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";

const API_KEY = process.env.LEMON_SQUEEZY_API_KEY;
if (!API_KEY) {
  console.error("Usage: env LEMON_SQUEEZY_API_KEY=\"...\" node scripts/fetch-lemon-ids.mjs");
  process.exit(1);
}

async function ls(path) {
  const res = await fetch(`${LEMON_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
  });
  return res.json();
}

console.log("=== STEP 1: Create products in Lemon Squeezy dashboard ===\n");
console.log("Go to: https://app.lemonsqueezy.com/products\n");
console.log("Create these products in your 'Tranzkript' store:\n");

console.log("── PayGo Products (one-time purchases) ──");
console.log("  1. Name: 'PayGo 5'   — $5.00  | 16 pods");
console.log("  2. Name: 'PayGo 10'  — $10.00 | 33 pods");
console.log("  3. Name: 'PayGo 20'  — $20.00 | 66 pods");
console.log("  4. Name: 'PayGo 30'  — $30.00 | 100 pods");
console.log("  → For each: set as one-time purchase, no license keys needed\n");

console.log("── Pro Product (subscription) ──");
console.log("  5. Name: 'Pro' — monthly subscription");
console.log("  → Set as recurring/subscription, no license keys\n");

console.log("── After creating all products, add variants to 'Pro' ──");
console.log("  Edit the 'Pro' product and add these variants:");
for (let pods = 6; pods <= 120; pods += pods < 10 ? 4 : 5) {
  const pp = pods <= 30 ? 0.17 : pods <= 75 ? 0.14 : 0.11;
  const monthly = (pods * pp).toFixed(2);
  const next = pods === 6 ? 10 : pods + (pods < 10 ? 4 : 5);
  const display = pods === 6 ? "6" : `${pods}`;
  console.log(`     ${display} pods — $${monthly}/mo  (SKU: pro-${display})`);
}
console.log("  (SKUs help us match them automatically)\n");

console.log("=== STEP 2: Re-run this script after creating ===\n");

console.log("--- Existing products in store ---\n");

const products = await ls(`/products?filter[store_id]=442988`);
if (!products.data || products.data.length === 0) {
  console.log("No products found yet. Create them in the dashboard first, then re-run.");
  process.exit(0);
}

for (const product of products.data) {
  const p = product.attributes;
  console.log(`Product: ${p.name} (ID: ${product.id})`);
  console.log(`  Description: ${p.description}`);
  console.log(`  Price: ${p.price / 100} ${p.currency}`);
  console.log(`  Subscription: ${p.is_subscription}`);

  const variants = await ls(`/variants?filter[product_id]=${product.id}`);
  if (variants.data) {
    for (const v of variants.data) {
      const a = v.attributes;
      console.log(`  Variant: ${a.name} (ID: ${v.id})`);
      console.log(`    Price: ${a.price / 100} ${a.currency}, SKU: ${a.sku || "(none)"}`);
      console.log(`    Interval: ${a.interval || "one-time"}`);
    }
  }
  console.log("");
}

console.log("================================================");
console.log("Copy these env vars into your .env file:\n");

const output = {};

for (const product of products.data) {
  const pName = product.attributes.name;
  const variants = await ls(`/variants?filter[product_id]=${product.id}`);

  if (variants.data) {
    for (const v of variants.data) {
      const a = v.attributes;
      const sku = a.sku || "";
      const variantId = v.id;

      // Match PayGo by name
      if (pName.startsWith("PayGo")) {
        const credits = pName.includes("5") ? "16" : pName.includes("10") ? "33" : pName.includes("20") ? "66" : pName.includes("30") ? "100" : null;
        if (credits) {
          output[`LEMON_SQUEEZY_LIVE_VARIANT_PAYGO_${credits}`] = variantId;
        }
      }

      // Match Pro by SKU
      if (sku.startsWith("pro-")) {
        const pods = sku.replace("pro-", "");
        output[`LEMON_SQUEEZY_LIVE_VARIANT_PRO_${pods}`] = variantId;
      }
    }
  }
}

// Also try matching by product name pattern for Pro
for (const product of products.data) {
  if (product.attributes.name === "Pro") {
    const variants = await ls(`/variants?filter[product_id]=${product.id}`);
    if (variants.data) {
      for (const v of variants.data) {
        const a = v.attributes;
        // Try to extract pods from variant name
        const match = a.name.match(/^(\d+)\s*pods?$/i);
        if (match) {
          output[`LEMON_SQUEEZY_LIVE_VARIANT_PRO_${match[1]}`] = v.id;
        }
      }
    }
  }
}

for (const [key, id] of Object.entries(output).sort()) {
  console.log(`${key}="${id}"`);
}