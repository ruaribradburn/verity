import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Single source of truth: repo-root `.env` (ports, origins, server secrets).
dotenv.config({ path: path.join(__dirname, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@packages/core"],
};

export default nextConfig;
