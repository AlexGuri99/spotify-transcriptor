"use client";

import { Newsreader, Inter } from "next/font/google";
import { Videotape } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import SignInModal from "@/components/sign-in-modal";
import SiteFooter from "@/components/site-footer";

const editorialSerif = Newsreader({
  subsets: ["latin"],
  variable: "--font-editorial",
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const transcriptSans = Inter({
  subsets: ["latin"],
  variable: "--font-transcript-sans",
});

export default function RefundPage() {
  const { data: session } = useSession();
  const [showSignIn, setShowSignIn] = useState(false);

  return (
    <div className={`${editorialSerif.variable} ${transcriptSans.variable} font-serif min-h-screen bg-[#FDFDFD] text-[#111111] antialiased flex flex-col`}>
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md px-8 py-5 sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Videotape className="h-9 w-9 text-black stroke-[1.5]" />
            <span className="font-sans text-2xl font-bold tracking-tight text-black">
              Tranzkript
            </span>
          </Link>
          <nav className="font-sans text-sm font-medium text-gray-500 flex items-center gap-8">
            <Link href="/features" className="hover:text-black transition-colors">Features</Link>
            <Link href="/pricing" className="hover:text-black transition-colors">Pricing</Link>
            {session?.user ? (
              <Link href="/dashboard" className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors">Dashboard</Link>
            ) : (
              <button onClick={() => setShowSignIn(true)} className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors cursor-pointer bg-black border-none">Log In</button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-16">
        <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black mb-8 ${editorialSerif.className} font-editorial`}>
          Refund Policy
        </h1>
        <div className="font-sans space-y-6 text-gray-600 leading-relaxed">
          <p>
            For subscriptions, we allow refunds within 7 days of your initial purchase. Please contact us at{" "}
            <a href="mailto:support@tranzkript.com" className="text-black underline underline-offset-2 hover:text-gray-600 transition-colors">support@tranzkript.com</a>{" "}
            for any refund requests.
          </p>
          <p>
            Refunds are processed through Lemon Squeezy and will be returned to your original payment method. If you have any questions or concerns, don&apos;t hesitate to reach out.
          </p>
        </div>
      </main>

      <SiteFooter />
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}