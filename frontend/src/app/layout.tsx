import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'ITEMBA-R · Group Digital Governance',
  description: 'Group Digital Governance and Enterprise Management System.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full font-sans">
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (typeof window !== 'undefined' && window.localStorage) {
                  var t = window.localStorage.getItem('aurora-theme') || 'system';
                  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (dark) document.documentElement.classList.add('dark');
                }
              } catch(e) {}
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
