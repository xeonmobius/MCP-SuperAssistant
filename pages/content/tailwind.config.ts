import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  important: true, // Use !important for all utilities to ensure they override Shadow DOM styles
  corePlugins: {
    preflight: true,
  },
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        'accent-from': 'var(--accent-from)',
        'accent-to': 'var(--accent-to)',
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
        con: { DEFAULT: 'var(--con)', soft: 'var(--con-soft)' },
        off: { DEFAULT: 'var(--off)', soft: 'var(--off-soft)' },
        err: { DEFAULT: 'var(--err)', soft: 'var(--err-soft)' },
      },
      borderRadius: {
        row: 'var(--radius-row)',
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
      },
    },
  },
} satisfies Config;
