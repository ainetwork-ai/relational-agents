import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// NB: no global `title` — /p/[pageId] owns its <title> via a React 19 title
// element that live-updates while typing; a layout-level metadata title would
// sit first in <head> and win over it.
export const metadata: Metadata = {
  description: "Think it. Write it. All in one place.",
};

// Runs before paint so a saved dark preference never flashes light (FOUC).
const themeScript = `(function(){try{var m=localStorage.getItem("app-theme");var dark=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark")}catch(e){}})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // the cookie is a copy of users.language (set by PATCH /api/auth/me), so the
  // first paint already carries the right lang without a DB read here
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {/* screens outside (app) — login, share, not-found — get the cookie/
            Accept-Language locale; (app)/layout re-provides from users.language */}
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
