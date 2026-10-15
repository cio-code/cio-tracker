requireLogin();
renderShell('dashboard');

(async function loadStats() {
  try {
    const s = await api('subStats');
    $('stReceived').textContent = s.receivedToday;
    $('stPending').textContent = s.pending;
    $('stReleased').textContent = s.releasedToday;
    $('stOverdue').textContent = s.overdue;
    $('stIncomplete').textContent = s.incomplete;
    $('stMissFL').textContent = s.missingFL;
    $('stMissIDP').textContent = s.missingIDP;

    const warn = n => n ? 'text-amber2 font-semibold' : '';
    const rows = Object.entries(s.byCampus);
    $('campusRows').innerHTML = rows.length
      ? rows.map(([c, v]) => `
          <tr class="border-t border-[#e1e7e3]">
            <td class="p-3">${esc(c)}</td>
            <td class="p-3 text-right tabnum">${v.pending}</td>
            <td class="p-3 text-right tabnum ${warn(v.overdue)}">${v.overdue}</td>
            <td class="p-3 text-right tabnum ${warn(v.missingFL)}">${v.missingFL}</td>
            <td class="p-3 text-right tabnum ${warn(v.missingIDP)}">${v.missingIDP}</td>
          </tr>`).join('')
      : `<tr><td class="p-3 text-[#4b5b54]" colspan="5">Nothing received yet. Use "Receive a submission" to log the first one.</td></tr>`;
  } catch (err) { toast(err.message); }
})();

// Other documents (memos, letters, orders...) have their own counts.
(async function loadOtherDocs() {
  try {
    const s = await api('docStats');
    $('odReceived').textContent = s.receivedToday; $('odPending').textContent = s.pending;
    $('odReleased').textContent = s.releasedToday; $('odOverdue').textContent = s.overdue;
  } catch (err) { /* the rest of the dashboard still works */ }
})();
