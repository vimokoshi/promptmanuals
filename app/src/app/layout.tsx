import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic, Geist_Mono, Playfair_Display } from "next/font/google";
import { headers } from "next/headers";
import { getMessages, getLocale } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { CookieConsentBanner } from "@/components/layout/cookie-consent";
import { Analytics } from "@/components/layout/analytics";
import { EzoicScripts, EzoicRouteHandler } from "@/components/layout/ezoic-ads";
import { WebsiteStructuredData } from "@/components/seo/structured-data";
import { AppBanner } from "@/components/layout/app-banner";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";
import { LocaleDetector } from "@/components/providers/locale-detector";
import { getConfig } from "@/lib/config";
import { isRtlLocale } from "@/lib/i18n/config";
import { parseHexColour, contrastForeground } from "@/lib/color";
import "./globals.css";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Prompt Manuals — Free AI Prompt Library (40,000+ Prompts)",
    template: "%s | Prompt Manuals",
  },
  description:
    "The largest free AI prompt library with 40,000+ prompts in 19 languages. Discover, copy, and share prompts for ChatGPT, Claude, Gemini, and more.",
  keywords: [
    "AI prompts",
    "free AI prompts",
    "ChatGPT prompts",
    "Claude prompts",
    "prompt library",
    "prompt engineering",
    "AI tools",
    "Gemini prompts",
    "AI assistant prompts",
    "prompt templates",
  ],
  authors: [{ name: "Prompt Manuals" }],
  creator: "Prompt Manuals",
  publisher: "Prompt Manuals",
  icons: {
    icon: [
      { url: "/favicon/favicon.png", type: "image/png" },
    ],
    apple: "/favicon/apple-touch-icon.png",
    shortcut: "/favicon/favicon.png",
  },
  manifest: "/favicon/site.webmanifest",
  other: {
    "apple-mobile-web-app-title": "Prompt Manuals",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Prompt Manuals",
    title: "Prompt Manuals — Free AI Prompt Library (40,000+ Prompts)",
    description:
      "The largest free AI prompt library with 40,000+ prompts in 19 languages. Copy and use prompts for ChatGPT, Claude, Gemini, and more.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Prompt Manuals — Free AI Prompt Library",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Prompt Manuals — Free AI Prompt Library (40,000+ Prompts)",
    description:
      "The largest free AI prompt library. 40,000+ prompts in 19 languages for ChatGPT, Claude, Gemini, and more.",
    images: ["/og.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
};

/** Maps ThemeConfig radius tokens to their CSS rem equivalents. */
const RADIUS_VALUES: Readonly<Record<"none" | "sm" | "md" | "lg", string>> = {
  none: "0",
  sm:   "0.25rem",
  md:   "0.5rem",
  lg:   "0.75rem",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || headersList.get("x-invoke-path") || "";
  const isEmbedRoute = pathname.startsWith("/embed");
  const isKidsRoute = pathname.startsWith("/kids");
  
  const locale = await getLocale();
  const messages = await getMessages();
  const config = await getConfig();
  const isRtl = isRtlLocale(locale);

  // Calculate theme values server-side
  const themeClasses = `theme-${config.theme.variant} density-${config.theme.density}`;
  const primaryColour = parseHexColour(config.theme.colors.primary);
  const primaryOklch  = primaryColour?.oklch ?? "oklch(0.5 0.2 260)";
  const foreground    = contrastForeground(primaryColour?.luminance ?? 0.5);
  
  const themeStyles = {
    "--radius": RADIUS_VALUES[config.theme.radius],
    "--primary": primaryOklch,
    "--primary-foreground": foreground,
  } as React.CSSProperties;

  const fontClasses = isRtl 
    ? `${inter.variable} ${notoSansArabic.variable} ${geistMono.variable} ${playfairDisplay.variable} font-arabic` 
    : `${inter.variable} ${geistMono.variable} ${playfairDisplay.variable} font-sans`;

  return (
    <html lang={locale} dir={isRtl ? "rtl" : "ltr"} suppressHydrationWarning className={themeClasses} style={themeStyles}>
      <head>
        {/* Google Tag Manager */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-NHDXHCB3');`,
          }}
        />
        {process.env.GOOGLE_ADSENSE_ACCOUNT && (
          <meta name="google-adsense-account" content={process.env.GOOGLE_ADSENSE_ACCOUNT} />
        )}
        <WebsiteStructuredData />
        {process.env.NEXT_PUBLIC_EZOIC_ENABLED === "true" && <EzoicScripts />}
      </head>
      <body className={`${fontClasses} antialiased`}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-NHDXHCB3"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        {process.env.GOOGLE_ANALYTICS_ID && (
          <Analytics gaId={process.env.GOOGLE_ANALYTICS_ID} />
        )}
        {process.env.NEXT_PUBLIC_EZOIC_ENABLED === "true" && <EzoicRouteHandler />}
        <SpeedInsights />
          <VercelAnalytics />
        <Providers locale={locale} messages={messages} theme={config.theme} branding={{ ...config.branding, useCloneBranding: config.homepage?.useCloneBranding }}>
          {isEmbedRoute || isKidsRoute ? (
            children
          ) : (
            <>
              <LocaleDetector />
              <div className="relative min-h-screen flex flex-col">
                <Header authProvider={config.auth.provider} allowRegistration={config.auth.allowRegistration} />
                <main className="flex-1">{children}</main>
                <Footer />
                {/* CookieConsentBanner removed */}
              </div>
            </>
          )}
        </Providers>
      </body>
    </html>
  );
}
