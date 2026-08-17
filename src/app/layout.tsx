import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./components/Providers";
import { THEME_COLORS } from "./lib/themeColors";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unsent",
  description:
    "Figure out what to actually say. Unsent gives you reply drafts in distinct personas — for the messages that matter.",
};

// Unsent 锁定浅色 Retro：不再有深色主题 / 切换 / localStorage 逻辑，
// 主题直接静态写死在 <html data-theme="light">（见下）。原先那段在首屏前
// 读 localStorage 决定主题的内联脚本已随深色主题一起移除。

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // data-theme 静态写死 light：锁定浅色 Retro。服务端和客户端输出一致，
    // 无需 suppressHydrationWarning（不再有脚本在挂载前改属性）。
    <html
      lang="en"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* 地址栏配色：锁定浅色粉底，静态即可 */}
        <meta name="theme-color" content={THEME_COLORS.light} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
