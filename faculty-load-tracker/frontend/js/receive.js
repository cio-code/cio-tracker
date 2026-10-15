requireLogin();
renderShell('receive');

let boot = null;

const programsOfDept = () => uniq(boot.programs.filter(p => p.Campus === $('rCampus').value && p.Department === $('rDept').value).map(p => p.Program));

// ---- Campus -> department ----
function fillDepartments() {
  const depts = uniq(boot.programs.filter(p => p.Campus === $('rCampus').value).map(p => p.Department));
  $('rDept').innerHTML = options(depts, 'Choose department');
  refreshProgramSelects();
}

// Majors of one program in the chosen campus + department (from the Programs sheet).
const majorsOf = program => uniq(boot.programs.filter(p => p.Campus === $('rCampus').value && p.Department === $('rDept').value && p.Program === program && p.Major).map(p => p.Major));

// Fills a row's Major dropdown. Locked when the program has no majors.
function refreshMajor(tr) {
  const sel = tr.querySelector('select.lMajor'), majors = majorsOf(tr.querySelector('select.lProgram').value), keep = sel.value;
  if (majors.length) { sel.innerHTML = options(majors, 'Choose major'); sel.disabled = false; sel.value = majors.includes(keep) ? keep : ''; }
  else { sel.innerHTML = '<option value="">No major</option>'; sel.disabled = true; }
}

// Every faculty row has a program dropdown that follows the chosen department.
function refreshProgramSelects() {
  const progs = programsOfDept();
  document.querySelectorAll('#lineRows select.lProgram').forEach(sel => {
    const keep = sel.value;
    sel.innerHTML = options(progs);
    sel.value = progs.includes(keep) ? keep : (progs[0] || '');
    refreshMajor(sel.closest('tr'));
  });
}

// ---- Faculty rows ----
function addRow(name = '', program = '') {
  const progs = programsOfDept();
  const last = document.querySelector('#lineRows tr:last-child select.lProgram');
  const tr = document.createElement('tr');
  tr.className = 'border-t border-[#e1e7e3]';
  tr.innerHTML = `
    <td class="py-1.5 pr-2"><input class="lName" aria-label="Faculty name" value="${esc(name)}"></td>
    <td class="py-1.5 pr-2"><select class="lProgram" aria-label="Program">${options(progs)}</select></td>
    <td class="py-1.5 pr-2"><select class="lMajor" aria-label="Major"></select></td>
    <td class="py-1.5 px-2 text-center"><input type="checkbox" class="lFL" aria-label="Faculty Load received" style="width:1.1rem;height:1.1rem"></td>
    <td class="py-1.5 px-2 text-center"><input type="checkbox" class="lIDP" aria-label="IDP received" style="width:1.1rem;height:1.1rem"></td>
    <td class="py-1.5 text-right"><button type="button" class="lDel text-sm underline text-red-700" aria-label="Remove row">Remove</button></td>`;
  $('lineRows').appendChild(tr);
  const sel = tr.querySelector('select.lProgram');
  sel.value = progs.includes(program) ? program : (last && progs.includes(last.value) ? last.value : (progs[0] || ''));
  sel.onchange = () => refreshMajor(tr);
  refreshMajor(tr);
  tr.querySelector('.lDel').onclick = () => tr.remove();
  return tr;
}

$('addRowBtn').onclick = () => addRow().querySelector('.lName').focus();
$('pasteToggle').onclick = () => $('pasteBox').classList.toggle('hidden');
$('pasteAdd').onclick = () => {
  $('pasteNames').value.split('\n').map(s => s.trim()).filter(Boolean).forEach(n => addRow(n));
  $('pasteNames').value = ''; $('pasteBox').classList.add('hidden');
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
    fillDepartments();
    $('rSY').value = defaultSchoolYear();
    $('rCampus').onchange = fillDepartments;
    $('rDept').onchange = refreshProgramSelects;
    $('attList').innerHTML = boot.attachments.length
      ? boot.attachments.map((a, i) => `<label class="flex items-start gap-2 font-normal" style="margin:0"><input type="checkbox" class="att" value="${esc(a)}" style="width:1.1rem;height:1.1rem;margin-top:.1rem"> <span>${i + 1}. ${esc(a)}</span></label>`).join('')
      : '<p class="text-[#4b5b54]">No checklist yet. Add an "Attachments" row in the Settings sheet.</p>';
    addRow();
    initDocumentTypes();
  } catch (err) { showError('rError', err.message); }
})();

// ---- Save ----
$('receiveForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('rError', '');
  const lines = [...document.querySelectorAll('#lineRows tr')].map(tr => ({
    name: tr.querySelector('.lName').value.trim(), program: tr.querySelector('.lProgram').value, major: tr.querySelector('.lMajor').value,
    fl: tr.querySelector('.lFL').checked, idp: tr.querySelector('.lIDP').checked
  })).filter(l => l.name);
  if (!lines.length) return showError('rError', 'Add at least one faculty name.');

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
  ['rSource', 'rRemarks'].forEach(id => $(id).value = '');
  document.querySelectorAll('.att').forEach(c => c.checked = false);
  $('lineRows').innerHTML = ''; addRow();
};


// =====================================================================
// Document type chooser: Faculty submission (form above) or an "other" document (memo, letter, order...)
// The list of other types is the "DocTypes" row in the Settings sheet.
// =====================================================================
const SUBMISSION = '__submission';

function initDocumentTypes() {
  const others = boot.otherTypes || [];
  $('rType').innerHTML = `<option value="${SUBMISSION}">Faculty submission (Faculty Load + IDP)</option>` +
    others.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('rType').onchange = showType;
  // No other types arrived: the backend is old, or the Settings row is missing. Say so instead of staying silent.
  $('typeHint').textContent = others.length ? '' :
    'No other document types found. In Apps Script paste the newest Code.gs, run setupSheets, deploy a New version, then click "Refresh lists" above.';
  $('typeHint').classList.toggle('hidden', others.length > 0);

  const campuses = allowedCampuses(boot);
  $('oCampus').innerHTML = options(campuses, 'Choose campus');
  if (campuses.length === 1) $('oCampus').value = campuses[0];
  $('oCampus').onchange = fillOfficeSuggestions;
  fillOfficeSuggestions();
  showType();
}

// Office suggestions follow the campus (you can still type any office).
function fillOfficeSuggestions() {
  const depts = uniq(boot.programs.filter(p => p.Campus === $('oCampus').value).map(p => p.Department));
  const offices = ['Registrar', 'Accounting Office', 'HR Office', 'Library', "President's Office", 'VPAA Office', "Dean's Office"];
  $('oDeptList').innerHTML = uniq(depts.concat(offices)).map(d => `<option value="${esc(d)}">`).join('');
}

// Show the right form and hide both receipts.
function showType() {
  const isSubmission = $('rType').value === SUBMISSION;
  $('slipWrap').classList.add('hidden'); $('oSlipWrap').classList.add('hidden');
  $('receiveForm').classList.toggle('hidden', !isSubmission);
  $('oForm').classList.toggle('hidden', isSubmission);
}

$('oForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('oError', '');
  const data = {
    docType: $('rType').value, campus: $('oCampus').value, department: $('oDept').value.trim(),
    title: $('oTitle').value.trim(), reference: $('oRef').value.trim(), source: $('oSource').value.trim(), remarks: $('oRemarks').value.trim()
  };
  busy($('oBtn'), true, 'Saving…');
  try {
    const out = await api('docReceive', data);
    $('oSlipNo').textContent = out.tracking;
    $('oSlipInfo').innerHTML = [
      data.docType + ' · ' + data.title + (data.reference ? ' (' + data.reference + ')' : ''),
      `${data.campus} Campus · ${data.department}`, 'Received from: ' + data.source,
      'Received: ' + out.receivedAt + ' by ' + getSession().user.name
    ].map(t => `<div>${esc(t)}</div>`).join('');
    $('oForm').classList.add('hidden');
    $('oSlipWrap').classList.remove('hidden');
  } catch (err) { showError('oError', err.message); }
  busy($('oBtn'), false);
});

$('oAnother').onclick = () => {
  $('oSlipWrap').classList.add('hidden');
  $('oForm').classList.remove('hidden');
  ['oTitle', 'oRef', 'oSource', 'oRemarks'].forEach(id => $(id).value = '');
};
