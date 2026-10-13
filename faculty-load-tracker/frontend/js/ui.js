// Helpers and the navigation bar shared by every page.

const $ = id => document.getElementById(id);
const uniq = a => [...new Set(a)];
// esc() makes text safe before it goes into HTML (protects against injected scripts). Always use it for data.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const options = (list, first) => (first ? `<option value="">${esc(first)}</option>` : '') + list.map(v => `<option>${esc(v)}</option>`).join('');

function toast(msg) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.id); toast.id = setTimeout(() => t.classList.add('hidden'), 2600);
}
function busy(btn, on, text) {
  if (on) { btn.dataset.t = btn.textContent; btn.textContent = text || 'Please wait…'; } else { btn.textContent = btn.dataset.t; }
  btn.disabled = on;
}
function showError(id, msg) { const e = $(id); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }

const STATUS_STYLE = {
  'Received': 'background:#dbeafe;color:#1e3a8a', 'Processing': 'background:#fef3c7;color:#78350f',
  'For Signature': 'background:#ede9fe;color:#4c1d95', 'Returned': 'background:#fee2e2;color:#7f1d1d',
  'Released': 'background:#dcfce7;color:#14532d'
};
const chip = s => `<span class="chip" style="${STATUS_STYLE[s] || ''}">${esc(s)}</span>`;

function allowedCampuses(boot) {
  const all = uniq(boot.programs.map(p => p.Campus));
  const mine = getSession().user.campus;
  return mine === 'ALL' ? all : all.filter(c => c === mine);
}

function logout() { clearSession(); location.replace('index.html'); }

// Send people back to the login page if they are not signed in.
function requireLogin() { if (!getSession()) location.replace('index.html'); }

// ---------- Workspace: Faculty Load or DLP ----------
// The whole site (dashboard, receive, documents) shows ONE document type at a time.
const WORKSPACES = {
  'Faculty Load': { label: 'Faculty Load', receive: 'receive-faculty-load.html', color: '#1f5c46', dark: '#164536', soft: '#e3efe9' },
  'DLP':          { label: 'DLP',          receive: 'receive-dlp.html',          color: '#1d4f7a', dark: '#153a5a', soft: '#e2edf6' }
};

function getWorkspace() {
  if (window.PAGE_TYPE) return window.PAGE_TYPE;           // receive pages already know their type
  try { const w = localStorage.getItem('workspace'); if (WORKSPACES[w]) return w; } catch (e) {}
  return 'Faculty Load';
}

function applyBrand(ws) {
  const w = WORKSPACES[ws], root = document.documentElement.style;
  root.setProperty('--brand', w.color); root.setProperty('--brand-dark', w.dark); root.setProperty('--brand-soft', w.soft);
}

function setWorkspace(ws) {
  try { localStorage.setItem('workspace', ws); } catch (e) {}
  // On a receive page, jump to the matching receive page. On other pages, reload with the new type.
  if (window.PAGE_TYPE) location.href = WORKSPACES[ws].receive; else location.reload();
}

// Draws the header, the Faculty Load / DLP switch and the navigation into <div id="shell"></div>.
// `active` is the current page key. Returns the chosen workspace name.
function renderShell(active) {
  const u = getSession().user;
  const ws = getWorkspace();
  try { localStorage.setItem('workspace', ws); } catch (e) {}
  applyBrand(ws);

  const nav = [['dashboard', 'dashboard.html', 'Dashboard'], ['receive', WORKSPACES[ws].receive, 'Receive'], ['documents', 'documents.html', 'Documents']];
  const switchBtn = name => `<button type="button" data-ws="${name}" aria-pressed="${name === ws}"
      class="px-4 py-1.5 text-sm font-semibold rounded-md ${name === ws ? 'bg-white text-ink' : 'text-white hover:bg-white/15'}">${WORKSPACES[name].label}</button>`;

  $('shell').innerHTML = `
    <header class="bg-pine text-white noprint">
      <div class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="font-bold text-lg leading-tight">Document Tracker</div>
          <div class="text-xs text-white/80">${esc(u.name)} · ${esc(u.role)} · ${u.campus === 'ALL' ? 'All campuses' : esc(u.campus) + ' Campus'}</div>
        </div>
        <div class="flex items-center gap-1 p-1 rounded-lg border border-white/40" role="group" aria-label="Document type">
          ${switchBtn('Faculty Load')}${switchBtn('DLP')}
        </div>
        <button id="logoutBtn" class="text-sm underline underline-offset-2">Sign out</button>
      </div>
    </header>
    <nav class="bg-white border-b border-[#c9d3cd] noprint" aria-label="Main">
      <div class="max-w-6xl mx-auto px-4 flex overflow-x-auto">
        ${nav.map(([key, href, label]) => `<a class="tab" href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label} <span class="font-normal opacity-70">· ${esc(WORKSPACES[ws].label)}</span></a>`).join('')}
      </div>
    </nav>`;
  $('logoutBtn').onclick = logout;
  document.querySelectorAll('[data-ws]').forEach(b => b.onclick = () => { if (b.dataset.ws !== ws) setWorkspace(b.dataset.ws); });
  return ws;
}
