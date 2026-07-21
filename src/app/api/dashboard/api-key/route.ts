import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getApiKeys, createApiKey, deleteApiKey } from "@/lib/usage-tracker";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = getApiKeys(session.user.email);
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const label: string = body.label || "My API Key";

  const key = createApiKey(session.user.email, label);
  return NextResponse.json({ key });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const keyToDelete: string = body.key;
  if (!keyToDelete) {
    return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
  }

  deleteApiKey(session.user.email, keyToDelete);
  return NextResponse.json({ success: true });
}