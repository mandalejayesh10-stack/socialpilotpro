import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { SWRProvider } from '@/components/providers/swr-provider';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: {
    default: 'SocialPilot Pro',
    template: '%s | SocialPilot Pro',
  },
  description: 'Professional social media management platform — schedule, analyze, and grow.',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' }
    ]
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  var supportDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  if (theme === 'light' || (!theme && !supportDarkMode)) {
                    document.documentElement.classList.remove('dark');
                  } else {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${jakarta.variable} font-sans bg-surface text-text-primary antialiased`}>
        <SWRProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </SWRProvider>
      </body>
    </html>
  );
}
