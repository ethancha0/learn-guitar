import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Learn Bass",
  description: "Practice bass guitar with synced tabs and real-time feedback.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The score is the point of the app, so pinch-zoom stays available.
  themeColor: "#0f1115",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
