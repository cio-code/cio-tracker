// Must be loaded right AFTER the Tailwind CDN script on every page.
tailwind.config = {
  theme: {
    extend: {
      fontFamily: { sans: ['"Public Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        pine: { DEFAULT: '#1f5c46', dark: '#164536', soft: '#e3efe9' },
        ink: '#18231f',
        amber2: '#b4690e'
      }
    }
  }
};
