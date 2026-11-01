import './globals.css';

import { GeistSans } from 'geist/font/sans';
import { SessionProvider } from 'components/auth/session-provider';
import { HistoryDepthTracker } from 'components/navigation/history-depth';

const title = '词间 · WORDSPACE';
const description = '在字里行间，看见更大的世界。';

export const metadata = {
  title,
  description,
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#ffffff' };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={GeistSans.variable}><SessionProvider><HistoryDepthTracker /><div className="app-shell">{children}</div></SessionProvider></body>
    </html>
  );
}
