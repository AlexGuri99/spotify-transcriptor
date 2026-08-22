import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { generateApiKey, maskKey } from "@/lib/api-keys";
import { getApiKeys, addApiKey } from "@/lib/usage-tracker";

export async function POST(req: NextRequest): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const name = body.name?.trim() || "Default";
  const { plaintext, entry } = generateApiKey(name);
  await addApiKey(session.user.email, entry);

  return NextResponse.json({
    key: plaintext,
    key_id: entry.keyId,
    name: entry.name,
    masked: maskKey(plaintext),
    created_at: entry.createdAt,
  }, { status: 201 });
}

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const keys = await getApiKeys(session.user.email);

  return NextResponse.json({
    api_keys: keys.map((k) => ({
      key_id: k.keyId,
      name: k.name,
      created_at: k.createdAt,
      last_used_at: k.lastUsedAt,
    })),
  });
}