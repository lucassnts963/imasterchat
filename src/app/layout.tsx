import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  LEGACY_MODE_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "iMasterChat",
    template: "%s — iMasterChat",
  },
  description: "Atendimento e CRM para WhatsApp.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
    // iOS ignores the manifest's icons entirely and reads only this one
    // when the app is added to the home screen. Without it the shortcut
    // gets a blurry screenshot of the page instead of the logo.
    apple: [{ url: "/pwa-icon?size=180", sizes: "180x180" }],
  },
  // Standalone on iOS, and a title that is not the <title> of whatever
  // page happened to be open when the shortcut was created.
  appleWebApp: {
    capable: true,
    title: "iMasterChat",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0C0F",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    // One-time migration from the pre-rebrand wacrm.* keys: a browser
    // that used the app under the old brand keeps its chosen accent
    // and mode under the new keys, and the old keys are removed.
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_LEGACY_KEY = ${JSON.stringify(LEGACY_STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    var legacyTheme = localStorage.getItem(THEME_LEGACY_KEY);
    if (legacyTheme !== null) {
      if (savedTheme === null && THEMES.indexOf(legacyTheme) !== -1) {
        localStorage.setItem(THEME_KEY, legacyTheme);
        savedTheme = legacyTheme;
      }
      localStorage.removeItem(THEME_LEGACY_KEY);
    }
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_LEGACY_KEY = ${JSON.stringify(LEGACY_MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    var legacyMode = localStorage.getItem(MODE_LEGACY_KEY);
    if (legacyMode !== null) {
      if (savedMode === null && MODES.indexOf(legacyMode) !== -1) {
        localStorage.setItem(MODE_KEY, legacyMode);
        savedMode = legacyMode;
      }
      localStorage.removeItem(MODE_LEGACY_KEY);
    }
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
