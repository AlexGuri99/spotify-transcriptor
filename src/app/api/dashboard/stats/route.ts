import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getUsageStats } from "@/lib/usage-tracker";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await getUsageStats(session.user.email);
  const plan = stats.planLimit === 15 ? "free" : stats.planLimit === 999 ? "pro" : "credits";

  return NextResponse.json({
    ...stats,
    plan,
  });
}