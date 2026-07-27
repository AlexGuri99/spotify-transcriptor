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
          Privacy Policy
        </h1>
        <p className="font-[family-name:var(--font-barlow-condensed)] text-base text-gray-400 mb-8">Last updated: July 27, 2026</p>

        <div className="font-[family-name:var(--font-barlow-condensed)] text-sm text-gray-600 space-y-6 leading-relaxed">
          <section>
            <h2 className="font-bold text-black text-lg mb-2">1. Information We Collect</h2>
            <p>
              We collect the following information when you use Tranzkript:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Account information:</strong> Email address and password (if you sign up with email/password) or OAuth provider ID (if you sign in with Google or GitHub).</li>
              <li><strong>Usage data:</strong> Podcast episode URLs you submit for transcription, transcription history, and usage statistics.</li>
              <li><strong>Technical data:</strong> IP address, browser type, and basic analytics to operate and improve the Service.</li>
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
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">3. Data Storage</h2>
            <p>
              Your data is stored securely using third-party infrastructure (Teable database). We retain your transcription history and account information for as long as your account is active. You may request deletion of your data at any time by contacting us.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">4. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share data with third-party service providers who help us operate the Service (e.g., Teable for database hosting, OpenRouter for transcription processing). These providers are bound by data processing agreements and may not use your data for their own purposes.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">5. Third-Party Authentication</h2>
            <p>
              If you choose to sign in with Google or GitHub, those providers share your email address with us according to their own privacy policies. We do not receive or store your OAuth provider passwords.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">6. Your Rights</h2>
            <p>
              Depending on your jurisdiction, you may have the right to access, correct, delete, or export your personal data. To exercise these rights, contact us at alexgurinovich@gmail.com.
            </p>
          </section>

          <section>
            <h2 className="font-bold text-black text-lg mb-2">7. Cookies</h2>
            <p>
              We use essential cookies for authentication (NextAuth session cookies). No tracking cookies or third-party analytics cookies are used at this time.
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
              For privacy-related inquiries, contact us at alexgurinovich@gmail.com.
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </div>
  );
}