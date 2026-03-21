import { defineConfig } from "@/lib/config";

const useCloneBranding = true;

export default defineConfig({
  branding: {
    name: "Prompt Manuals",
    logo: "/logo.png",
    logoDark: "/logo.png",
    favicon: "/favicon.png",
    description: "The largest free AI prompt library — 40,000+ prompts in 19 languages",
  },

  theme: {
    radius: "sm",
    variant: "default",
    density: "default",
    colors: {
      primary: "#9B1FCC", // Purple from Prompt Manuals logo
    },
  },

  auth: {
    providers: ["github", "google"],
    allowRegistration: true,
  },

  i18n: {
    locales: ["en", "es", "fr", "de", "it", "pt", "ru", "zh", "ja", "ko", "hi", "bn", "ta", "te", "mr", "kn", "gu", "pa", "sw"],
    defaultLocale: "en",
  },

  features: {
    privatePrompts: true,
    changeRequests: true,
    categories: true,
    tags: true,
    aiSearch: false,
    aiGeneration: false,
    mcp: false,
    comments: true,
  },

  homepage: {
    useCloneBranding,
    achievements: {
      enabled: false,
    },
    sponsors: {
      enabled: false,
      items: [],
    },
  },
});
