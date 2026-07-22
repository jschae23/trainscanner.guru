import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { ThemeProvider } from 'next-themes'
import './globals.css'

const siteUrl = 'https://trainscanner.site'

export const metadata: Metadata = {
  title: {
    default: 'trainscanner.site – günstige Bahn Sparpreise auf einen Blick',
    template: '%s | trainscanner.site',
  },
  description:
    'Mit dem trainscanner.site die günstigsten Sparpreise der Deutschen Bahn über einen Zeitraum auf einen Blick finden. Bahnreisen einfach vergleichen und sparen.',
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: siteUrl,
  },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    siteName: 'trainscanner.site',
    title: 'trainscanner.site – günstige Bahn Sparpreise auf einen Blick',
    description:
      'Mit dem trainscanner.site die günstigsten Sparpreise der Deutschen Bahn über einen Zeitraum auf einen Blick finden.',
    url: siteUrl,
    images: [
      {
        url: '/apple-icon.png',
        width: 180,
        height: 180,
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'trainscanner.site – günstige Bahn Sparpreise auf einen Blick',
    description:
      'Mit dem trainscanner.site die günstigsten Sparpreise der Deutschen Bahn über einen Zeitraum auf einen Blick finden.',
  },
  icons: {
    icon: '/favicon-32x32.png',
    apple: '/apple-icon.png',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  themeColor: '#1E283A',
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'trainscanner.site',
  url: siteUrl,
  description:
    'Mit dem trainscanner.site die günstigsten Sparpreise der Deutschen Bahn über einen Zeitraum auf einen Blick finden.',
  inLanguage: 'de',
  applicationCategory: 'TravelApplication',
  operatingSystem: 'Any',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'EUR',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const jsonLdHtml = JSON.stringify(jsonLd)

  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
        />
        <style>{`
html {
  font-family: ${GeistSans.style.fontFamily};
  --font-sans: ${GeistSans.variable};
  --font-mono: ${GeistMono.variable};
}
        `}</style>
        <title>trainscanner.site</title>
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
