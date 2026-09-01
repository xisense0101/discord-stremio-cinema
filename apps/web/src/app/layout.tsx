import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Discord Stremio Cinema • Web Controller',
  description: 'Interactive Remote & Cinema Dashboard for Discord Stremio Player',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#090a0f] text-gray-100 antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
