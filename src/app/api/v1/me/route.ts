import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, ApiAuthError } from "@/lib/api-auth";
import { getUsageStats, getApiKeys } from "@/lib/usage-tracker";

export async function GET(req: NextRequest): Promise<Response> {
  let user;
  try {
    user = await authenticateRequest(req);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }

  const stats = await getUsageStats(user.email);
  const keys = await getApiKeys(user.email);

  return NextResponse.json({
    email: user.email,
    plan: user.plan,
    usage: {
      used_this_month: stats.usedThisMonth,
      plan_limit: stats.planLimit,
      remaining: stats.remaining,
      credits_remaining: stats.creditsRemaining,
    },
    api_keys: keys.map((k) => ({
      key_id: k.keyId,
      name: k.name,
      created_at: k.createdAt,
      last_used_at: k.lastUsedAt,
    })),
  });
}