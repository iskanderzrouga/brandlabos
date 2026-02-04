import type { Metadata } from "next"
import { Fragment_Mono, Instrument_Serif, Spline_Sans } from "next/font/google"
import "./globals.css"

const splineSans = Spline_Sans({
  variable: "--font-editor-sans",
  subsets: ["latin"],
})

const instrumentSerif = Instrument_Serif({
  variable: "--font-editor-serif",
  subsets: ["latin"],
  weight: "400",
})

const fragmentMono = Fragment_Mono({
  variable: "--font-editor-mono",
  subsets: ["latin"],
  weight: "400",
})

export const metadata: Metadata = {
  title: "BrandLab Studio",
  description: "Copy studio for fast, high-signal creative work.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${splineSans.variable} ${instrumentSerif.variable} ${fragmentMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
