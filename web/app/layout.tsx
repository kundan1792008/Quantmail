import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";

export const metadata: Metadata = {
  title: "Quant Workspace — The AI-Powered Super App",
  description:
    "Mail, Calendar, Drive, Docs, Sheets, Chat, Tasks, Notes, Meet — all in one ultra-premium workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className="flex h-full overflow-hidden"
        style={{ background: "#000000", color: "#f0f0f0" }}
      >
        <Sidebar />
        <main className="flex-1 overflow-hidden relative">{children}</main>
        <CommandPalette />
      </body>
    </html>
  );
}
