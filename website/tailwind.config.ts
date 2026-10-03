import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { baseStyles, colors, fontFamilies, screens, themeExtend } from './src/design/theme';

/**
 * Every value comes from src/design/tokens.ts through src/design/theme.ts.
 * - `colors` replaces Tailwind's palette, keeping only transparent, current,
 *   white and black. The rest are the design tokens.
 * - The plugin writes the tokens as CSS variables, with the data-tone and
 *   data-accent re-mapping, into the base layer (emitted by
 *   src/styles/tokens.css).
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    screens,
    colors,
    fontFamily: fontFamilies,
    extend: {
      ...themeExtend,
      borderColor: { DEFAULT: 'rgb(var(--line) / <alpha-value>)' },
      ringColor: { DEFAULT: 'rgb(var(--focus) / <alpha-value>)' },
      outlineColor: { DEFAULT: 'rgb(var(--focus) / <alpha-value>)' },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase(baseStyles());
    }),
  ],
};

export default config;
