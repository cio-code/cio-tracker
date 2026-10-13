requireLogin();
const WS = renderShell('dashboard');          // 'Faculty Load' or 'DLP'
$('pageTitle').textContent = 'Dashboard · ' + WS;

(async function loadStats() {
  try {
    const s = await api('stats', { docType: WS });
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
      : `<tr><td class="p-3 text-[#4b5b54]" colspan="3">No ${esc(WS)} documents yet. Use "Receive" to log the first one.</td></tr>`;
  } catch (err) { toast(err.message); }
})();
