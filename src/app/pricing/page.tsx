"use client";

import { useState } from "react";
import { Newsreader, Inter } from "next/font/google";
import { Videotape, Check, Sparkles, Zap, Sliders } from "lucide-react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";

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

function getProTier(pods: number): { pricePerPod: number; label: string } {
  if (pods <= 30) return { pricePerPod: 0.15, label: "$0.15 / pod" };
  if (pods <= 70) return { pricePerPod: 0.12, label: "$0.12 / pod" };
  return { pricePerPod: 0.09, label: "$0.09 / pod" };
}

export default function PricingPage() {
  const { data: session } = useSession();
  const [proPods, setProPods] = useState(30);
  const tier = getProTier(proPods);
  const proTotal = (proPods * tier.pricePerPod).toFixed(2);

  /* Snap slider to available step values */
  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    let snapped: number;
    if (raw <= 30) {
      snapped = Math.round(raw / 5) * 5;
      if (snapped < 15) snapped = 15;
    } else if (raw <= 70) {
      snapped = Math.round(raw / 5) * 5;
      if (snapped < 35) snapped = 35;
    } else {
      snapped = Math.round(raw / 5) * 5;
      if (snapped < 75) snapped = 75;
    }
    setProPods(snapped);
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
            <span className="cursor-not-allowed opacity-40">Docs</span>
            {session?.user ? (
              <Link href="/dashboard" className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors">Dashboard</Link>
            ) : (
              <button onClick={() => signIn("google")} className="font-sans text-sm font-medium text-white bg-black rounded-full px-4 py-1.5 hover:bg-gray-900 transition-colors cursor-pointer bg-black border-none">Log In</button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-20">
        <div className="text-center mb-16">
          <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className} font-editorial`}>
            Simple, transparent pricing
          </h1>
          <p className="font-sans text-lg text-gray-500 mt-4 max-w-2xl mx-auto leading-relaxed">
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
              For occasional listeners who just need a quick transcript now and then.
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">10 pods per month</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Standard processing speed</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Basic ad filtering</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">TXT export</span>
              </li>
            </ul>

            <Link
              href="/"
              className="font-sans block text-center rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
            >
              Get started
            </Link>
          </div>

          {/* Credits — Pay-As-You-Go */}
          <div className="rounded-2xl border border-black bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col ring-1 ring-black scale-[1.02] transition-all">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-xl bg-black/5 p-2.5">
                <Zap className="h-5 w-5 text-black" />
              </div>
              <div>
                <h2 className="font-sans text-lg font-bold text-black">Credits</h2>
                <p className="font-sans text-xs font-medium text-gray-400">Pay-As-You-Go</p>
              </div>
            </div>

            <div className="mb-4">
              <span className="font-sans text-3xl font-bold text-black">$0.20</span>
              <span className="font-sans text-sm text-gray-400 ml-1">per pod</span>
            </div>

            <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
              For users who transcribe sporadically and don&apos;t want a monthly commitment.
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Buy credits in packs of 10 ($2) or 50 ($10)</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Credits never expire</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Full ad filtering included</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Priority processing</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">TXT export</span>
              </li>
            </ul>

            <button
              onClick={() => session?.user ? undefined : signIn("google")}
              className="font-sans block w-full text-center rounded-xl bg-black px-6 py-3 text-sm font-medium text-white hover:bg-gray-900 transition-all shadow-sm"
            >
              Buy credits
            </button>
          </div>

          {/* Pro — Monthly Subscription with slider */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col hover:border-gray-300 transition-all">
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
                min="15"
                max="150"
                step="5"
                value={proPods}
                onChange={handleSliderChange}
                className="w-full accent-black h-2 rounded-full appearance-none cursor-pointer bg-gray-200 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black [&::-webkit-slider-thumb]:shadow-md"
              />
              <div className="flex justify-between mt-2">
                <span className="font-sans text-[11px] text-gray-400">15 pods</span>
                <span className="font-sans text-[11px] text-gray-400">150+ pods</span>
              </div>
            </div>

            {/* Tier indicators */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              <div className={`rounded-lg border px-3 py-2 text-center ${proPods >= 15 && proPods <= 30 ? "border-black bg-black/5" : "border-gray-100"}`}>
                <p className="font-sans text-xs font-semibold text-black">15–30</p>
                <p className="font-sans text-[11px] text-gray-500">$0.15/pod</p>
              </div>
              <div className={`rounded-lg border px-3 py-2 text-center ${proPods >= 35 && proPods <= 70 ? "border-black bg-black/5" : "border-gray-100"}`}>
                <p className="font-sans text-xs font-semibold text-black">35–70</p>
                <p className="font-sans text-[11px] text-gray-500">$0.12/pod</p>
              </div>
              <div className={`rounded-lg border px-3 py-2 text-center ${proPods >= 75 ? "border-black bg-black/5" : "border-gray-100"}`}>
                <p className="font-sans text-xs font-semibold text-black">75–150+</p>
                <p className="font-sans text-[11px] text-gray-500">$0.09/pod</p>
              </div>
            </div>

            <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">
              For power users, researchers, and teams who transcribe at scale.
            </p>

            <ul className="space-y-3 mb-8 flex-1">
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">{proPods} pods per month</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Priority processing queue</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Advanced ad filtering</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">TXT export</span>
              </li>
              <li className="flex items-start gap-3">
                <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                <span className="font-sans text-sm text-gray-600">Early access to new features</span>
              </li>
            </ul>

            <button
              onClick={() => session?.user ? undefined : signIn("google")}
              className="font-sans block w-full text-center rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
            >
              Subscribe
            </button>
          </div>
        </div>

        {/* FAQ-style note */}
        <div className="max-w-2xl mx-auto mt-16 text-center">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
            <p className="font-sans text-sm text-gray-500 leading-relaxed">
              A &ldquo;pod&rdquo; is one episode transcription of any length. All plans include access to the same transcription engine. <span className="text-gray-300">Payments are not live yet — pricing is a forward look at what we plan to offer.</span>
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-white px-8 py-5 text-center font-sans text-[11px] font-medium text-gray-400">
        Not affiliated with Spotify Corporation · Made by Alex Gurinovich
      </footer>
    </div>
  );
}