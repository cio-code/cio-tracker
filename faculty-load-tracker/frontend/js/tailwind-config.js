// Must be loaded right AFTER the Tailwind CDN script on every page.
// "pine" colors come from CSS variables, so the whole site changes color when you switch
// between Faculty Load (green) and DLP (blue). The variables are set in ui.js (applyBrand).
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
