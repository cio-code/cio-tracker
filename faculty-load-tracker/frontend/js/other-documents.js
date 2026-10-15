requireLogin();
renderShell('other-documents');

let boot = null;
let docs = [];

(async function init() {
  try {
    boot = await loadBoot();
    $('fType').innerHTML = options(boot.otherTypes || [], 'All types');
    const campuses = allowedCampuses(boot);
    $('fCampus').innerHTML = options(campuses, campuses.length > 1 ? 'All campuses' : '');
    await loadDocs();
  } catch (err) { toast(err.message); }
})();

let searchTimer;
$('fQ').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadDocs, 400); };
['fType', 'fCampus', 'fStatus'].forEach(id => $(id).onchange = loadDocs);

// The title is saved first in Description; an optional "| Ref: ..." follows it.
const splitDesc = d => { const [t, ...rest] = String(d || '').split(' | Ref: '); return { title: t, ref: rest.join(' | Ref: ') }; };

async function loadDocs() {
  try {
    docs = await api('docList', { q: $('fQ').value.trim(), docType: $('fType').value, campus: $('fCampus').value, status: $('fStatus').value });
    $('docEmpty').classList.toggle('hidden', docs.length > 0);
    // The default filter hides Released items. Say so, with a one-click way to see them.
    const hint = $('docHint'), pending = $('fStatus').value === 'Pending';
    hint.classList.toggle('hidden', !pending);
    if (pending) {
      hint.innerHTML = 'Showing only documents still in the office. Released ones are hidden. <button type="button" id="showAll" class="underline">Show all statuses</button>';
      $('showAll').onclick = () => { $('fStatus').value = ''; loadDocs(); };
    }
    $('docRows').innerHTML = docs.map((d, i) => `
      <tr class="border-t border-[#e1e7e3] hover:bg-black/5 cursor-pointer" data-i="${i}" tabindex="0">
        <td class="p-3 font-semibold tabnum whitespace-nowrap">${esc(d['Tracking No'])}<div class="text-xs font-normal text-[#4b5b54]">${esc(d['Doc Type'])}</div></td>
        <td class="p-3">${esc(splitDesc(d['Description']).title)}</td>
        <td class="p-3">${esc(d['Campus'])}<div class="text-xs text-[#4b5b54]">${esc(d['Department'])}</div></td>
        <td class="p-3">${esc(d['Source'])}</td>
        <td class="p-3 whitespace-nowrap tabnum">${esc(d['Date Received'])}${d.Overdue ? '<div class="text-xs font-semibold text-amber2">Overdue</div>' : ''}</td>
        <td class="p-3">${chip(d['Status'])}</td>
        <td class="p-3">${esc(d['Current Holder'])}</td>
      </tr>`).join('');
    $('docRows').querySelectorAll('tr').forEach(tr => {
      const open = () => openDoc(docs[tr.dataset.i]['Tracking No']);
      tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); };
    });
  } catch (err) { toast(err.message); }
}

// `row` is passed after an action, because a released document may no longer be in the filtered table.
async function openDoc(tracking, row) {
  showError('dError', '');
  const d = row || docs.find(x => x['Tracking No'] === tracking);
  if (!d) return;
  $('drawer').classList.remove('hidden');
  $('dNo').textContent = tracking;
  $('dStatus').innerHTML = chip(d['Status']);
  const t = splitDesc(d['Description']);
  $('dInfo').innerHTML = [
    ['Type', d['Doc Type']], ['Title', t.title], ['Reference', t.ref || '–'], ['Campus', d['Campus']], ['Office', d['Department']],
    ['From', d['Source']], ['Received', `${d['Date Received']} by ${d['Received By']}`], ['With now', d['Current Holder']],
    ['Released', d['Released To'] ? `${d['Date Released']} to ${d['Released To']}` : '–'], ['Remarks', d['Remarks'] || '–']
  ].map(([k, v]) => `<dt class="text-[#4b5b54]">${esc(k)}</dt><dd class="col-span-2">${esc(v)}</dd>`).join('');
  $('dTimeline').innerHTML = '<li class="text-[#4b5b54]">Loading…</li>';
  renderActions(d);
  try {
    const log = await api('timeline', { tracking });
    $('dTimeline').innerHTML = log.map(l => `
      <li><div class="font-semibold">${esc(l['Action'])}</div>
        <div class="tabnum text-xs text-[#4b5b54]">${esc(l['Timestamp'])} · ${esc(l['Done By'])}</div>
        ${l['To'] ? `<div>To: ${esc(l['To'])}</div>` : ''}${l['Remarks'] ? `<div class="italic">${esc(l['Remarks'])}</div>` : ''}</li>`).join('');
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
      <input id="reWhy" placeholder="Reason for reopening" required><button class="btn">Reopen document</button></form>`;
  $('dActions').innerHTML = html;

  const btnOf = e => e.submitter || e.target.querySelector('button');
  const run = async (btn, action, payload, msg) => {
    showError('dError', ''); busy(btn, true);
    try {
      await api(action, { tracking: d['Tracking No'], ...payload });
      toast(msg);
      await loadDocs();
      // look the document up directly: it may have left the filtered table (for example after Release)
      const fresh = docs.find(x => x['Tracking No'] === d['Tracking No'])
        || (await api('docList', { q: d['Tracking No'] })).find(x => x['Tracking No'] === d['Tracking No']);
      openDoc(d['Tracking No'], fresh);
    } catch (err) { showError('dError', err.message); busy(btn, false); }
  };
  if ($('stForm')) $('stForm').onsubmit = e => { e.preventDefault();
    run(btnOf(e), 'updateStatus', { status: $('stNew').value, holder: $('stHolder').value.trim(), remarks: $('stRemarks').value.trim() }, 'Status saved'); };
  if ($('relForm')) {
    $('relTo').onchange = () => $('relOther').classList.toggle('hidden', $('relTo').value !== '__other');
    $('relForm').onsubmit = e => { e.preventDefault();
      const to = $('relTo').value === '__other' ? $('relOther').value.trim() : $('relTo').value;
      run(btnOf(e), 'release', { to, remarks: $('relRemarks').value.trim() }, 'Released'); };
  }
  if ($('reForm')) $('reForm').onsubmit = e => { e.preventDefault(); run(btnOf(e), 'reopen', { remarks: $('reWhy').value.trim() }, 'Reopened'); };
}

const closeDrawer = () => $('drawer').classList.add('hidden');
$('dClose').onclick = closeDrawer;
$('drawerBg').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
