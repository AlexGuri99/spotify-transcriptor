import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Pay-as-you-go or subscription plans starting at $0.17/pod. Transcribe Spotify podcasts affordably with no monthly commitment. Choose the plan that fits your volume.",
  openGraph: {
    title: "Pricing — Tranzkript",
    description:
      "Pay-as-you-go or subscription plans starting at $0.17/pod. Transcribe Spotify podcasts affordably.",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}