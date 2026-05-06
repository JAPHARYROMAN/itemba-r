'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

const links = [
  { href: '/',          label: 'Home' },
  { href: '/about',     label: 'About' },
  { href: '/companies', label: 'Companies' },
  { href: '/contact',   label: 'Contact' },
];

export default function Navbar() {
  const [scrolled, setScrolled]   = useState(false);
  const [open, setOpen]           = useState(false);
  const pathname                  = usePathname();
  const isHome                    = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // On home: transparent until scrolled; on inner pages: always solid
  const solid = !isHome || scrolled;

  return (
    <motion.header
      animate={{
        backgroundColor: solid ? 'rgba(8, 15, 30, 0.97)' : 'rgba(8, 15, 30, 0)',
        backdropFilter:  solid ? 'blur(20px)' : 'blur(0px)',
        borderBottomColor: solid ? 'rgba(36, 61, 96, 0.6)' : 'rgba(36, 61, 96, 0)',
      }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 left-0 right-0 z-50 border-b"
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 flex-shrink-0">
          <div className="rounded-sm">
            {/* Save logo to website/public/logo.png */}
            <Image
              src="/logo.png"
              alt="Itemba Group"
              width={260}
              height={100}
              className="h-12 w-auto object-contain sm:h-14"
              priority
            />
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative px-4 py-2 text-sm font-medium transition-colors duration-200 rounded-md ${
                  active ? 'text-gold-400' : 'text-slate-300 hover:text-white'
                }`}
              >
                {link.label}
                {active && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute bottom-0 left-4 right-4 h-0.5 bg-gold-500 rounded-full"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(!open)}
          className="md:hidden p-2 text-slate-300 hover:text-white transition-colors"
          aria-label="Toggle menu"
        >
          <motion.div animate={open ? 'open' : 'closed'} className="flex flex-col gap-1.5 w-6">
            <motion.span
              variants={{ open: { rotate: 45, y: 8 }, closed: { rotate: 0, y: 0 } }}
              className="block h-0.5 bg-current rounded-full"
            />
            <motion.span
              variants={{ open: { opacity: 0 }, closed: { opacity: 1 } }}
              className="block h-0.5 bg-current rounded-full"
            />
            <motion.span
              variants={{ open: { rotate: -45, y: -8 }, closed: { rotate: 0, y: 0 } }}
              className="block h-0.5 bg-current rounded-full"
            />
          </motion.div>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden bg-ink-900 border-t border-ink-600 overflow-hidden"
          >
            <div className="px-5 py-4 space-y-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    pathname === link.href
                      ? 'text-gold-400 bg-ink-700'
                      : 'text-slate-300 hover:text-white hover:bg-ink-700'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
