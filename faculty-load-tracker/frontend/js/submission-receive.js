requireLogin();
renderSubShell('sub-receive');

let boot = null;
let lastDept = '';

const choices = () => programMajorChoices(boot.programs, $('rCampus').value, $('rDept').value);

// ---- Campus -> department ----
function fillDepartments() {
  const depts = uniq(boot.programs.filter(p => p.Campus === $('rCampus').value).map(p => p.Department));
  $('rDept').innerHTML = options(depts, 'Choose department');
  lastDept = '';
}

// Changing the campus or department makes the existing names invalid, so ask first.
function confirmClear() {
  if (!$('lineRows').children.length) return true;
  return confirm('Changing this clears the faculty list below. Continue?');
}
$('rCampus').onchange = () => {
  if (!confirmClear()) { $('rCampus').value = $('rCampus').dataset.prev || ''; return; }
  $('rCampus').dataset.prev = $('rCampus').value; $('lineRows').innerHTML = ''; fillDepartments(); updateCount();
};
$('rDept').onchange = () => {
  if (!confirmClear()) { $('rDept').value = lastDept; return; }
  lastDept = $('rDept').value; $('lineRows').innerHTML = ''; updateCount();
};

// ---- Faculty rows: ONE "Program / Major" dropdown per name. Choosing it copies DOWN to the names below. ----
const allRows = () => [...$('lineRows').children];

function addRow(name, key) {
  const tr = document.createElement('tr');
  tr.className = 'border-t border-[#e1e7e3]';
  tr.innerHTML = `
    <td class="py-1.5 pr-2"><input class="lName" aria-label="Faculty name" value="${esc(name)}"></td>
    <td class="py-1.5 pr-2"><select class="lPM" aria-label="Program and major">${pmOptions(choices(), 'Choose program / major')}</select></td>
    <td class="py-1.5 px-2 text-center"><input type="checkbox" class="lFL" aria-label="Faculty Load received" style="width:1.1rem;height:1.1rem"></td>
    <td class="py-1.5 px-2 text-center"><input type="checkbox" class="lIDP" aria-label="IDP received" style="width:1.1rem;height:1.1rem"></td>
    <td class="py-1.5 text-right"><button type="button" class="lDel text-sm underline text-red-700" aria-label="Remove row">Remove</button></td>`;
  $('lineRows').appendChild(tr);
  const sel = tr.querySelector('.lPM');
  sel.value = key;
  // Chosen here -> every name BELOW copies the same Program / Major.
  sel.onchange = () => {
    const rows = allRows();
    rows.slice(rows.indexOf(tr) + 1).forEach(r => { r.querySelector('.lPM').value = sel.value; });
  };
  tr.querySelector('.lDel').onclick = () => { tr.remove(); updateCount(); };
}

function updateCount() {
  const n = $('lineRows').children.length;
  $('lineCount').textContent = n ? n + ' faculty in the list' : 'No faculty added yet.';
}

// New names copy the Program / Major of the last name in the list.
$('addNamesBtn').onclick = () => {
  showError('gError', '');
  if (!$('rDept').value || !choices().length) return showError('gError', 'Choose the campus and department first.');
  const names = $('pasteNames').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) return showError('gError', 'Type or paste at least one name.');
  const rows = allRows(), last = rows[rows.length - 1];
  const key = last ? last.querySelector('.lPM').value : '';
  names.forEach(n => addRow(n, key));
  $('pasteNames').value = ''; updateCount();
};

$('allFL').onclick = () => tickAll('.lFL');
$('allIDP').onclick = () => tickAll('.lIDP');
function tickAll(sel) {
  const boxes = [...document.querySelectorAll('#lineRows ' + sel)];
  const on = boxes.some(b => !b.checked);
  boxes.forEach(b => b.checked = on);
}

function defaultSchoolYear() {
  const d = new Date(), y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

// ---- Start ----
(async function init() {
  try {
    boot = await loadBoot();
    const campuses = allowedCampuses(boot);
    $('rCampus').innerHTML = options(campuses, 'Choose campus');
    if (campuses.length === 1) $('rCampus').value = campuses[0];
    $('rCampus').dataset.prev = $('rCampus').value;
    fillDepartments();
    $('rSY').value = defaultSchoolYear();
    $('attList').innerHTML = boot.attachments && boot.attachments.length
      ? boot.attachments.map((a, i) => `<label class="flex items-start gap-2 font-normal" style="margin:0"><input type="checkbox" class="att" value="${esc(a)}" style="width:1.1rem;height:1.1rem;margin-top:.1rem"> <span>${i + 1}. ${esc(a)}</span></label>`).join('')
      : '<p class="text-[#4b5b54]">No checklist yet. Run setupSheets in Apps Script, then click "Refresh lists".</p>';
    updateCount();
  } catch (err) { showError('rError', err.message); }
})();

// ---- Save ----
$('receiveForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('rError', '');
  const byKey = {};
  choices().forEach(c => { byKey[c.key] = c; });
  const rows = allRows().filter(tr => tr.querySelector('.lName').value.trim());
  if (!rows.length) return showError('rError', 'Add at least one faculty name.');
  const missing = rows.find(tr => !byKey[tr.querySelector('.lPM').value]);
  if (missing) return showError('rError', 'Choose the program / major for ' + missing.querySelector('.lName').value.trim() + '.');
  const lines = rows.map(tr => {
    const c = byKey[tr.querySelector('.lPM').value];
    return { name: tr.querySelector('.lName').value.trim(), program: c.program, major: c.major,
             fl: tr.querySelector('.lFL').checked, idp: tr.querySelector('.lIDP').checked };
  });

  const data = {
    campus: $('rCampus').value, department: $('rDept').value, semester: $('rSem').value,
    schoolYear: $('rSY').value.trim(), source: $('rSource').value.trim(), remarks: $('rRemarks').value.trim(),
    attachments: [...document.querySelectorAll('.att:checked')].map(c => c.value), lines
  };
  busy($('rBtn'), true, 'Saving…');
  try {
    const out = await api('subReceive', data);
    $('slipNo').textContent = out.tracking;
    $('slipInfo').innerHTML = [
      `${data.campus} Campus · ${data.department}`, `${data.semester}, SY ${data.schoolYear}`,
      'Submitted by: ' + data.source, 'Received: ' + out.receivedAt + ' by ' + getSession().user.name,
      data.attachments.length ? 'Attachments: ' + data.attachments.join('; ') : ''
    ].filter(Boolean).map(t => `<div>${esc(t)}</div>`).join('');
    const mark = on => on ? '✓' : '';
    $('slipLines').innerHTML = lines.map(l => `<tr><td class="border border-[#c9d3cd] p-2">${esc(l.name)}</td>
      <td class="border border-[#c9d3cd] p-2">${esc(l.program)}${l.major ? ' – ' + esc(l.major) : ''}</td>
      <td class="border border-[#c9d3cd] p-2 text-center">${mark(l.fl)}</td><td class="border border-[#c9d3cd] p-2 text-center">${mark(l.idp)}</td></tr>`).join('');
    $('receiveForm').classList.add('hidden');
    $('slipWrap').classList.remove('hidden');
  } catch (err) { showError('rError', err.message); }
  busy($('rBtn'), false);
});

$('anotherBtn').onclick = () => {
  $('slipWrap').classList.add('hidden');
  $('receiveForm').classList.remove('hidden');
  ['rSource', 'rRemarks', 'pasteNames'].forEach(id => $(id).value = '');
  document.querySelectorAll('.att').forEach(c => c.checked = false);
  $('lineRows').innerHTML = ''; updateCount();
};