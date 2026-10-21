import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ordrum · 瑞典语单词室",
  description: "Rivstart 学习任务、翻卡片与听写。",
  icons: {
    icon: "/icons/icon.svg",
    shortcut: "/icons/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
