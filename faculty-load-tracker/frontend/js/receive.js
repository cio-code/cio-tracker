requireLogin();
renderShell('receive');

let boot = null;

// ---- Cascading dropdowns: campus -> department -> program -> major ----
function fillDepartments() {
  const c = $('rCampus').value;
  const depts = uniq(boot.programs.filter(p => p.Campus === c).map(p => p.Department));
  $('rDept').innerHTML = options(depts, 'Choose department');
  fillPrograms();
}

function fillPrograms() {
  const c = $('rCampus').value, d = $('rDept').value;
  const progs = uniq(boot.programs.filter(p => p.Campus === c && p.Department === d).map(p => p.Program));
  $('rProgram').innerHTML = d
    ? options(progs, 'Choose program') + `<option>${esc(boot.whole)}</option>`
    : options([], 'Choose department first');
  fillMajors();
}

function fillMajors() {
  const c = $('rCampus').value, d = $('rDept').value, p = $('rProgram').value;
  const majors = uniq(boot.programs
    .filter(x => x.Campus === c && x.Department === d && x.Program === p && x.Major)
    .map(x => x.Major));
  const sel = $('rMajor');
  if (!sel) return;
  if (!p || p === boot.whole) {
    sel.innerHTML = '<option value="">Not applicable</option>';
    sel.disabled = true;
  } else if (majors.length === 0) {
    sel.innerHTML = '<option value="">No major for this program</option>';
    sel.disabled = true;
  } else {
    sel.innerHTML = options(majors, 'Choose major');
    sel.disabled = false;
  }
  sel.required = !sel.disabled;
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
    $('rDept').onchange = fillPrograms;
    $('rProgram').onchange = fillMajors;
  } catch (err) { showError('rError', err.message); }
})();

// ---- Save ----
$('receiveForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('rError', '');
  busy($('rBtn'), true, 'Saving…');
  try {
    const data = {
      campus: $('rCampus').value, department: $('rDept').value, program: $('rProgram').value,
      major: $('rMajor').value.trim(), facultyName: $('rFaculty').value.trim(), semester: $('rSem').value,
      schoolYear: $('rSY').value.trim(), source: $('rSource').value.trim(), remarks: $('rRemarks').value.trim()
    };
    const out = await api('receive', data);

    $('slipNo').textContent = out.tracking;
    $('slipInfo').innerHTML = [
      `${data.campus} Campus · ${data.department}`,
      data.program + (data.major ? ' – ' + data.major : ''),
      `${data.semester}, SY ${data.schoolYear}`,
      data.facultyName ? 'Faculty: ' + data.facultyName : 'Whole-department batch',
      'Submitted by: ' + data.source,
      'Received: ' + out.receivedAt + ' by ' + getSession().user.name
    ].map(t => `<div>${esc(t)}</div>`).join('');

    $('receiveForm').classList.add('hidden');
    $('slipWrap').classList.remove('hidden');
  } catch (err) { showError('rError', err.message); }
  busy($('rBtn'), false);
});

$('anotherBtn').onclick = () => {
  $('slipWrap').classList.add('hidden');
  $('receiveForm').classList.remove('hidden');
  ['rFaculty', 'rSource', 'rRemarks'].forEach(id => $(id).value = '');
  fillMajors();
};
