requireLogin();
renderShell('documents');

let boot = null;
let subs = [];      // rows in the table
let cur = null;     // the submission open in the panel: { submission, lines, log }

// The button that was pressed (falls back to the form's own button if the browser gives none).
const btnOf = e => e.submitter || e.target.querySelector('button');

// ---- Start ----
(async function init() {
  try {
    boot = await loadBoot();
    const campuses = allowedCampuses(boot);
    $('fCampus').innerHTML = options(campuses, campuses.length > 1 ? 'All campuses' : '');
    await loadSubs();
  } catch (err) { toast(err.message); }
})();

// ---- Filters ----
let searchTimer;
$('fQ').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadSubs, 400); };
['fCampus', 'fStatus', 'fMissing'].forEach(id => $(id).onchange = loadSubs);

// ---- Table ----
const progressChip = (done, total) =>
  `<span class="chip" style="${done === total && total ? 'background:#dcfce7;color:#14532d' : 'background:#fef3c7;color:#78350f'}">${done}/${total}</span>`;

async function loadSubs() {
  try {
    subs = await api('subList', { q: $('fQ').value.trim(), campus: $('fCampus').value, status: $('fStatus').value, missing: $('fMissing').value });
    renderTable();
  } catch (err) { toast(err.message); }
}

function renderTable() {
  // The default filter hides Released items. Say so, with a one-click way to see them.
  const hint = $('docHint'), pending = $('fStatus').value === 'Pending';
  hint.classList.toggle('hidden', !pending);
  if (pending) {
    hint.innerHTML = 'Showing only submissions still in the office. Released ones are hidden. <button type="button" id="showAll" class="underline">Show all statuses</button>';
    $('showAll').onclick = () => { $('fStatus').value = ''; loadSubs(); };
  }
  $('docEmpty').classList.toggle('hidden', subs.length > 0);
  $('docRows').innerHTML = subs.map((s, i) => `
    <tr class="border-t border-[#e1e7e3] hover:bg-black/5 cursor-pointer" data-i="${i}" tabindex="0">
      <td class="p-3 font-semibold tabnum whitespace-nowrap">${esc(s['Tracking No'])}</td>
      <td class="p-3">${esc(s['Campus'])}<div class="text-xs text-[#4b5b54]">${esc(s['Department'])}</div></td>
      <td class="p-3">${esc(s['Submitted By'])}</td>
      <td class="p-3 whitespace-nowrap tabnum">${esc(s['Date Received'])}${s.Overdue ? '<div class="text-xs font-semibold text-amber2">Overdue</div>' : ''}</td>
      <td class="p-3 whitespace-nowrap">${progressChip(s.fl, s.total)} ${progressChip(s.idp, s.total)}</td>
      <td class="p-3">${chip(s['Status'])}</td>
      <td class="p-3">${esc(s['Current Holder'])}</td>
    </tr>`).join('');
  $('docRows').querySelectorAll('tr').forEach(tr => {
    const open = () => openSub(subs[tr.dataset.i]['Tracking No']);
    tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); };
  });
}

// ---- Detail panel: ONE call loads the submission, its faculty and its history ----
async function openSub(tracking) {
  showError('dError', '');
  $('drawer').classList.remove('hidden');
  $('dNo').textContent = tracking;
  $('dStatus').innerHTML = '<span class="text-sm text-[#4b5b54]">Loading…</span>';
  $('dInfo').innerHTML = $('dLines').innerHTML = $('dTimeline').innerHTML = $('dAtt').innerHTML = $('dActions').innerHTML = '';
  try {
    cur = await api('subGet', { tracking });
    renderPanel();
  } catch (err) { showError('dError', err.message); }
}

function renderPanel() {
  const s = cur.submission;
  $('dStatus').innerHTML = chip(s['Status']);
  $('dInfo').innerHTML = [
    ['Campus', s['Campus']], ['Department', s['Department']], ['Term', `${s['Semester']}, SY ${s['School Year']}`],
    ['Submitted by', s['Submitted By']], ['Received', `${s['Date Received']} by ${s['Received By']}`],
    ['With now', s['Current Holder']], ['Released', s['Released To'] ? `${s['Date Released']} to ${s['Released To']}` : '–'],
    ['Remarks', s['Remarks'] || '–']
  ].map(([k, v]) => `<dt class="text-[#4b5b54]">${esc(k)}</dt><dd class="col-span-2">${esc(v)}</dd>`).join('');

  const att = String(s['Attachments'] || '').split(' | ').filter(Boolean);
  $('dAtt').innerHTML = att.length ? att.map(a => `<li>${esc(a)}</li>`).join('') : '<li class="list-none -ml-5 text-[#4b5b54]">None recorded</li>';

  renderLines();

  $('dTimeline').innerHTML = cur.log.map(l => `
    <li><div class="font-semibold">${esc(l['Action'])}</div>
      <div class="tabnum text-xs text-[#4b5b54]">${esc(l['Timestamp'])} · ${esc(l['Done By'])}</div>
      ${l['To'] ? `<div>${esc(l['To'])}</div>` : ''}${l['Remarks'] ? `<div class="italic">${esc(l['Remarks'])}</div>` : ''}</li>`).join('');

  const progs = uniq(boot.programs.filter(p => p.Campus === s['Campus'] && p.Department === s['Department']).map(p => p.Program));
  $('addProgram').innerHTML = options(progs);
  fillAddMajor();
  renderActions();
}

// Major dropdown of the "Add a faculty member" form follows the chosen program.
function fillAddMajor() {
  const s = cur.submission;
  const majors = uniq(boot.programs.filter(p => p.Campus === s['Campus'] && p.Department === s['Department'] && p.Program === $('addProgram').value && p.Major).map(p => p.Major));
  $('addMajor').innerHTML = majors.length ? options(majors, 'Choose major') : '<option value="">No major</option>';
  $('addMajor').disabled = !majors.length;
}
$('addProgram').onchange = () => cur && fillAddMajor();

// A tick cell shows the date it was received, or a button to mark it received now.
function tickCell(line, field) {
  const date = line[field === 'fl' ? 'Faculty Load Date' : 'IDP Date'];
  const by = line[field === 'fl' ? 'Faculty Load By' : 'IDP By'];
  const isAdmin = getSession().user.role === 'Admin';
  if (date) return `<span class="text-green-800 font-semibold">✓</span> <span class="text-xs text-[#4b5b54] tabnum">${esc(date)} · ${esc(by)}</span>` +
    (isAdmin ? ` <button type="button" class="text-xs underline text-red-700" data-untick="${esc(line['Line ID'])}|${field}">undo</button>` : '');
  return `<button type="button" class="btn-ghost text-xs" style="padding:.25rem .6rem" data-tick="${esc(line['Line ID'])}|${field}">Mark received</button>`;
}

function renderLines() {
  const L = cur.lines, fl = L.filter(l => l['Faculty Load Date']).length, idp = L.filter(l => l['IDP Date']).length;
  $('dProgress').textContent = `· Faculty Load ${fl}/${L.length} · IDP ${idp}/${L.length}`;
  $('dLines').innerHTML = L.map(l => `
    <tr class="border-t border-[#e1e7e3] align-top">
      <td class="py-2 pr-2">${esc(l['Faculty Name'])}<div class="text-xs text-[#4b5b54]">${esc(l['Program'])}${l['Major'] ? ' – ' + esc(l['Major']) : ''}</div></td>
      <td class="py-2 pr-2">${tickCell(l, 'fl')}</td>
      <td class="py-2">${tickCell(l, 'idp')}</td>
    </tr>`).join('');
  $('dLines').querySelectorAll('[data-tick]').forEach(b => b.onclick = () => tick(b, ...b.dataset.tick.split('|'), true));
  $('dLines').querySelectorAll('[data-untick]').forEach(b => b.onclick = () => tick(b, ...b.dataset.untick.split('|'), false));

  // keep the table behind the panel in step, without another trip to the server
  const row = subs.find(x => x['Tracking No'] === cur.submission['Tracking No']);
  if (row) { row.total = L.length; row.fl = fl; row.idp = idp; row.Incomplete = fl < L.length || idp < L.length; renderTable(); }
}

async function tick(btn, lineId, field, value) {
  showError('dError', ''); btn.disabled = true;
  try {
    const out = await api('subTick', { tracking: cur.submission['Tracking No'], lineId, field, value });
    const i = cur.lines.findIndex(l => l['Line ID'] === lineId);
    cur.lines[i] = out.line;
    renderLines();
    toast(value ? 'Marked as received' : 'Tick removed');
  } catch (err) { showError('dError', err.message); btn.disabled = false; }
}

$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('addName').value.trim();
  if (!name) return;
  showError('dError', ''); btnOf(e).disabled = true;
  try {
    await api('subAddLines', { tracking: cur.submission['Tracking No'], lines: [{ name, program: $('addProgram').value, major: $('addMajor').value }] });
    $('addName').value = '';
    cur = await api('subGet', { tracking: cur.submission['Tracking No'] });
    renderPanel(); toast('Faculty added');
  } catch (err) { showError('dError', err.message); }
  btnOf(e).disabled = false;
});

// ---- Status / release / reopen ----
function renderActions() {
  const s = cur.submission;
  const next = boot.flow[s['Status']] || [];
  const isAdmin = getSession().user.role === 'Admin';
  let html = '';

  if (next.length) html += `
    <form id="stForm" class="space-y-2"><h3 class="font-semibold">Update status</h3>
      <select id="stNew" aria-label="New status">${options(next)}</select>
      <input id="stHolder" placeholder="Who has it now? (optional)">
      <input id="stRemarks" placeholder="Remarks (optional)">
      <button class="btn">Save status</button></form>`;

  if (boot.releasable.includes(s['Status'])) html += `
    <form id="relForm" class="space-y-2 border-t border-[#e1e7e3] pt-4"><h3 class="font-semibold">Release out of the office</h3>
      <select id="relTo" aria-label="Release to">${options(boot.releaseTo, 'Choose office')}<option value="__other">Other…</option></select>
      <input id="relOther" class="hidden" placeholder="Office or person">
      <input id="relRemarks" placeholder="Remarks (optional)">
      <button class="btn">Release</button></form>`;

  if (s['Status'] === 'Released' && isAdmin) html += `
    <form id="reForm" class="space-y-2"><h3 class="font-semibold">Reopen (Admin)</h3>
      <input id="reWhy" placeholder="Reason for reopening" required><button class="btn">Reopen submission</button></form>`;
  $('dActions').innerHTML = html;

  const run = async (btn, action, payload, msg) => {
    showError('dError', ''); busy(btn, true);
    try {
      await api(action, { tracking: s['Tracking No'], ...payload });
      toast(msg);
      await loadSubs();
      openSub(s['Tracking No']);
    } catch (err) {
      busy(btn, false);
      // Releasing while some Faculty Load / IDP is missing: ask first, then send again with confirmation.
      if (action === 'subRelease' && err.message.startsWith('INCOMPLETE:')) {
        if (confirm(err.message.replace('INCOMPLETE: ', ''))) return run(btn, action, { ...payload, confirmIncomplete: true }, msg);
      } else showError('dError', err.message);
    }
  };

  if ($('stForm')) $('stForm').onsubmit = e => { e.preventDefault();
    run(btnOf(e), 'subStatus', { status: $('stNew').value, holder: $('stHolder').value.trim(), remarks: $('stRemarks').value.trim() }, 'Status saved'); };
  if ($('relForm')) {
    $('relTo').onchange = () => $('relOther').classList.toggle('hidden', $('relTo').value !== '__other');
    $('relForm').onsubmit = e => { e.preventDefault();
      const to = $('relTo').value === '__other' ? $('relOther').value.trim() : $('relTo').value;
      run(btnOf(e), 'subRelease', { to, remarks: $('relRemarks').value.trim() }, 'Released'); };
  }
  if ($('reForm')) $('reForm').onsubmit = e => { e.preventDefault(); run(btnOf(e), 'subReopen', { remarks: $('reWhy').value.trim() }, 'Reopened'); };
}

const closeDrawer = () => $('drawer').classList.add('hidden');
$('dClose').onclick = closeDrawer;
$('drawerBg').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
