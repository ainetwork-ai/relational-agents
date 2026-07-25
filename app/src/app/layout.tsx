import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
const themeScript = `(function(){try{var m=localStorage.getItem("notion-theme");var dark=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
