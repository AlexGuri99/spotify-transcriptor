import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const isWww = host.startsWith("www.");
  const isLocalhost = host.includes("localhost") || host.includes("127.0.0.1");
  const isRailwayApp = host.includes("railway.app");

  // Only redirect the bare domain (tranzkript.com -> www.tranzkript.com)
  if (!isWww && !isLocalhost && !isRailwayApp) {
    const url = new URL(req.url);
    url.host = `www.${host}`;
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images (public images)
     */
    "/((?!_next/static|_next/image|favicon.ico|images).*)",
  ],
};