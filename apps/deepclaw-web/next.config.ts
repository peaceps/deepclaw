import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      {
        source: '/',       // 当访问根路径时
        destination: '/tasks/board', // 重定向到目标页面
        permanent: false,  // 是否永久重定向（308 vs 307）
      },
    ];
  },
};

export default nextConfig;
