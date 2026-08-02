"use client";

import { useState, useEffect } from "react";
import { Newsreader, Inter } from "next/font/google";
import { Videotape, Sparkles, Zap, Sliders } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
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

interface PayGoProduct {
  variantId: string;
  price: number;
  credits: number;
}

interface ProProduct {
  variantId: string;
  pods: number;
  pricePerPod: number;
  monthlyPrice: number;
}

interface ProductsData {
  paygo: PayGoProduct[];
  pro: ProProduct[];
}

function getProTier(pods: number): { pricePerPod: number; label: string } {
  if (pods <= 30) return { pricePerPod: 0.17, label: "$0.17 / pod" };
  if (pods <= 75) return { pricePerPod: 0.14, label: "$0.14 / pod" };
  return { pricePerPod: 0.11, label: "$0.11 / pod" };
}

export default function PricingPage() {
  const { data: session } = useSession();
  const [showSignIn, setShowSignIn] = useState(false);
  const [proPods, setProPods] = useState(10);
  const [products, setProducts] = useState<ProductsData | null>(null);
  const [purchaseLabel, setPurchaseLabel] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lemon/products")
      .then((r) => r.json())
      .then(setProducts)
      .catch(() => {});
  }, []);

  const tier = getProTier(proPods);
  const proTotal = (proPods * tier.pricePerPod).toFixed(2);

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    let snapped = Math.round(raw / 5) * 5;
    if (snapped < 6) snapped = 6;
    setProPods(snapped);
  }

  async function handlePurchase(variantId: string, label: string) {
    if (!session?.user?.email) {
      setShowSignIn(true);
      return;
    }
    setPurchaseLabel(label);
    try {
      const res = await fetch("/api/lemon/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, email: session.user.email }),
      });
      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("Checkout error:", err);
    }
    setTimeout(() => setPurchaseLabel(null), 3000);
  }

  function handleSignedIn() {
    setShowSignIn(false);
  }

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
            <Link href="/pricing" className="text-black">Pricing</Link>
            {session?.user ? (
              <Link href="/dashboard" className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors">Dashboard</Link>
            ) : (
              <button onClick={() => setShowSignIn(true)} className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors cursor-pointer bg-black border-none">Log In</button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-20">
        <div className="text-center mb-16">
          <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className} font-editorial`}>
            Simple, transparent pricing
          </h1>
          <p className="font-[family-name:var(--font-barlow-condensed)] text-lg text-gray-500 mt-4 max-w-2xl mx-auto leading-relaxed">
            Pick the plan that fits how often you transcribe. No hidden fees, no surprises.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Free — Hobby */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col hover:border-gray-300 transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-black/5 p-2.5">
                <Sparkles className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="font-sans text-lg font-bold text-black">Free</h2>
                <p className="font-sans text-xs font-medium text-gray-400">Hobby</p>
              </div>
            </div>

            <div className="mb-4">
              <span className="font-sans text-3xl font-bold text-black">$0</span>
              <span className="font-sans text-sm text-gray-400 ml-1">forever</span>
            </div>

            <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
              5 free transcriptions every month. No daily limit, no credit card needed.
            </p>

            <Link
              href="/"
              className="font-sans block text-center rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all mt-auto"
            >
              Get started
            </Link>
          </div>

          {/* PayGo — Pay-As-You-Go */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col opacity-50 select-none relative">
            <div className="absolute top-3 right-3 font-sans text-[10px] font-semibold uppercase tracking-wider text-gray-400 border border-gray-200 rounded-full px-2.5 py-0.5">
              Coming Soon
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-black/5 p-2.5">
                <Zap className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="font-sans text-lg font-bold text-black">PayGo</h2>
                <p className="font-sans text-xs font-medium text-gray-400">Pay-As-You-Go</p>
              </div>
            </div>

            <div className="mb-4">
              <span className="font-sans text-3xl font-bold text-black">$0.30</span>
              <span className="font-sans text-sm text-gray-400 ml-1">per pod</span>
            </div>

            <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
              For users who transcribe sporadically and don&apos;t want a monthly commitment.
            </p>

            {/* PayGo tier options */}
            <div className="space-y-2 mb-6">
              {products?.paygo.map((p) => (
                <div key={p.credits} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
                  <div>
                    <span className="font-sans text-sm font-semibold text-black">${p.price}</span>
                    <span className="font-sans text-xs text-gray-400 ml-1">({p.credits} pods)</span>
                  </div>
                  <button
                    disabled
                    className="font-sans rounded-lg bg-gray-300 px-4 py-1.5 text-xs font-medium text-white cursor-not-allowed"
                  >
                    Coming Soon
                  </button>
                </div>
              ))}
              {!products && (
                <div className="flex items-center justify-center py-4">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
                </div>
              )}
            </div>

            <p className="font-sans text-xs text-gray-400 mt-auto text-center">
              One-time purchase. Credits never expire.
            </p>
          </div>

          {/* Pro — Monthly Subscription */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col opacity-50 select-none relative">
            <div className="absolute top-3 right-3 font-sans text-[10px] font-semibold uppercase tracking-wider text-gray-400 border border-gray-200 rounded-full px-2.5 py-0.5">
              Coming Soon
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-black/5 p-2.5">
                <Sliders className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="font-sans text-lg font-bold text-black">Pro</h2>
                <p className="font-sans text-xs font-medium text-gray-400">Monthly Subscription</p>
              </div>
            </div>

            <div className="mb-4">
              <span className="font-sans text-3xl font-bold text-black">${proTotal}</span>
              <span className="font-sans text-sm text-gray-400 ml-1">/ month</span>
            </div>

            <div className="font-sans mb-6">
              <span className="text-sm font-medium text-gray-700">{proPods} pods</span>
              <span className="text-sm text-gray-400 mx-1">at</span>
              <span className="text-sm font-semibold text-black">{tier.label}</span>
            </div>

            {/* Slider */}
            <div className="mb-6">
              <input
                type="range"
                min="6"
                max="120"
                step="5"
                value={proPods}
                onChange={handleSliderChange}
                className="w-full accent-black h-2 rounded-full appearance-none cursor-pointer bg-gray-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black [&::-webkit-slider-thumb]:shadow-md pointer-events-none"
              />
              <div className="flex justify-between mt-2">
                <span className="font-sans text-[11px] text-gray-400">6 pods</span>
                <span className="font-sans text-[11px] text-gray-400">120+ pods</span>
              </div>
            </div>

            {/* Tier indicators */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              <div className="rounded-lg border border-gray-100 px-3 py-2 text-center">
                <p className="font-sans text-xs font-semibold text-black">6–30</p>
                <p className="font-sans text-[11px] text-gray-500">$0.17/pod</p>
              </div>
              <div className="rounded-lg border border-gray-100 px-3 py-2 text-center">
                <p className="font-sans text-xs font-semibold text-black">35–75</p>
                <p className="font-sans text-[11px] text-gray-500">$0.14/pod</p>
              </div>
              <div className="rounded-lg border border-gray-100 px-3 py-2 text-center">
                <p className="font-sans text-xs font-semibold text-black">80–120+</p>
                <p className="font-sans text-[11px] text-gray-500">$0.11/pod</p>
              </div>
            </div>

            <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
              For power users, researchers, and teams who transcribe at scale.
            </p>

            {/* Subscribe button */}
            <div className="mt-auto">
              <button
                disabled
                className="font-sans w-full rounded-xl bg-gray-300 px-6 py-3 text-sm font-medium text-white cursor-not-allowed"
              >
                Coming Soon
              </button>
            </div>
          </div>
        </div>

        {/* FAQ-style note */}
        <div className="max-w-2xl mx-auto mt-16 text-center">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
            <p className="font-sans text-sm text-gray-500 leading-relaxed">
              A &ldquo;pod&rdquo; is one episode transcription of any length. All plans include access to the same transcription engine. Payments are processed securely by Lemon Squeezy.
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />

      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} onSignedIn={() => setShowSignIn(false)} />
    </div>
  );
}