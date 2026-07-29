#!/usr/bin/env node

/* ------------------------------------------------------------------ */
/* Create all Whop products for Tranzkript                            */
/* Run: node scripts/create-whop-products.mjs                         */
/*                                                                     */
/* Requires these env vars:                                            */
/*   WHOP_API_KEY    — from Whop Dashboard → Settings → API Keys       */
/*   WHOP_COMPANY_ID — your company ID (e.g. biz_xxx)                  */
/* ------------------------------------------------------------------ */

const WHOP_API_BASE = "https://api.whop.com/api/v1";

const API_KEY = process.env.WHOP_API_KEY;
const COMPANY_ID = process.env.WHOP_COMPANY_ID;

if (!API_KEY || !COMPANY_ID) {
  console.error("Missing required env vars:");
  console.error("  WHOP_API_KEY    — set this first");
  console.error("  WHOP_COMPANY_ID — set this first");
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Product definitions                                                 */
/* ------------------------------------------------------------------ */

function getProTier(pods) {
  if (pods <= 30) return 0.17;
  if (pods <= 75) return 0.14;
  return 0.11;
}

const PAYGO_PRODUCTS = [
  { title: "Tranzkript $5 Top-Up", price: 5, credits: 16 },
  { title: "Tranzkript $10 Top-Up", price: 10, credits: 33 },
  { title: "Tranzkript $20 Top-Up", price: 20, credits: 66 },
  { title: "Tranzkript $30 Top-Up", price: 30, credits: 100 },
];

const PRO_PRODUCTS = [];
for (let pods = 10; pods <= 120; pods += 5) {
  const rate = getProTier(pods);
  const monthly = Math.round(pods * rate * 100) / 100;
  PRO_PRODUCTS.push({ pods, rate, monthly });
}
PRO_PRODUCTS.unshift({ pods: 6, rate: 0.17, monthly: 1.02 });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function createProduct(body) {
  const res = await fetch(`${WHOP_API_BASE}/products`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const results = { paygo: [], pro: [] };

  console.log("\n=== Creating PayGo Products (one-time) ===\n");

  for (const p of PAYGO_PRODUCTS) {
    try {
      const product = await createProduct({
        company_id: COMPANY_ID,
        title: p.title,
        plan_options: {
          plan_type: "one_time",
          initial_price: p.price,
          release_method: "buy_now",
          visibility: "visible",
          base_currency: "usd",
        },
      });
      const id = product.id;
      results.paygo.push({ credits: p.credits, price: p.price, id });
      console.log(`  ✅ $${p.price} — ${p.credits} credits → ${id}`);
    } catch (err) {
      console.error(`  ❌ $${p.price} — ${p.credits} credits → ${err.message}`);
    }
    await sleep(500);
  }

  console.log("\n=== Creating Pro Products (subscription, 30-day) ===\n");

  for (const p of PRO_PRODUCTS) {
    try {
      const product = await createProduct({
        company_id: COMPANY_ID,
        title: `Tranzkript Pro - ${p.pods} Pods`,
        plan_options: {
          plan_type: "renewal",
          renewal_price: p.monthly,
          billing_period: 30,
          release_method: "buy_now",
          visibility: "visible",
          base_currency: "usd",
        },
      });
      const id = product.id;
      results.pro.push({ pods: p.pods, price: p.monthly, id });
      console.log(`  ✅ ${p.pods} pods @ $${p.rate}/pod = $${p.monthly}/mo → ${id}`);
    } catch (err) {
      console.error(`  ❌ ${p.pods} pods → ${err.message}`);
    }
    await sleep(500);
  }

  /* ------------------------------------------------------------------ */
  /* Print env var snippet                                               */
  /* ------------------------------------------------------------------ */
  console.log("\n\n==============================================");
  console.log("Copy these into your .env file:");
  console.log("==============================================\n");

  for (const r of results.paygo) {
    console.log(`WHOP_PRODUCT_PAYGO_${r.credits}="${r.id}"`);
  }
  console.log();
  for (const r of results.pro) {
    console.log(`WHOP_PRODUCT_PRO_${r.pods}="${r.id}"`);
  }

  console.log("\n==============================================");
  console.log(`Created: ${results.paygo.length} PayGo + ${results.pro.length} Pro products`);
  console.log("==============================================\n");
}

main().catch(console.error);