import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    accountapi: {
      name: "Rwanda Wealth account API",
      source: "functions/accountapi.ts",
      env: {
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY!,
        VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY!,
        VAPID_SUBJECT: process.env.VAPID_SUBJECT!,
      },
    },
  },
  preview: {
    buckets: {
      uploads: { access: "private" },
    },
  },
});