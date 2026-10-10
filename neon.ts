import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    accountapi: {
      name: "Rwanda Wealth account API",
      source: "functions/accountapi.ts",
    },
  },
  preview: {
    buckets: {
      uploads: { access: "private" },
    },
  },
});