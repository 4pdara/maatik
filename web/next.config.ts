import type { NextConfig } from "next";

const config: NextConfig = {
  // The editor runs locally in the prototype; no image optimisation service.
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default config;
