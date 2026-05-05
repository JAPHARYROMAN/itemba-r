import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: "Itemba Group | Tanzania's Diversified Business Group",
  description:
    'Itemba Group is a Tanzanian holding group operating across energy, trade, manufacturing, construction, hospitality, and real estate. Headquartered in Mpemba-Tunduma, Songwe Region.',
  keywords:
    'Itemba Group, Tanzania, energy, trade, manufacturing, construction, hospitality, real estate, Mwanjalisi Oil, Westsides, Itemba Enterprises',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased text-slate-900 bg-white`}>
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
