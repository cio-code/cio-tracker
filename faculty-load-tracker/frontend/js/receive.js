requireLogin();

// Each receive page sets window.PAGE_TYPE to 'Faculty Load' or 'DLP'.
const TYPE = window.PAGE_TYPE;
const isDLP = TYPE === 'DLP';
renderShell(isDLP ? 'receive-dlp' : 'receive-fl');

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

// Only the Faculty Load page has a Major dropdown.
function fillMajors() {
  const sel = $('rMajor');
  if (!sel) return;
  const c = $('rCampus').value, d = $('rDept').value, p = $('rProgram').value;
  const majors = uniq(boot.programs
    .filter(x => x.Campus === c && x.Department === d && x.Program === p && x.Major)
    .map(x => x.Major));
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

const val = id => ($(id) ? $(id).value.trim() : '');

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
      docType: TYPE,
      campus: $('rCampus').value, department: $('rDept').value, program: $('rProgram').value,
      major: val('rMajor'), facultyName: val('rFaculty'),
      subject: val('rSubject'), period: val('rPeriod'),
      semester: $('rSem').value, schoolYear: val('rSY'),
      source: val('rSource'), remarks: val('rRemarks')
    };
    const out = await api('receive', data);

    $('slipTitle').textContent = `${TYPE} received. Write this number on the document.`;
    $('slipNo').textContent = out.tracking;
    const lines = [
      `${data.campus} Campus · ${data.department}`,
      data.program + (data.major ? ' – ' + data.major : ''),
      isDLP ? `Teacher: ${data.facultyName}` : (data.facultyName ? 'Faculty: ' + data.facultyName : 'Whole-department batch')
    ];
    if (isDLP) lines.push('Subject: ' + data.subject + (data.period ? ' (' + data.period + ')' : ''));
    lines.push(`${data.semester}, SY ${data.schoolYear}`, 'Submitted by: ' + data.source,
               'Received: ' + out.receivedAt + ' by ' + getSession().user.name);
    $('slipInfo').innerHTML = lines.map(t => `<div>${esc(t)}</div>`).join('');

    $('receiveForm').classList.add('hidden');
    $('slipWrap').classList.remove('hidden');
  } catch (err) { showError('rError', err.message); }
  busy($('rBtn'), false);
});

$('anotherBtn').onclick = () => {
  $('slipWrap').classList.add('hidden');
  $('receiveForm').classList.remove('hidden');
  ['rFaculty', 'rSubject', 'rPeriod', 'rSource', 'rRemarks'].forEach(id => { if ($(id)) $(id).value = ''; });
  fillMajors();
};
