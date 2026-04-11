import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Add each internal package name here so Next compiles its TypeScript.
  transpilePackages: ["@packages/core"],
};

export default nextConfig;
