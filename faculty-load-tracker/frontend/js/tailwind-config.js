// Must be loaded right AFTER the Tailwind CDN script on every page.
// "pine" colors come from CSS variables (defaults are set in css/style.css).
tailwind.config = {
  theme: {
    extend: {
      fontFamily: { sans: ['"Public Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        pine: { DEFAULT: 'var(--brand)', dark: 'var(--brand-dark)', soft: 'var(--brand-soft)' },
        ink: '#18231f',
        amber2: '#b4690e'
      }
    }
  }
};
