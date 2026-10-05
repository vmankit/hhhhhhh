import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manual Health Logger",
  description: "Manually log workouts and sync them to Google Health.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">{children}</div>
      </body>
    </html>
  );
}
