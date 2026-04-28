import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import createMDX from "@next/mdx";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const withMDX = createMDX({
  extension: /\.mdx?$/,
});

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  reactCompiler: false,
  // Required: Cloudflare Pages runs build from repo root, not app/.
  // Without this: bundler finds C:\Nebula\pages (from monorepo) and throws
  // "pages and app directories should be under the same folder".
  outputFileTracingRoot: ".",
  // Configure webpack for raw imports
  webpack: (config) => {
    config.module.rules.push({
      resourceQuery: /raw/,
      type: 'asset/source',
    });
    return config;
  },
  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // Rewrites
  async rewrites() {
    return [
      { source: "/sitemap.xml",         destination: "/sitemap-index" },
      { source: "/sitemap/:id(\\d+).xml", destination: "/sitemap-page/:id" },
    ];
  },
  // Redirects
  async redirects() {
    return [
      {
        source: "/vibe",
        destination: "/categories/vibe",
        permanent: true,
      },
      {
        source: "/sponsors",
        destination: "/categories/sponsors",
        permanent: true,
      },
      {
        source: "/embed-preview",
        destination: "/embed",
        permanent: true,
      },
      // Redirect book PDF downloads to GitHub raw to save edge bandwidth
      {
        source: "/book-pdf/:filename",
        destination: "https://raw.githubusercontent.com/vimokoshi/promptmanuals/refs/heads/main/public/book-pdf/:filename",
        permanent: false,
      },
    ];
  },
};

const sentryOptions = {
  org: "promptschat",
  project: "prompts-chat",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    automaticVercelMonitors: false,
    treeshake: { removeDebugLogging: true },
  },
};

export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(withMDX(withNextIntl(nextConfig)), sentryOptions)
  : withMDX(withNextIntl(nextConfig));
