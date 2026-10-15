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

// Programs, flow rules, offices and the attachment checklist. Kept for 10 minutes in this browser tab
// so pages open faster. This is NOT faculty data. Use "Refresh lists" in the menu after editing the sheet.
const BOOT_TTL = 10 * 60 * 1000;
async function loadBoot(force) {
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem('boot') || 'null');
      if (c && Date.now() - c.t < BOOT_TTL) return c.data;
    } catch (e) { /* ignore a damaged cache */ }
  }
  const data = await api('bootstrap', { refresh: !!force });
  sessionStorage.setItem('boot', JSON.stringify({ t: Date.now(), data }));
  return data;
}
