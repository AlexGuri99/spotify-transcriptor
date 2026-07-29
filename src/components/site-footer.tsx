import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-white px-8 py-5">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <p className="font-sans text-[11px] font-medium text-gray-400">
          Not affiliated with Spotify Corporation
        </p>
        <nav className="flex items-center gap-4">
          <Link
            href="/terms"
            className="font-sans text-[11px] font-medium text-gray-400 hover:text-black transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="font-sans text-[11px] font-medium text-gray-400 hover:text-black transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/refund"
            className="font-sans text-[11px] font-medium text-gray-400 hover:text-black transition-colors"
          >
            Refund Policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}