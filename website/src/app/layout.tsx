import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ScrollProgress from '@/components/ScrollProgress';
import PageTransition from '@/components/PageTransition';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  weight: ['600', '700', '800', '900'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Itemba Group | Tanzania's Diversified Business Group",
  description:
    'Itemba Group is a Tanzanian holding group operating across energy, trade, manufacturing, construction, hospitality, and real estate. Headquartered in Mpemba-Tunduma, Songwe Region.',
  keywords:
    'Itemba Group, Tanzania, energy, trade, manufacturing, construction, hospitality, real estate, Mwanjalisi Oil, Westsides, Itemba Enterprises',
  openGraph: {
    title: "Itemba Group | Tanzania's Diversified Business Group",
    description: 'A multi-industry business ecosystem in Tanzania.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body className="font-sans antialiased bg-white text-slate-900 overflow-x-hidden">
        <ScrollProgress />
        <Navbar />
        <main>
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
      </body>
    </html>
  );
}
