import type { Metadata } from "next";
import { DM_Sans, Geist, Geist_Mono, Unbounded } from "next/font/google";
import "./globals.css";
import "./clutter.css";

import { Nav } from "@/components/nav";
import { ApplyPrefs } from "@/components/prefs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Interface text and the CLUTTER wordmark (see clutter.css).
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  title: "Clutter",
  description: "A space to organize and develop your ideas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${dmSans.variable} ${unbounded.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="c-backdrop" aria-hidden="true" />
        {/* Alana's lava lamp (globals.css), kept grounded by clutter.css. */}
        <div className="lava-lamp" aria-hidden="true">
          <div className="lava-lamp__float lava-lamp__float--one">
            <span className="lava-lamp__ball lava-lamp__ball--one" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--two">
            <span className="lava-lamp__ball lava-lamp__ball--two" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--three">
            <span className="lava-lamp__ball lava-lamp__ball--three" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--four">
            <span className="lava-lamp__ball lava-lamp__ball--four" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--five">
            <span className="lava-lamp__ball lava-lamp__ball--five" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--six">
            <span className="lava-lamp__ball lava-lamp__ball--six" />
          </div>
          <div className="lava-lamp__float lava-lamp__float--seven">
            <span className="lava-lamp__ball lava-lamp__ball--seven" />
          </div>
        </div>
        <Nav />
        <ApplyPrefs />
        {children}
      </body>
    </html>
  );
}
