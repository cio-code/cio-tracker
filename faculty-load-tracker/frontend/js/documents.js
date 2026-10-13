requireLogin();
renderShell('documents');

let boot = null;
let docs = [];   // documents currently shown in the table

// ---- Start ----
(async function init() {
  try {
    boot = await loadBoot();
    const campuses = allowedCampuses(boot);
    $('fCampus').innerHTML = options(campuses, campuses.length > 1 ? 'All campuses' : '');
    await loadDocs();
  } catch (err) { toast(err.message); }
})();

// ---- Filters ----
let searchTimer;
$('fQ').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadDocs, 400); };
$('fType').onchange = loadDocs;
$('fCampus').onchange = loadDocs;
$('fStatus').onchange = loadDocs;

// ---- Table ----
async function loadDocs() {
  try {
    docs = await api('list', { q: $('fQ').value.trim(), docType: $('fType').value, campus: $('fCampus').value, status: $('fStatus').value });
    $('docEmpty').classList.toggle('hidden', docs.length > 0);
    $('docRows').innerHTML = docs.map((d, i) => `
      <tr class="border-t border-[#e1e7e3] hover:bg-pine-soft/50 cursor-pointer" data-i="${i}" tabindex="0">
        <td class="p-3 font-semibold tabnum whitespace-nowrap">${esc(d['Tracking No'])}<div class="text-xs font-normal text-[#4b5b54]">${esc(d['Doc Type'])}</div></td>
        <td class="p-3">${esc(d['Campus'])} · ${esc(d['Program'] || d['Department'])}</td>
        <td class="p-3">${esc(d['Faculty Name'] || (d['Doc Type'] === 'DLP' ? '–' : 'Whole department'))}<div class="text-xs text-[#4b5b54]">${esc(d['Source'])}</div></td>
        <td class="p-3 whitespace-nowrap tabnum">${esc(d['Date Received'])}${d.Overdue ? '<div class="text-xs font-semibold text-amber2">Overdue</div>' : ''}</td>
        <td class="p-3">${chip(d['Status'])}</td>
        <td class="p-3">${esc(d['Current Holder'])}</td>
      </tr>`).join('');
    $('docRows').querySelectorAll('tr').forEach(tr => {
      const open = () => openDoc(docs[tr.dataset.i]['Tracking No']);
      tr.onclick = open;
      tr.onkeydown = e => { if (e.key === 'Enter') open(); };
    });
  } catch (err) { toast(err.message); }
}

// ---- Detail drawer ----
async function openDoc(tracking) {
  showError('dError', '');
  const d = docs.find(x => x['Tracking No'] === tracking);
  if (!d) return;
  $('drawer').classList.remove('hidden');
  $('dNo').textContent = tracking;
  $('dStatus').innerHTML = chip(d['Status']);

  const dlp = d['Doc Type'] === 'DLP';
  const rows = [
    ['Type', d['Doc Type']],
    ['Campus', d['Campus']], ['Department', d['Department']],
    ['Program', d['Program'] + (d['Major'] ? ' – ' + d['Major'] : '')],
    [dlp ? 'Teacher' : 'Faculty', d['Faculty Name'] || 'Whole department'],
    ...(dlp && d['Description'] ? [['Subject', String(d['Description']).replace(/^Subject: /, '')]] : []),
    ['Term', `${d['Semester']}, SY ${d['School Year']}`],
    ['Submitted by', d['Source']],
    ['Received', `${d['Date Received']} by ${d['Received By']}`],
    ['With now', d['Current Holder']],
    ['Released', d['Released To'] ? `${d['Date Released']} to ${d['Released To']}` : '–'],
    ['Remarks', d['Remarks'] || '–']
  ];
  $('dInfo').innerHTML = rows.map(([k, v]) => `<dt class="text-[#4b5b54]">${esc(k)}</dt><dd class="col-span-2">${esc(v)}</dd>`).join('');

  $('dTimeline').innerHTML = '<li class="text-[#4b5b54]">Loading…</li>';
  renderActions(d);
  try {
    const log = await api('timeline', { tracking });
    $('dTimeline').innerHTML = log.map(l => `
      <li><div class="font-semibold">${esc(l['Action'])}</div>
        <div class="tabnum text-xs text-[#4b5b54]">${esc(l['Timestamp'])} · ${esc(l['Done By'])}</div>
        ${l['To'] ? `<div>To: ${esc(l['To'])}</div>` : ''}
        ${l['Remarks'] ? `<div class="italic">${esc(l['Remarks'])}</div>` : ''}</li>`).join('');
  } catch (err) { showError('dError', err.message); }
}

function renderActions(d) {
  const next = boot.flow[d['Status']] || [];
  const isAdmin = getSession().user.role === 'Admin';
  let html = '';

  if (next.length) html += `
    <form id="stForm" class="space-y-2"><h3 class="font-semibold">Update status</h3>
      <select id="stNew" aria-label="New status">${options(next)}</select>
      <input id="stHolder" placeholder="Who has it now? (optional)">
      <input id="stRemarks" placeholder="Remarks (optional)">
      <button class="btn">Save status</button></form>`;

  if (boot.releasable.includes(d['Status'])) html += `
    <form id="relForm" class="space-y-2 border-t border-[#e1e7e3] pt-4"><h3 class="font-semibold">Release out of the office</h3>
      <select id="relTo" aria-label="Release to">${options(boot.releaseTo, 'Choose office')}<option value="__other">Other…</option></select>
      <input id="relOther" class="hidden" placeholder="Office or person">
      <input id="relRemarks" placeholder="Remarks (optional)">
      <button class="btn">Release</button></form>`;

  if (d['Status'] === 'Released' && isAdmin) html += `
    <form id="reForm" class="space-y-2"><h3 class="font-semibold">Reopen (Admin)</h3>
      <input id="reWhy" placeholder="Reason for reopening" required>
      <button class="btn">Reopen document</button></form>`;

  $('dActions').innerHTML = html;

  // Runs an action, then refreshes the table and the drawer so the new history shows.
  const run = async (btn, action, payload, msg) => {
    showError('dError', '');
    busy(btn, true);
    try {
      await api(action, { tracking: d['Tracking No'], ...payload });
      toast(msg);
      await loadDocs();
      openDoc(d['Tracking No']);
    } catch (err) { showError('dError', err.message); busy(btn, false); }
  };

  if ($('stForm')) $('stForm').onsubmit = e => {
    e.preventDefault();
    run(e.submitter, 'updateStatus',
      { status: $('stNew').value, holder: $('stHolder').value.trim(), remarks: $('stRemarks').value.trim() }, 'Status saved');
  };
  if ($('relForm')) {
    $('relTo').onchange = () => $('relOther').classList.toggle('hidden', $('relTo').value !== '__other');
    $('relForm').onsubmit = e => {
      e.preventDefault();
      const to = $('relTo').value === '__other' ? $('relOther').value.trim() : $('relTo').value;
      run(e.submitter, 'release', { to, remarks: $('relRemarks').value.trim() }, 'Released');
    };
  }
  if ($('reForm')) $('reForm').onsubmit = e => {
    e.preventDefault();
    run(e.submitter, 'reopen', { remarks: $('reWhy').value.trim() }, 'Reopened');
  };
}

const closeDrawer = () => $('drawer').classList.add('hidden');
$('dClose').onclick = closeDrawer;
$('drawerBg').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
