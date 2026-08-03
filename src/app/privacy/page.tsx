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

export default function PrivacyPage() {
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
        <h1 className={`text-4xl md:text-5xl font-bold italic tracking-tight leading-[1.1] text-black mb-6 ${editorialSerif.className} font-editorial`}>
          Privacy Policy
        </h1>
        <p className="font-[family-name:var(--font-barlow-condensed)] text-base text-gray-400 mb-8">Last updated: July 27, 2026</p>

        <div className="font-[family-name:var(--font-barlow-condensed)] text-sm text-gray-600 space-y-6 leading-relaxed">
          <section>
            <h2 className="font-bold text-black text-lg mb-2">1. Information We Collect</h2>
            <p className="mb-2">We collect the following information:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information</strong> — email address and hashed password if you register with email, or your name and email address if you sign in with Google.</li>
              <li><strong>Transcription data</strong> — the podcast episode URLs you submit and the resulting transcripts.</li>
              <li><strong>Usage data</strong> — transcription history, credit usage, and account activity.</li>
              <li><strong>Session data</strong> — an essential session cookie to keep you logged in (NextAuth).</li>
            </ul>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">2. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Provide and maintain the transcription Service</li>
              <li>Track usage limits and manage your account</li>
              <li>Improve transcription accuracy and performance</li>
              <li>Communicate with you about service updates or issues</li>
              <li>Prevent abuse and enforce our Terms of Service</li>
            </ul>
            <p className="mt-3"><strong>Legal basis (GDPR):</strong> We process your data under the legal bases of contract necessity (to deliver the Service you requested) and legitimate interests (to maintain security and improve the Service). We do not rely on consent as a legal basis for processing.</p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">3. Data Storage &amp; Retention</h2>
            <p>
              Your data is stored securely using third-party infrastructure (Teable database). We retain:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information</strong> — until you delete your account or request erasure</li>
              <li><strong>Transcription history</strong> — until you delete your account or request erasure</li>
              <li><strong>Usage logs</strong> — up to 12 months</li>
            </ul>
            <p className="mt-2">
              You may request deletion of your data at any time by contacting us. Deletion requests are fulfilled within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">4. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share data with third-party service providers who help us operate the Service:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Teable</strong> — database hosting for account and transcription data</li>
              <li><strong>OpenRouter</strong> — AI processing for transcription generation</li>
              <li><strong>Lemon Squeezy / Whop</strong> — payment processing (no credit card data is stored by us)</li>
            </ul>
            <p className="mt-2">
              These providers are bound by data processing agreements and may not use your data for their own purposes.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">5. Third-Party Authentication</h2>
            <p>
              If you choose to sign in with Google, Google shares your name and email address with us according to their own privacy policy. We do not receive or store your OAuth provider passwords.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">6. International Data Transfers</h2>
            <p>
              We use service providers (Teable, OpenRouter) that may process data outside your country of residence. When transferring data from the European Economic Area (EEA) to countries not deemed adequate by the European Commission, we rely on Standard Contractual Clauses or equivalent safeguards to ensure your data receives equivalent protection.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">7. Your Rights</h2>
            <p className="mb-2">
              Depending on your jurisdiction, you may have the following rights:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
              <li><strong>Correction</strong> — request that we correct inaccurate or incomplete data</li>
              <li><strong>Deletion</strong> — request that we delete your personal data (subject to legal obligations)</li>
              <li><strong>Data portability</strong> — request an export of your data in a machine-readable format (JSON)</li>
              <li><strong>Withdraw consent</strong> — if processing is based on consent, you may withdraw it at any time</li>
              <li><strong>Lodge a complaint</strong> — you may file a complaint with your local data protection authority (e.g., the ICO in the UK, CNIL in France, or your local equivalent)</li>
            </ul>
            <p className="mt-2">
              <strong>CCPA (California residents):</strong> You have the right to know what personal information is collected, request deletion, and opt out of the sale of personal information. Tranzkript does not sell your personal information. You will not be discriminated against for exercising your CCPA rights.
            </p>
            <p className="mt-2">
              To exercise any of these rights, contact us at <a href="mailto:support@tranzkript.com" className="underline hover:text-black transition-colors">support@tranzkript.com</a>.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">8. Cookies</h2>
            <p>
              We use only essential cookies required for authentication (NextAuth session cookies). No tracking cookies, analytics cookies, or third-party advertising cookies are used. Since we use only essential cookies, no cookie consent banner is required under GDPR.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">9. Contact</h2>
            <p>
              For privacy-related inquiries, contact us at <a href="mailto:support@tranzkript.com" className="underline hover:text-black transition-colors">support@tranzkript.com</a>.
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}