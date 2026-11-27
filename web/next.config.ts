import type { NextConfig } from "next";

const config: NextConfig = {
  // The editor runs locally in the prototype; no image optimisation service.
  images: { unoptimized: true },
  poweredByHeader: false,
  // A self-contained server (node .next/standalone/server.js) for the deployed site on Modal.
  output: "standalone",
};

export default config;
