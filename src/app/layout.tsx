import type { Metadata, Viewport } from "next";
import { Archivo, Noto_Sans_JP } from "next/font/google";

import { ServiceWorker } from "@/components/ServiceWorker";

import "./globals.css";

/**
 * Archivo carries the whole Modernist system — headings, chips, tab labels, all
 * at weight 800. Noto Sans JP is used only for Japanese text.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Oshi Inbox",
  description:
    "One inbox for every group — Japanese, romaji and English, aligned line for line.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Oshi Inbox",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/192",
    apple: "/icons/192",
  },
};

export const viewport: Viewport = {
  themeColor: "#f3f2f2",
  width: "device-width",
  initialScale: 1,
  // The app is a fixed-height shell; letting it zoom breaks the frame layout.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${notoSansJp.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
