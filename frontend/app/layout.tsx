import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantmail — AI Gmail Killer",
  description: "The fastest, most intelligent email client powered by AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-surface text-gray-100 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
