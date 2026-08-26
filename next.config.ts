import type { NextConfig } from "next";

const FLORA_HOST = process.env.FLORA_HOST || 'https://polarise-ss-alpha.nx1.applysquare.net';

const nextConfig: NextConfig = {
  // 允许局域网 IP 访问 dev server（包括 WebSocket HMR）
  allowedDevOrigins: ['192.168.10.36'],
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  async redirects() {
    return [
      {
        source: '/blobs/:path*',
        destination: `${FLORA_HOST}/blobs/:path*`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
