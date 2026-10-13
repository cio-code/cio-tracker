// Talks to the backend (Apps Script). Every page uses api() and nothing else for server calls.

function getSession() { return JSON.parse(sessionStorage.getItem('session') || 'null'); } // { token, user }
function setSession(s) { sessionStorage.setItem('session', JSON.stringify(s)); sessionStorage.removeItem('boot'); }
function clearSession() { sessionStorage.removeItem('session'); sessionStorage.removeItem('boot'); }

// The body is sent as plain text JSON so the browser skips the CORS "preflight"
// (Apps Script cannot answer preflight requests).
async function api(action, payload = {}) {
  if (API_URL.indexOf('PASTE') === 0) throw new Error('Set API_URL in js/config.js first.');
  const s = getSession();
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action, token: s && s.token, ...payload }) });
  const out = await res.json();
  if (!out.success) {
    if (out.error === 'SESSION_EXPIRED') { clearSession(); location.replace('index.html'); throw new Error('Session ended. Please sign in again.'); }
    throw new Error(out.error);
  }
  return out.data;
}

// Programs, flow rules and office list. Cached for the browser tab so each page opens faster.
async function loadBoot() {
  return await api('bootstrap');
}
