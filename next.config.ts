import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  experimental: {
    serverActions: {
      // Asset uploads (whitepapers/ebooks/creatives) routinely exceed the
      // 1MB default; raised to cover this app's real asset sizes.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
