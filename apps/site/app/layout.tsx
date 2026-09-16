import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { NotificationProvider } from './components/notifications';
import './globals.css';
import './components/arcade-ui.css';
import './components/arcade-pages.css';

const pressStart = localFont({
  src: '../../../packages/web/public/fonts/press-start-2p/PressStart2P-Regular.ttf',
  variable: '--font-pixel',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://sparkade.dev'),
  title: {
    default: 'Sparkade — Your idea. Your arcade.',
    template: '%s · Sparkade',
  },
  description:
    'Sparkade turns an idea into a complete, playable retro game you can share with the world.',
  applicationName: 'Sparkade',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Sparkade',
    title: 'Sparkade — Your idea. Your arcade.',
    description: 'Play original games and turn your ideas into an arcade.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sparkade — Your idea. Your arcade.',
    description: 'Play original games and turn your ideas into an arcade.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#070912',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={pressStart.variable} data-scroll-behavior="smooth">
      <body>
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
          <NotificationProvider>{children}</NotificationProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
