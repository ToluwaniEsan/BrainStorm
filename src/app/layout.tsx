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

export const metadata: Metadata = {
  title: "Clutter",
  description: "A space to organize and develop your ideas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="lava-lamp" aria-hidden="true">
          <span className="lava-lamp__ball lava-lamp__ball--one" />
          <span className="lava-lamp__ball lava-lamp__ball--two" />
          <span className="lava-lamp__ball lava-lamp__ball--three" />
          <span className="lava-lamp__ball lava-lamp__ball--four" />
          <span className="lava-lamp__ball lava-lamp__ball--five" />
        </div>
        {children}
      </body>
    </html>
  );
}
