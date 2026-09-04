import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MentorQA — AI-Powered Code Review & QA',
  description:
    'Connect your GitHub repo and get automated QA, architecture analysis, AI-powered explanations, and PR fixes — all in one platform.',
  keywords: ['code review', 'QA automation', 'GitHub', 'AI mentor', 'testing'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${geistMono.variable} font-sans bg-brutal-bg text-brutal-primary antialiased`}>
        {children}
      </body>
    </html>
  );
}
