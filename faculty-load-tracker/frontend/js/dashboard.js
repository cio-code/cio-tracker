requireLogin();
renderShell('dashboard');

(async function loadStats() {
  try {
    const s = await api('stats');
    $('stReceived').textContent = s.receivedToday;
    $('stPending').textContent = s.pending;
    $('stReleased').textContent = s.releasedToday;
    $('stOverdue').textContent = s.overdue;

    const rows = Object.entries(s.byCampus);
    $('campusRows').innerHTML = rows.length
      ? rows.map(([c, v]) => `
          <tr class="border-t border-[#e1e7e3]">
            <td class="p-3">${esc(c)}</td>
            <td class="p-3 text-right tabnum">${v.pending}</td>
            <td class="p-3 text-right tabnum ${v.overdue ? 'text-amber2 font-semibold' : ''}">${v.overdue}</td>
          </tr>`).join('')
      : `<tr><td class="p-3 text-[#4b5b54]" colspan="3">Nothing received yet. Use "Receive a document" to log the first one.</td></tr>`;
  } catch (err) { toast(err.message); }
})();
