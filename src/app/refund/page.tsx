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
            <Link href="/features" className="hover:text-black transition-colors">Product</Link>
            <Link href="/pricing" className="hover:text-black transition-colors">Pricing</Link>
            <span className="cursor-not-allowed opacity-40">Docs</span>
            {session?.user ? (
              <Link href="/dashboard" className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors">Dashboard</Link>
            ) : (
              <button onClick={() => setShowSignIn(true)} className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors cursor-pointer bg-black border-none">Log In</button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-16">
        <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black mb-6 ${editorialSerif.className} font-editorial`}>
          Refund Policy
        </h1>
        <p className="font-[family-name:var(--font-barlow-condensed)] text-base text-gray-400 mb-8">Last updated: July 27, 2026</p>

        <div className="font-[family-name:var(--font-barlow-condensed)] text-sm text-gray-600 space-y-6 leading-relaxed">
          <section>
            <h2 className="font-bold text-black text-lg mb-2">1. Credit Purchases</h2>
            <p>
              Credit packs purchased through Tranzkript are non-refundable, except as required by applicable law. Due to the digital nature of the service, once credits have been added to your account, they cannot be returned or exchanged for cash.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">2. Subscription Plans (Pro)</h2>
            <p>
              Pro subscription fees are billed monthly in advance. If you cancel your subscription, you will retain access to Pro features for the remainder of the current billing period. No partial refunds will be issued for the unused portion of a billing period.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">3. Service Issues</h2>
            <p>
              If you experience a technical issue that prevents you from using the Service (e.g., a transcription fails and credits are deducted without receiving a result), please contact us at alexgurinovich@gmail.com within 7 days of the incident. We will review the issue and may, at our discretion, restore the credits or issue a refund.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">4. Refund Requests</h2>
            <p>
              To request a refund, contact us at alexgurinovich@gmail.com with your account email and a description of the issue. We aim to respond within 5 business days.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">5. Exceptions</h2>
            <p>
              Nothing in this policy restricts your statutory rights under applicable consumer protection laws. If a statutory right entitles you to a refund in a specific circumstance, that right prevails.
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}