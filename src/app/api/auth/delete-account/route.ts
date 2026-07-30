import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { deleteUser } from "@/lib/usage-tracker";
import { getLicensesForEmail, cancelLicense } from "@/lib/whop";

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Cancel any active Whop licenses/subscriptions first
    try {
      const licenses = await getLicensesForEmail(session.user.email);
      const activeLicenses = licenses.filter((l) => l.status === "active" || l.status === "trialing");
      for (const license of activeLicenses) {
        console.log(`[Delete Account] Cancelling Whop license ${license.id} (${license.productId})`);
        await cancelLicense(license.id);
      }
    } catch (err) {
      // Log but don't block account deletion if Whop API fails
      console.error("[Delete Account] Failed to cancel Whop licenses:", err);
    }

    const deleted = await deleteUser(session.user.email);
    if (!deleted) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete account." },
      { status: 500 }
    );
  }
}