import type { Metadata } from "next"
import { Bricolage_Grotesque, Fragment_Mono, Plus_Jakarta_Sans } from "next/font/google"
import "./globals.css"

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-editor-sans",
  subsets: ["latin"],
})

// Use as our "display" font (wired to the existing serif variable for convenience).
const bricolage = Bricolage_Grotesque({
  variable: "--font-editor-serif",
  subsets: ["latin"],
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
        className={`${plusJakarta.variable} ${bricolage.variable} ${fragmentMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
