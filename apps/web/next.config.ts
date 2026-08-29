import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Explicitly set the monorepo root so Turbopack doesn't get confused
  // by apps/web/package-lock.json and apps/api/package-lock.json coexisting.
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};

export default nextConfig;
