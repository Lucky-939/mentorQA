import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Allow the dashboard page to call the API server
  // Additional rewrites/proxying can be added in later phases
  async rewrites() {
    return [];
  },
};

export default nextConfig;
