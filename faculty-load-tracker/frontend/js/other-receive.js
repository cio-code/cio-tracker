requireLogin();
renderShell('other-receive');

let boot = null;

// Office / department suggestions follow the chosen campus (you can still type any office).
function fillSuggestions() {
  const depts = uniq(boot.programs.filter(p => p.Campus === $('rCampus').value).map(p => p.Department));
  const offices = ['Registrar', 'Accounting Office', 'HR Office', 'Library', "President's Office", "VPAA Office", "Dean's Office"];
  $('deptList').innerHTML = uniq(depts.concat(offices)).map(d => `<option value="${esc(d)}">`).join('');
}

(async function init() {
  try {
    boot = await loadBoot();
    const types = boot.otherTypes || [];
    $('rType').innerHTML = types.length ? options(types, 'Choose type') : options([], 'No types yet (see Settings sheet)');
    const campuses = allowedCampuses(boot);
    $('rCampus').innerHTML = options(campuses, 'Choose campus');
    if (campuses.length === 1) $('rCampus').value = campuses[0];
    $('rCampus').onchange = fillSuggestions;
    fillSuggestions();
  } catch (err) { showError('rError', err.message); }
})();

$('receiveForm').addEventListener('submit', async e => {
  e.preventDefault();
  showError('rError', '');
  const data = {
    docType: $('rType').value, campus: $('rCampus').value, department: $('rDept').value.trim(),
    title: $('rTitle').value.trim(), reference: $('rRef').value.trim(), source: $('rSource').value.trim(), remarks: $('rRemarks').value.trim()
  };
  busy($('rBtn'), true, 'Saving…');
  try {
    const out = await api('docReceive', data);
    $('slipNo').textContent = out.tracking;
    $('slipInfo').innerHTML = [
      data.docType + ' · ' + data.title + (data.reference ? ' (' + data.reference + ')' : ''),
      `${data.campus} Campus · ${data.department}`, 'Received from: ' + data.source,
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
  ['rTitle', 'rRef', 'rSource', 'rRemarks'].forEach(id => $(id).value = '');
};
