// ITEMBA-R Aurora Design System — Design Tokens
// These mirror the CSS variables defined in aurora.css

export const tokens = {
  colors: {
    primary: '#2563eb',
    primaryDark: '#1d4ed8',
    primaryLight: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#06b6d4',
    restricted: '#8b5cf6',
  },
  sidebar: {
    bg: '#080c14',
    border: '#1e2535',
    text: '#94a3b8',
    textHigh: '#e2e8f0',
  },
  radius: {
    sm: '0.375rem',
    md: '0.625rem',
    lg: '0.875rem',
    xl: '1.25rem',
  },
  shadow: {
    sm: '0 1px 3px 0 rgb(0 0 0 / 0.06)',
    md: '0 4px 12px -2px rgb(0 0 0 / 0.08)',
    lg: '0 10px 30px -4px rgb(0 0 0 / 0.1)',
    command: '0 20px 60px -10px rgb(0 0 0 / 0.3)',
  },
  motion: {
    fast: '100ms',
    normal: '200ms',
    slow: '350ms',
    ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  zIndex: {
    dropdown: 1000,
    sticky: 1100,
    modal: 1200,
    drawer: 1300,
    toast: 1400,
    command: 1500,
  },
} as const;
