"use client";

import { Newsreader, Inter } from "next/font/google";
import { Videotape, Check, Sparkles, Zap, Infinity } from "lucide-react";
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

const plans = [
  {
    name: "Free",
    subtitle: "Hobby",
    price: "$0",
    period: "forever",
    icon: Sparkles,
    description: "For occasional listeners who just need a quick transcript now and then.",
    features: [
      "3 transcriptions per month",
      "Standard processing speed",
      "Basic ad filtering",
      "TXT export",
    ],
    cta: "Get started",
    action: "try",
    highlighted: false,
  },
  {
    name: "Credits",
    subtitle: "Pay-As-You-Go",
    price: "From $0.10",
    period: "per transcription",
    icon: Zap,
    description: "For users who transcribe sporadically and don't want a monthly commitment.",
    features: [
      "Buy credits in packs of 100 ($10) or 250 ($20)",
      "Credits never expire",
      "Full ad filtering included",
      "Priority processing",
      "TXT export",
    ],
    cta: "Buy credits",
    action: "signin",
    highlighted: true,
  },
  {
    name: "Pro",
    subtitle: "Monthly Subscription",
    price: "$9.99",
    period: "per month",
    icon: Infinity,
    description: "For power users, researchers, and podcast enthusiasts who transcribe regularly.",
    features: [
      "100 transcriptions per month",
      "Priority processing queue",
      "Advanced ad filtering",
      "TXT export",
      "Early access to new features",
    ],
    cta: "Subscribe",
    action: "signin",
    highlighted: false,
  },
];

export default function PricingPage() {
  const { data: session } = useSession();

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
            <Link href="/pricing" className="text-black">Pricing</Link>
            <span className="cursor-not-allowed opacity-40">Docs</span>
            {session?.user ? (
              <Link href="/dashboard" className="font-sans text-sm font-medium hover:text-black transition-colors">Dashboard</Link>
            ) : (
              <button onClick={() => signIn("google")} className="font-sans text-sm font-medium hover:text-black transition-colors cursor-pointer bg-transparent border-none">Log In</button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-8 py-20">
        <div className="text-center mb-16">
          <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black ${editorialSerif.className}`}>
            Simple, transparent pricing
          </h1>
          <p className="font-sans text-lg text-gray-500 mt-4 max-w-2xl mx-auto leading-relaxed">
            Pick the plan that fits how often you transcribe. No hidden fees, no surprises.
          </p>
        </div>

        {/* Cost breakdown callout */}
        <div className="max-w-2xl mx-auto mb-16 text-center">
          <div className="inline-block rounded-2xl border border-gray-100 bg-gray-50/50 px-6 py-4">
            <p className="font-sans text-sm text-gray-500 leading-relaxed">
              <span className="font-medium text-gray-700">How pricing works: </span>
              A typical podcast episode (45 min) costs us ~$0.03 in AI processing.
              We price plans to be fair — you pay for convenience and volume, not markup.
            </p>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.01)] flex flex-col ${
                plan.highlighted
                  ? "border-black ring-1 ring-black scale-[1.02]"
                  : "border-gray-200 hover:border-gray-300"
              } transition-all`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-xl bg-black/5 p-2.5">
                  <plan.icon className="h-5 w-5 text-black" />
                </div>
                <div>
                  <h2 className="font-sans text-lg font-bold text-black">{plan.name}</h2>
                  <p className="font-sans text-xs font-medium text-gray-400">{plan.subtitle}</p>
                </div>
              </div>

              <div className="mb-4">
                <span className="font-sans text-3xl font-bold text-black">{plan.price}</span>
                <span className="font-sans text-sm text-gray-400 ml-1">{plan.period}</span>
              </div>

              <p className="font-sans text-sm text-gray-500 mb-6 leading-relaxed">{plan.description}</p>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="h-4 w-4 text-black mt-0.5 shrink-0" />
                    <span className="font-sans text-sm text-gray-600">{feature}</span>
                  </li>
                ))}
              </ul>

              {plan.action === "try" ? (
                <Link
                  href="/"
                  className="font-sans block text-center rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 hover:border-black hover:text-black transition-all"
                >
                  {plan.cta}
                </Link>
              ) : (
                <button
                  onClick={() => session?.user ? undefined : signIn("google")}
                  className={`font-sans block w-full text-center rounded-xl px-6 py-3 text-sm font-medium transition-all ${
                    plan.highlighted
                      ? "bg-black text-white hover:bg-gray-900 shadow-sm"
                      : "border border-gray-200 text-gray-700 hover:border-black hover:text-black"
                  }`}
                >
                  {plan.cta}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* FAQ-style note */}
        <div className="max-w-2xl mx-auto mt-16 text-center">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)]">
            <p className="font-sans text-sm text-gray-500 leading-relaxed">
              All plans include access to the same transcription engine. The difference is volume,
              processing speed, and ad filtering. <span className="text-gray-300">Payments are not
              live yet — pricing is a forward look at what we plan to offer.</span>
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