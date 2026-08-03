import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Instant podcast transcripts, timestamped navigation, AI ad-free filtering, and one-click text export. See everything Tranzkript can do for your workflow.",
  openGraph: {
    title: "Features — Tranzkript",
    description:
      "Instant podcast transcripts, timestamped navigation, AI ad-free filtering, and one-click text export.",
  },
};

export default function FeaturesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}