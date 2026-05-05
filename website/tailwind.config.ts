import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f3f9',
          100: '#d9e1ef',
          200: '#b3c3de',
          300: '#8da5ce',
          400: '#6787be',
          500: '#4169ad',
          600: '#2e518b',
          700: '#1e3969',
          800: '#132546',
          900: '#0d1b35',
          950: '#080f1e',
        },
        gold: {
          50:  '#fdf8ec',
          100: '#f9ecc6',
          200: '#f3d88e',
          300: '#edc455',
          400: '#e7b02c',
          500: '#c8860a',
          600: '#a86908',
          700: '#864d06',
          800: '#633805',
          900: '#3f2303',
        },
      },
    },
  },
  plugins: [],
};

export default config;
