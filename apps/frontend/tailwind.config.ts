import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Brand palette ──────────────────────────────────
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // ── Surface colors ─────────────────────────────────
        surface: {
          DEFAULT: 'var(--surface-default)',
          card:    'var(--surface-card)',
          hover:   'var(--surface-hover)',
          border:  'var(--surface-border)',
          input:   'var(--surface-input)',
        },
        // ── Text ───────────────────────────────────────────
        text: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
        },
        // ── Platform colors ────────────────────────────────
        instagram: '#e1306c',
        facebook:  '#1877f2',
        youtube:   '#ff0000',
        // ── Status ─────────────────────────────────────────
        success: '#22c55e',
        warning: '#f59e0b',
        error:   '#ef4444',
        info:    '#3b82f6',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card:      '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        glow:      '0 0 20px rgba(99,102,241,0.3)',
        'glow-sm': '0 0 10px rgba(99,102,241,0.2)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':  'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'slide-in':   'slideIn 0.25s ease-out',
        'bounce-in':  'bounceIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow':  'spin 3s linear infinite',
        'float':      'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideIn:  { from: { opacity: '0', transform: 'translateX(-8px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        bounceIn: { '0%': { transform: 'scale(0.9)', opacity: '0' }, '60%': { transform: 'scale(1.02)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        float:    { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
      },
    },
  },
  plugins: [],
};

export default config;
