// Header + menu for the two NEW pages (submission-receive.html and submissions.html).
// It is separate from ui.js on purpose, so your live pages and ui.js are not touched.
// Needs from ui.js / api.js: $, esc, getSession, logout, toast, api.
const SUB_NAV = [
  ['dashboard', 'dashboard.html', 'Dashboard'],
  ['fl', 'receive-faculty-load.html', 'Receive Faculty Load'],
  ['dlp', 'receive-dlp.html', 'Receive DLP'],
  ['documents', 'documents.html', 'Documents'],
  ['sub-receive', 'submission-receive.html', 'Receive Submission'],
  ['submissions', 'submissions.html', 'Submissions']
];

function renderSubShell(active) {
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
        <div class="flex">${SUB_NAV.map(([key, href, label]) => `<a class="tab" href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</div>
        <button id="refreshBtn" class="text-sm text-[#4b5b54] underline underline-offset-2 whitespace-nowrap" title="Reload programs, offices and the checklist from the sheet">Refresh lists</button>
      </div>
    </nav>`;
  $('logoutBtn').onclick = logout;
  $('refreshBtn').onclick = async () => {
    try { sessionStorage.removeItem('boot'); await api('bootstrap', { refresh: true }); toast('Lists refreshed. Reloading…'); setTimeout(() => location.reload(), 600); }
    catch (err) { toast(err.message); }
  };
}

// The "Program / Major" choices of one campus + department, built from the Programs sheet.
// One choice carries BOTH values, e.g. "Bachelor of Secondary Education – Science".
// A program that has majors is only offered together with one of its majors.
const PM_SEP = '||';
function programMajorChoices(programs, campus, department) {
  const rows = programs.filter(p => p.Campus === campus && p.Department === department);
  const hasMajor = {};
  rows.forEach(p => { if (p.Major) hasMajor[p.Program] = true; });
  const seen = {}, out = [];
  rows.forEach(p => {
    if (!p.Major && hasMajor[p.Program]) return;
    const key = p.Program + PM_SEP + (p.Major || '');
    if (seen[key]) return;
    seen[key] = true;
    out.push({ key, program: p.Program, major: p.Major || '', label: p.Major ? p.Program + ' – ' + p.Major : p.Program });
  });
  return out;
}
const pmOptions = (choices, first) => `<option value="">${esc(first)}</option>` + choices.map(c => `<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('');