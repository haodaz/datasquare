import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AntdRegistry } from '@ant-design/nextjs-registry';
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "看人才DataSquare",
  description: "看人才DataSquare · 人才数据检索平台",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AntdRegistry>
          <div id="app-root" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
            {children}
          </div>
        </AntdRegistry>
        <style>{`
          /* ── 全局触控优化：去除 iOS 点击高亮 ── */
          * { -webkit-tap-highlight-color: transparent; }
        `}</style>
      </body>
    </html>
  );
}
