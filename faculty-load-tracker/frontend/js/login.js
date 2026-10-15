// Login page. If already signed in, go straight to the dashboard.
if (getSession()) location.replace('dashboard.html');

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('lgError', '');
  busy($('lgBtn'), true, 'Signing in…');
  try {
    const s = await api('login', { name: $('lgName').value, pin: $('lgPin').value });
    setSession(s);                       // only the token and user info are stored, never document data
    location.replace('dashboard.html');
  } catch (err) {
    showError('lgError', err.message);
    busy($('lgBtn'), false);
  }
});
