import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f8fafc',
          muted: '#f1f5f9',
          border: '#e2e8f0',
        },
        sidebar: {
          bg: '#080c14',
          hover: '#111827',
          active: '#1a2236',
          text: '#94a3b8',
          textHigh: '#e2e8f0',
          border: '#1e2535',
          icon: '#64748b',
        },
        brass: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        aurora: {
          // Primary electric blue
          primary: '#3b82f6',
          primaryDark: '#2563eb',
          primaryLight: '#60a5fa',
          // Accent graphite
          accent: '#1e293b',
          accentLight: '#334155',
          // Success
          success: '#10b981',
          successLight: '#d1fae5',
          successDark: '#059669',
          // Warning
          warning: '#f59e0b',
          warningLight: '#fef3c7',
          warningDark: '#d97706',
          // Danger
          danger: '#ef4444',
          dangerLight: '#fee2e2',
          dangerDark: '#dc2626',
          // Info
          info: '#06b6d4',
          infoLight: '#cffafe',
          infoDark: '#0891b2',
          // Restricted
          restricted: '#8b5cf6',
          restrictedLight: '#ede9fe',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'metric-xl': ['3rem', { lineHeight: '1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'metric-lg': ['2.25rem', { lineHeight: '1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'metric-md': ['1.5rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
        'metric-sm': ['1.25rem', { lineHeight: '1.2', fontWeight: '600' }],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-md': '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        'card-lg': '0 10px 30px -4px rgb(0 0 0 / 0.1), 0 4px 8px -4px rgb(0 0 0 / 0.06)',
        drawer: '-4px 0 32px 0 rgb(0 0 0 / 0.15)',
        'drawer-top': '0 4px 32px 0 rgb(0 0 0 / 0.15)',
        glow: '0 0 20px 0 rgb(59 130 246 / 0.2)',
        'glow-sm': '0 0 10px 0 rgb(59 130 246 / 0.15)',
        command: '0 20px 60px -10px rgb(0 0 0 / 0.3), 0 4px 16px -4px rgb(0 0 0 / 0.2)',
        inner: 'inset 0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      borderRadius: {
        aurora: '0.625rem',
        'aurora-lg': '0.875rem',
        'aurora-xl': '1.25rem',
      },
      animation: {
        'fade-in': 'auroraFadeIn 0.15s ease-out',
        'fade-out': 'auroraFadeOut 0.15s ease-in forwards',
        'fade-up': 'auroraFadeUp 0.2s ease-out',
        'slide-in-right': 'auroraSlideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-out-right': 'auroraSlideOutRight 0.18s cubic-bezier(0.4, 0, 1, 1) forwards',
        'slide-in-left': 'auroraSlideInLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'auroraSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'auroraScaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-out': 'auroraScaleOut 0.15s cubic-bezier(0.4, 0, 1, 1) forwards',
        'scale-pop': 'auroraScalePop 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'route-progress': 'auroraRouteProgress 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        shake: 'auroraShake 0.3s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        skeleton: 'auroraSkeleton 1.5s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
        'pulse-subtle': 'auroraPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        // Kaunta MUHURI (design direction §2.4): the stamp slam. `both` keeps
        // the −3° resting tilt after the slam; the global reduced-motion
        // kill-switches (media query + html.motion-reduced) collapse the
        // duration like every other animation here.
        'pos-stamp': 'posStamp 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      keyframes: {
        auroraFadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        auroraFadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        auroraSlideInRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        auroraSlideOutRight: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        auroraSlideInLeft: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        auroraSlideUp: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        auroraScaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        auroraFadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        auroraScaleOut: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(0.95)', opacity: '0' },
        },
        auroraScalePop: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '60%': { transform: 'scale(1.03)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        auroraRouteProgress: {
          '0%': { transform: 'translateX(-110%) scaleX(0.35)', opacity: '0' },
          '20%': { opacity: '1' },
          '70%': { transform: 'translateX(110%) scaleX(1)', opacity: '1' },
          '100%': { transform: 'translateX(230%) scaleX(0.35)', opacity: '0' },
        },
        auroraShake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-4px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(2px)' },
        },
        auroraSkeleton: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        auroraPulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        posStamp: {
          '0%': { transform: 'scale(1.6) rotate(-6deg)', opacity: '0' },
          '100%': { transform: 'scale(1) rotate(-3deg)', opacity: '1' },
        },
      },
      transitionTimingFunction: {
        aurora: 'cubic-bezier(0.16, 1, 0.3, 1)',
        'aurora-in': 'cubic-bezier(0.4, 0, 1, 1)',
        'aurora-out': 'cubic-bezier(0, 0, 0.2, 1)',
      },
      transitionDuration: {
        '50': '50ms',
        '250': '250ms',
        '350': '350ms',
        '400': '400ms',
      },
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
        dropdown: '1000',
        sticky: '1100',
        modal: '1200',
        drawer: '1300',
        toast: '1400',
        command: '1500',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '68': '17rem',
        '72': '18rem',
        '80': '20rem',
        '88': '22rem',
        '96': '24rem',
      },
    },
  },
  plugins: [],
};

export default config;
