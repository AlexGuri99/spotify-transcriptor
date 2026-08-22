import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { removeApiKey } from "@/lib/usage-tracker";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ prefix: string }> }
): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { prefix } = await params;

  if (!prefix || !/^[a-f0-9]+$/.test(prefix)) {
    return NextResponse.json({ error: "Invalid key ID." }, { status: 400 });
  }

  await removeApiKey(session.user.email, prefix);

  return NextResponse.json({ success: true });
}