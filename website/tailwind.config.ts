import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Group base — near-black dark navy
        ink: {
          950: '#05080f',
          900: '#080f1e',
          800: '#0d1628',
          700: '#122035',
          600: '#1a2e4a',
          500: '#243d60',
        },
        // Group accent — gold
        gold: {
          300: '#f0cc6a',
          400: '#e8b52e',
          500: '#c8860a',
          600: '#a86808',
          700: '#864d05',
        },
        // Mwanjalisi Oil — amber/energy
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        // Westsides — electric blue
        electric: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
        },
        // Itemba Enterprises — emerald
        grove: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
      },
      fontFamily: {
        sans:  ['var(--font-inter)', 'system-ui', 'sans-serif'],
        tight: ['var(--font-inter-tight)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '8xl': ['6rem',   { lineHeight: '1' }],
        '9xl': ['8rem',   { lineHeight: '1' }],
        '10xl': ['10rem', { lineHeight: '1' }],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter:  '-0.03em',
      },
      animation: {
        'float-slow':   'float 10s ease-in-out infinite',
        'float-medium': 'float 7s ease-in-out infinite reverse',
        'fade-up':      'fadeUp 0.7s ease forwards',
        'gradient-x':   'gradientX 8s ease infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-30px)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        gradientX: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' },
        },
      },
      backgroundSize: {
        '200': '200% 200%',
      },
      transitionTimingFunction: {
        'apple': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
