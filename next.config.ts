import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile above this directory makes Turbopack infer the wrong workspace root.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
