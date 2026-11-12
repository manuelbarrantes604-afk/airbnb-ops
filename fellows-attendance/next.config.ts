import type { NextConfig } from "next";

// All screens render in the browser after sign-in and read data through
// Supabase (protected by row-level security), so no server caching is used.
// DEMO_EXPORT=1 builds a static, fictional-data preview (no server routes).
const demoExport = process.env.DEMO_EXPORT === "1";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ...(demoExport
    ? { output: "export", trailingSlash: true, images: { unoptimized: true } }
    : {
        async headers() {
          return [
            { source: "/:path*", headers: securityHeaders },
            // Never let a browser or CDN cache signed-in API responses.
            { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
          ];
        },
      }),
};

export default nextConfig;
