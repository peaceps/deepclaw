import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // a build that carries its own node_modules is what lets the cli ship as one npm package
  output: 'standalone',
  // the workspace packages are symlinks, so tracing has to start above them
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  // no page asks next to resize an image, and the optimizer would need a binary built for the
  // machine that published the package rather than the one running it
  images: { unoptimized: true },
  /* config options here */
  async redirects() {
    return [
      {
        source: '/',       // 当访问根路径时
        destination: '/agents', // 重定向到目标页面
        permanent: false,  // 是否永久重定向（308 vs 307）
      },
    ];
  },
};

export default nextConfig;
