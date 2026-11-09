import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid a separate render-blocking stylesheet request on first entry.
  experimental: { inlineCss: true },
};

export default nextConfig;
