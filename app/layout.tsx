import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Spectral } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/** Titles, song names, stat figures and the wordmark. */
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
  display: "swap",
});

/** Every number and every uppercase micro-label, plus the body default. */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fretly",
  description: "Practice guitar with synced tabs and real-time feedback.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The score is the point of the app, so pinch-zoom stays available.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EA" },
    { media: "(prefers-color-scheme: dark)", color: "#131417" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spectral.variable} ${plexMono.variable}`}>
      <head>
        {/* Resolves the theme class before first paint so the app never
            flashes Paper on its way to Lamp. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
