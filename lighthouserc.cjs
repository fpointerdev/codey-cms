const { chromium } = require("@playwright/test");

const url = process.env.LIGHTHOUSE_URL || "http://127.0.0.1:4173/";
const externalServer = Boolean(process.env.LIGHTHOUSE_URL);
const profile = process.env.LIGHTHOUSE_PROFILE === "mobile" ? "mobile" : "desktop";

module.exports = {
  ci: {
    collect: {
      url: [url],
      numberOfRuns: 3,
      chromePath: chromium.executablePath(),
      ...(!externalServer
        ? {
            startServerCommand: "node --import tsx scripts/start-lighthouse-server.mjs",
            startServerReadyPattern: "Lighthouse server ready",
            startServerReadyTimeout: 120000
          }
        : {}),
      settings: {
        ...(profile === "desktop" ? { preset: "desktop" } : {}),
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        chromeFlags: "--headless=new --no-sandbox --disable-dev-shm-usage"
      }
    },
    assert: {
      aggregationMethod: "pessimistic",
      assertions: {
        "categories:performance": ["error", { minScore: 1 }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 1 }],
        "categories:seo": ["error", { minScore: 1 }]
      }
    },
    upload: {
      target: "filesystem",
      outputDir: `.lighthouseci/${profile}`
    }
  }
};
