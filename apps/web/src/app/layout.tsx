import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../components/components.css';

export const metadata: Metadata = {
  title: 'Bandbox — Know the block before you knock.',
  description:
    'Parcel-level Philadelphia real-estate intelligence from the public record. ' +
    'Transparency-first: every derived number is decomposable and links to its raw filing.',
  applicationName: 'Bandbox',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0A2A5E' },
    { media: '(prefers-color-scheme: dark)', color: '#16407F' },
  ],
};

/**
 * Pre-paint theme resolution. Runs before React hydrates so the warm-umber
 * dark ground never flashes light (and vice-versa). Mirrors ThemeToggle's
 * storage key + prefers-color-scheme default. Kept inline + tiny on purpose.
 */
const THEME_BOOTSTRAP = `(function(){try{
  var k='pb-theme';
  var stored=localStorage.getItem(k);
  var sys=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  var t=(stored==='light'||stored==='dark')?stored:sys;
  document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <link
          rel="preload"
          href="/fonts/tanker400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/satoshi400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/spacemono400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
