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

// Draws the header and navigation into <div id="shell"></div>. `active` is the current page key.
const NAV = [['dashboard', 'dashboard.html', 'Dashboard'], ['receive', 'receive.html', 'Receive'], ['documents', 'documents.html', 'Submissions'], ['other-documents', 'other-documents.html', 'Other documents']];

function renderShell(active) {
  const u = getSession().user;
  $('shell').innerHTML = `
    <header class="bg-pine text-white noprint">
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div>
          <div class="font-bold text-lg leading-tight">Document Tracker</div>
          <div class="text-xs text-white/80">${esc(u.name)} · ${esc(u.role)} · ${u.campus === 'ALL' ? 'All campuses' : esc(u.campus) + ' Campus'}</div>
        </div>
        <button id="logoutBtn" class="text-sm underline underline-offset-2">Sign out</button>
      </div>
    </header>
    <nav class="bg-white border-b border-[#c9d3cd] noprint" aria-label="Main">
      <div class="max-w-6xl mx-auto px-4 flex items-center justify-between gap-3 overflow-x-auto">
        <div class="flex">${NAV.map(([key, href, label]) => `<a class="tab" href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</div>
        <button id="refreshBtn" class="text-sm text-[#4b5b54] underline underline-offset-2 whitespace-nowrap" title="Reload programs, offices and checklist from the sheet">Refresh lists</button>
      </div>
    </nav>`;
  $('logoutBtn').onclick = logout;
  $('refreshBtn').onclick = async () => {
    try { await loadBoot(true); toast('Lists refreshed. Reloading…'); setTimeout(() => location.reload(), 600); }
    catch (err) { toast(err.message); }
  };
}
