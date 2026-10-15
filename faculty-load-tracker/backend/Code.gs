/**
 * FACULTY LOAD TRACKER - BACKEND (Google Apps Script)
 * ---------------------------------------------------
 * Paste this whole file into: Google Sheet > Extensions > Apps Script.
 * The script is "bound" to the sheet, so it reads/writes that sheet directly.
 *
 * FIRST TIME:  run setupSheets() once from the editor.
 * ADD STAFF:   edit the constants inside addUser(), then run it.
 * PUBLISH:     Deploy > Manage deployments > pencil > Version: New version > Deploy
 *              Execute as: Me | Who has access: Anyone
 *
 * ADDED (section 7): department SUBMISSIONS with a faculty checklist (Faculty Load + IDP ticks).
 * ADDED (section 8): OTHER DOCUMENTS (memos, letters, travel orders...). The types are listed in the Settings sheet (DocTypes).
 * Everything else in this file works exactly as before.
 */

// ===================== 1. SETTINGS =====================
const TZ = 'Asia/Manila';
const SHEETS = { DOCS: 'Documents', LOG: 'Movements', USERS: 'Users', PROGRAMS: 'Programs', SETTINGS: 'Settings',
  SUBS: 'Submissions', LINES: 'Faculty Lines' };

const DOC_HEADERS = ['Tracking No', 'Doc Type', 'Campus', 'Department', 'Program', 'Major', 'Faculty Name',
  'Semester', 'School Year', 'Description', 'Source', 'Date Received', 'Received By', 'Status',
  'Current Holder', 'Released To', 'Released By', 'Date Released', 'Remarks', 'Last Updated'];
const LOG_HEADERS = ['Log ID', 'Tracking No', 'Action', 'From', 'To', 'Done By', 'Timestamp', 'Remarks'];
const USER_HEADERS = ['Name', 'Role', 'Campus', 'PIN Hash', 'Active'];
const PROGRAM_HEADERS = ['Campus', 'Department', 'Program', 'Major', 'Active'];
const DATE_COLS = ['Date Received', 'Date Released', 'Last Updated', 'Timestamp', 'Faculty Load Date', 'IDP Date'];

// Submissions: one row per department batch. Faculty Lines: one row per faculty member inside it.
const SUB_HEADERS = ['Tracking No', 'Campus', 'Department', 'Semester', 'School Year', 'Submitted By', 'Date Received',
  'Received By', 'Status', 'Current Holder', 'Released To', 'Released By', 'Date Released', 'Attachments', 'Remarks', 'Last Updated'];
const LINE_HEADERS = ['Line ID', 'Tracking No', 'Faculty Name', 'Program', 'Faculty Load Date', 'Faculty Load By',
  'IDP Date', 'IDP By', 'Major'];
const ATT_SEP = ' | ';

const CAMPUS_CODE = { Main: 'MAIN', Pagadian: 'PAG', Canuto: 'CAN', Dumingag: 'DUM' };
const WHOLE = '(Whole department)';

// Document types the office handles. The value is the prefix used in the tracking number.
const DOC_TYPES = { 'Faculty Load': 'FL', 'DLP': 'DLP' };

// Which status can move to which. Anything not listed here is refused.
const FLOW = {
  'Received': ['Processing', 'For Signature', 'Returned'],
  'Processing': ['For Signature', 'Returned'],
  'For Signature': ['Processing', 'Returned'],
  'Returned': ['Received'],
  'Released': []
};
const RELEASABLE = ['Received', 'Processing', 'For Signature'];

// ===================== 2. ENTRY POINT =====================
// The website sends every request as POST with a JSON body: { action, token, ...data }
function doGet() {
  return json_({ success: true, data: 'Faculty Load Tracker API is running.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const req = JSON.parse(e.postData.contents);
    const handler = HANDLERS[req.action];
    if (!handler) throw new Error('Unknown action: ' + req.action);

    const user = req.action === 'login' ? null : getUser_(req.token);

    // Writes take a lock so two staff cannot get the same tracking number.
    if (WRITES.indexOf(req.action) > -1) { lock.waitLock(20000); locked = true; }

    return json_({ success: true, data: handler(req, user) });
  } catch (err) {
    return json_({ success: false, error: err.message });
  } finally {
    if (locked) lock.releaseLock();
  }
}

const WRITES = ['receive', 'updateStatus', 'release', 'reopen',
  'subReceive', 'subAddLines', 'subTick', 'subStatus', 'subRelease', 'subReopen', 'docReceive'];
const HANDLERS = {
  login: login_, bootstrap: bootstrap_, list: list_, timeline: timeline_, stats: stats_,
  receive: receive_, updateStatus: updateStatus_, release: release_, reopen: reopen_,
  // submissions (section 7)
  subList: subList_, subGet: subGet_, subStats: subStats_, subReceive: subReceive_, subAddLines: subAddLines_,
  subTick: subTick_, subStatus: subStatus_, subRelease: subRelease_, subReopen: subReopen_,
  // other documents (section 8)
  docReceive: docReceive_, docList: docList_, docStats: docStats_
};

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== 3. LOGIN & SECURITY =====================
function hash_(pin) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + String(pin), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function login_(r) {
  const name = String(r.name || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + name;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Too many wrong tries. Wait 10 minutes.');

  const hash = hash_(r.pin);
  const u = readTable_(SHEETS.USERS).filter(function (x) {
    return String(x['Name']).toLowerCase() === name && x['PIN Hash'] === hash &&
      String(x['Active']).toUpperCase() === 'Y';
  })[0];

  if (!u) { cache.put(failKey, fails + 1, 600); throw new Error('Wrong name or PIN.'); }

  const info = { name: u['Name'], role: u['Role'], campus: u['Campus'] || 'ALL' };
  const token = Utilities.getUuid();
  cache.put('tok_' + token, JSON.stringify(info), 21600); // valid for 6 hours
  return { token: token, user: info };
}

function getUser_(token) {
  const v = token ? CacheService.getScriptCache().get('tok_' + token) : null;
  if (!v) throw new Error('SESSION_EXPIRED');
  return JSON.parse(v);
}

function assertCampus_(user, campus) {
  if (user.campus !== 'ALL' && user.campus !== campus) throw new Error('You are not allowed to use ' + campus + ' Campus.');
}

// ===================== 4. SHEET HELPERS =====================
const SPREADSHEET_ID = '1fsCbN4XtZG1m8Bt7PeJnP0nX6RFSuLoGocPayZaaxZs';
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function fmt_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm'); }

// Reads a sheet into a list of objects: [{ 'Tracking No': '...', Status: '...', _row: 2 }, ...]
function readTable_(name) {
  const data = ss_().getSheetByName(name).getDataRange().getValues();
  const head = data.shift();
  const out = [];
  data.forEach(function (r, i) {
    if (r[0] === '') return; // skip empty rows
    const o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j] instanceof Date ? fmt_(r[j]) : r[j]; });
    out.push(o);
  });
  return out;
}

// Keeps a result in memory for a few minutes so we do not re-read the sheet on every request.
function cached_(key, ttl, fn, refresh) {
  const cache = CacheService.getScriptCache();
  if (!refresh) { const hit = cache.get(key); if (hit) return JSON.parse(hit); }
  const out = fn();
  try { cache.put(key, JSON.stringify(out), ttl); } catch (e) { /* too big to cache: ignore */ }
  return out;
}

function settings_() {
  return cached_('settings', 300, function () {
    const s = {};
    readTable_(SHEETS.SETTINGS).forEach(function (r) { s[r['Key']] = r['Value']; });
    return s;
  });
}

function visibleDocs_(user) {
  return readTable_(SHEETS.DOCS).filter(function (d) { return user.campus === 'ALL' || d['Campus'] === user.campus; });
}

function findDoc_(tracking, user) {
  const d = readTable_(SHEETS.DOCS).filter(function (x) { return x['Tracking No'] === tracking; })[0];
  if (!d) throw new Error('Document not found: ' + tracking);
  assertCampus_(user, d['Campus']);
  return d;
}

// Changes some fields of one Documents row in a single write.
function updateDocRow_(doc, changes) {
  const sh = ss_().getSheetByName(SHEETS.DOCS);
  const range = sh.getRange(doc._row, 1, 1, DOC_HEADERS.length);
  const vals = range.getValues()[0];
  Object.keys(changes).forEach(function (k) { vals[DOC_HEADERS.indexOf(k)] = changes[k]; });
  vals[DOC_HEADERS.indexOf('Last Updated')] = new Date();
  range.setValues([vals]);
}

function addLog_(tracking, action, from, to, by, remarks) {
  ss_().getSheetByName(SHEETS.LOG).appendRow(
    [Utilities.getUuid().slice(0, 8), tracking, action, from || '', to || '', by, new Date(), remarks || '']);
}

function isOverdue_(d, days) {
  if (d['Status'] === 'Released' || !d['Date Received']) return false;
  const t = new Date(String(d['Date Received']).replace(' ', 'T') + ':00+08:00');
  return (Date.now() - t.getTime()) / 86400000 > days;
}

// ===================== 5. ACTIONS =====================
function bootstrap_(r, user) {
  return cached_('boot', 300, function () {
    const s = settings_();
    const programs = readTable_(SHEETS.PROGRAMS)
      .filter(function (p) { return String(p['Active']).trim().toUpperCase() === 'Y'; })
      .map(function (p) { return { Campus: p['Campus'], Department: p['Department'], Program: p['Program'], Major: p['Major'] }; });
    return {
      programs: programs,
      overdueDays: Number(s['OverdueDays'] || 3),
      releaseTo: String(s['ReleaseTo'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      otherTypes: String(s['DocTypes'] || DEFAULT_DOC_TYPES).split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      attachments: String(s['Attachments'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      flow: FLOW, releasable: RELEASABLE, whole: WHOLE, docTypes: Object.keys(DOC_TYPES)
    };
  }, r.refresh);
}

function list_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  let rows = visibleDocs_(user);
  if (r.docType) rows = rows.filter(function (d) { return d['Doc Type'] === r.docType; });
  if (r.campus) rows = rows.filter(function (d) { return d['Campus'] === r.campus; });
  if (r.status === 'Pending') rows = rows.filter(function (d) { return d['Status'] !== 'Released'; });
  else if (r.status) rows = rows.filter(function (d) { return d['Status'] === r.status; });
  if (r.q) {
    const q = String(r.q).toLowerCase();
    rows = rows.filter(function (d) {
      return [d['Tracking No'], d['Department'], d['Program'], d['Faculty Name'], d['Source'], d['Description']]
        .join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  rows.sort(function (a, b) { return String(b['Date Received']).localeCompare(String(a['Date Received'])); });
  return rows.slice(0, 300).map(function (d) { d.Overdue = isOverdue_(d, days); delete d._row; return d; });
}

function timeline_(r, user) {
  findDoc_(r.tracking, user); // also checks campus access
  return readTable_(SHEETS.LOG)
    .filter(function (l) { return l['Tracking No'] === r.tracking; })
    .sort(function (a, b) { return String(a['Timestamp']).localeCompare(String(b['Timestamp'])); })
    .map(function (l) { delete l._row; return l; });
}

function stats_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const docs = visibleDocs_(user).filter(function (d) { return !r.docType || d['Doc Type'] === r.docType; });
  const out = { receivedToday: 0, pending: 0, releasedToday: 0, overdue: 0, byCampus: {} };
  docs.forEach(function (d) {
    const c = d['Campus'];
    out.byCampus[c] = out.byCampus[c] || { pending: 0, overdue: 0 };
    if (String(d['Date Received']).indexOf(today) === 0) out.receivedToday++;
    if (String(d['Date Released']).indexOf(today) === 0) out.releasedToday++;
    if (d['Status'] !== 'Released') {
      out.pending++; out.byCampus[c].pending++;
      if (isOverdue_(d, days)) { out.overdue++; out.byCampus[c].overdue++; }
    }
  });
  return out;
}

function receive_(r, user) {
  const docType = r.docType || 'Faculty Load';
  if (!DOC_TYPES[docType]) throw new Error('Unknown document type: ' + docType);
  const isFL = docType === 'Faculty Load';

  // Each type asks for its own required fields.
  const need = isFL
    ? ['campus', 'department', 'program', 'semester', 'schoolYear', 'source']
    : ['campus', 'department', 'program', 'facultyName', 'subject', 'semester', 'schoolYear', 'source'];
  need.forEach(function (k) {
    if (!String(r[k] || '').trim()) throw new Error('Please fill in: ' + k);
  });
  if (!CAMPUS_CODE[r.campus]) throw new Error('Unknown campus: ' + r.campus);
  assertCampus_(user, r.campus);

  // The program must really exist for that campus + department (both types).
  const ok = readTable_(SHEETS.PROGRAMS).some(function (p) {
    return p['Campus'] === r.campus && p['Department'] === r.department &&
      (r.program === WHOLE || p['Program'] === r.program);
  });
  if (!ok) throw new Error('That campus / department / program combination does not exist.');

  // Tracking number: FL-MAIN-2026-0001 or DLP-MAIN-2026-0001 (own counter per type, campus and year)
  const code = CAMPUS_CODE[r.campus];
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const props = PropertiesService.getScriptProperties();
  // Faculty Load keeps its ORIGINAL counter key so old numbers are never repeated.
  const key = isFL ? 'seq_' + code + '_' + year : 'seq_' + DOC_TYPES[docType] + '_' + code + '_' + year;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  const tracking = DOC_TYPES[docType] + '-' + code + '-' + year + '-' + ('0000' + n).slice(-4);

  // DLP: the subject (and period covered) are saved in the Description column.
  const description = isFL
    ? (r.description || '')
    : 'Subject: ' + r.subject + (r.period ? ' | Period: ' + r.period : '');

  const now = new Date();
  const doc = {
    'Tracking No': tracking, 'Doc Type': docType, 'Campus': r.campus, 'Department': r.department,
    'Program': r.program, 'Major': isFL ? (r.major || '') : '',
    'Faculty Name': r.facultyName || '',
    'Semester': r.semester, 'School Year': r.schoolYear, 'Description': description,
    'Source': r.source, 'Date Received': now, 'Received By': user.name, 'Status': 'Received',
    'Current Holder': user.name, 'Released To': '', 'Released By': '', 'Date Released': '',
    'Remarks': r.remarks || '', 'Last Updated': now
  };
  ss_().getSheetByName(SHEETS.DOCS).appendRow(DOC_HEADERS.map(function (h) { return doc[h]; }));
  addLog_(tracking, 'RECEIVED', r.source, user.name, user.name, r.remarks);
  return { tracking: tracking, receivedAt: fmt_(now) };
}

function updateStatus_(r, user) {
  const d = findDoc_(r.tracking, user);
  const allowed = FLOW[d['Status']] || [];
  if (allowed.indexOf(r.status) === -1) throw new Error('Cannot move from ' + d['Status'] + ' to ' + r.status + '.');
  const holder = r.holder || d['Current Holder'];
  updateDocRow_(d, { 'Status': r.status, 'Current Holder': holder, 'Remarks': r.remarks || d['Remarks'] });
  addLog_(r.tracking, 'STATUS: ' + r.status, d['Current Holder'], holder, user.name, r.remarks);
  return { ok: true };
}

function release_(r, user) {
  const d = findDoc_(r.tracking, user);
  if (RELEASABLE.indexOf(d['Status']) === -1) throw new Error('A document that is ' + d['Status'] + ' cannot be released.');
  if (!String(r.to || '').trim()) throw new Error('Please say who or which office receives it.');
  updateDocRow_(d, {
    'Status': 'Released', 'Current Holder': r.to, 'Released To': r.to, 'Released By': user.name,
    'Date Released': new Date(), 'Remarks': r.remarks || d['Remarks']
  });
  addLog_(r.tracking, 'RELEASED', d['Current Holder'], r.to, user.name, r.remarks);
  return { ok: true };
}

function reopen_(r, user) {
  if (user.role !== 'Admin') throw new Error('Only an Admin can reopen a released document.');
  if (!String(r.remarks || '').trim()) throw new Error('Please write the reason for reopening.');
  const d = findDoc_(r.tracking, user);
  if (d['Status'] !== 'Released') throw new Error('Only released documents can be reopened.');
  updateDocRow_(d, { 'Status': 'Received', 'Current Holder': user.name, 'Released To': '', 'Released By': '', 'Date Released': '' });
  addLog_(r.tracking, 'REOPENED', d['Released To'], user.name, user.name, r.remarks);
  return { ok: true };
}

// ===================== 7. SUBMISSIONS: department batch + faculty checklist (added) =====================
// One SUBMISSION = one department's batch, like the printed "Faculty Submissions" form.
// Inside it every faculty member is a LINE with two ticks: Faculty Load and IDP (Individual Daily Plan).
// Statuses, release, reopen and the history log work exactly like single documents above.

function str_(v) { return String(v === null || v === undefined ? '' : v).trim(); }
function splitList_(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

function visibleSubs_(user) {
  return readTable_(SHEETS.SUBS).filter(function (s) { return user.campus === 'ALL' || s['Campus'] === user.campus; });
}

// Finds one submission by reading only column A, then only that row.
function findSub_(tracking, user) {
  const sh = ss_().getSheetByName(SHEETS.SUBS);
  const last = sh.getLastRow();
  let row = -1;
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) { if (ids[i][0] === tracking) { row = i + 2; break; } }
  }
  if (row < 0) throw new Error('Submission not found: ' + tracking);
  const vals = sh.getRange(row, 1, 1, SUB_HEADERS.length).getValues()[0];
  const o = { _row: row };
  SUB_HEADERS.forEach(function (h, j) { o[h] = vals[j] instanceof Date ? fmt_(vals[j]) : vals[j]; });
  assertCampus_(user, o['Campus']);
  return o;
}

function updateSubRow_(sub, changes) {
  const range = ss_().getSheetByName(SHEETS.SUBS).getRange(sub._row, 1, 1, SUB_HEADERS.length);
  const vals = range.getValues()[0];
  Object.keys(changes).forEach(function (k) { vals[SUB_HEADERS.indexOf(k)] = changes[k]; });
  vals[SUB_HEADERS.indexOf('Last Updated')] = new Date();
  range.setValues([vals]);
}

// { tracking: { total, fl, idp, names:[...] } } built from ONE read of the Faculty Lines sheet.
function lineMap_() {
  const map = {};
  readTable_(SHEETS.LINES).forEach(function (l) {
    const t = l['Tracking No'];
    const m = map[t] || (map[t] = { total: 0, fl: 0, idp: 0, names: [] });
    m.total++; if (l['Faculty Load Date']) m.fl++; if (l['IDP Date']) m.idp++;
    m.names.push(l['Faculty Name']);
  });
  return map;
}

function countsFor_(tracking) {
  const m = { total: 0, fl: 0, idp: 0 };
  readTable_(SHEETS.LINES).forEach(function (l) {
    if (l['Tracking No'] !== tracking) return;
    m.total++; if (l['Faculty Load Date']) m.fl++; if (l['IDP Date']) m.idp++;
  });
  return m;
}

// Checks a list of faculty lines from the website and returns clean ones.
// A program that has majors in the Programs sheet needs one of them chosen.
function cleanLines_(lines, campus, department) {
  const progs = {};   // program -> list of majors
  readTable_(SHEETS.PROGRAMS).forEach(function (p) {
    if (p['Campus'] !== campus || p['Department'] !== department) return;
    const list = progs[p['Program']] || (progs[p['Program']] = []);
    const m = str_(p['Major']);
    if (m && list.indexOf(m) === -1) list.push(m);
  });
  if (!Object.keys(progs).length) throw new Error('That campus / department combination does not exist.');
  const out = [];
  (lines || []).forEach(function (l) {
    const name = str_(l.name), program = str_(l.program), major = str_(l.major);
    if (!name) return;
    if (name.length > 120) throw new Error('A faculty name is too long.');
    if (!progs[program]) throw new Error('Program "' + program + '" does not belong to ' + department + '.');
    const majors = progs[program];
    if (majors.length && !major) throw new Error('Choose a major for ' + name + ' (' + program + ').');
    if (major && majors.indexOf(major) === -1) throw new Error('"' + major + '" is not a major of ' + program + '.');
    out.push({ name: name, program: program, major: major, fl: !!l.fl, idp: !!l.idp });
  });
  if (out.length > 200) throw new Error('Too many faculty in one submission (max 200).');
  return out;
}

function lineRows_(tracking, lines, userName) {
  const now = new Date();
  return lines.map(function (l) {
    return [Utilities.getUuid().slice(0, 8), tracking, l.name, l.program,
      l.fl ? now : '', l.fl ? userName : '', l.idp ? now : '', l.idp ? userName : '', l.major || ''];
  });
}

function appendLines_(rows) {
  if (!rows.length) return;
  const sh = ss_().getSheetByName(SHEETS.LINES);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LINE_HEADERS.length).setValues(rows);
}

function subList_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  const map = lineMap_();
  let rows = visibleSubs_(user);
  if (r.campus) rows = rows.filter(function (s) { return s['Campus'] === r.campus; });
  if (r.status === 'Pending') rows = rows.filter(function (s) { return s['Status'] !== 'Released'; });
  else if (r.status) rows = rows.filter(function (s) { return s['Status'] === r.status; });

  rows.forEach(function (s) {
    const m = map[s['Tracking No']] || { total: 0, fl: 0, idp: 0, names: [] };
    s.total = m.total; s.fl = m.fl; s.idp = m.idp; s.names = m.names;
    s.Incomplete = m.fl < m.total || m.idp < m.total;
    s.Overdue = isOverdue_(s, days);
  });

  if (r.missing === 'Faculty Load') rows = rows.filter(function (s) { return s.fl < s.total; });
  else if (r.missing === 'IDP') rows = rows.filter(function (s) { return s.idp < s.total; });
  else if (r.missing === 'Any') rows = rows.filter(function (s) { return s.Incomplete; });
  else if (r.missing === 'Complete') rows = rows.filter(function (s) { return !s.Incomplete; });

  if (r.q) {
    const q = String(r.q).toLowerCase();
    rows = rows.filter(function (s) {
      return [s['Tracking No'], s['Department'], s['Submitted By'], s.names.join(' ')].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  rows.sort(function (a, b) { return String(b['Date Received']).localeCompare(String(a['Date Received'])); });
  return rows.slice(0, 300).map(function (s) { delete s._row; delete s.names; return s; });
}

// Everything the detail panel needs, in ONE call.
function subGet_(r, user) {
  const sub = findSub_(r.tracking, user);
  const lines = readTable_(SHEETS.LINES)
    .filter(function (l) { return l['Tracking No'] === r.tracking; })
    .map(function (l) { delete l._row; return l; });
  const log = readTable_(SHEETS.LOG)
    .filter(function (l) { return l['Tracking No'] === r.tracking; })
    .sort(function (a, b) { return String(a['Timestamp']).localeCompare(String(b['Timestamp'])); })
    .map(function (l) { delete l._row; return l; });
  sub.Overdue = isOverdue_(sub, Number(settings_()['OverdueDays'] || 3));
  delete sub._row;
  return { submission: sub, lines: lines, log: log };
}

function subStats_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const map = lineMap_();
  const out = { receivedToday: 0, pending: 0, releasedToday: 0, overdue: 0, incomplete: 0, missingFL: 0, missingIDP: 0, byCampus: {} };
  visibleSubs_(user).forEach(function (s) {
    const c = s['Campus'];
    const b = out.byCampus[c] || (out.byCampus[c] = { pending: 0, overdue: 0, missingFL: 0, missingIDP: 0 });
    const m = map[s['Tracking No']] || { total: 0, fl: 0, idp: 0 };
    if (String(s['Date Received']).indexOf(today) === 0) out.receivedToday++;
    if (String(s['Date Released']).indexOf(today) === 0) out.releasedToday++;
    if (s['Status'] !== 'Released') {
      out.pending++; b.pending++;
      if (isOverdue_(s, days)) { out.overdue++; b.overdue++; }
    }
    if (m.fl < m.total || m.idp < m.total) out.incomplete++;
    out.missingFL += m.total - m.fl; b.missingFL += m.total - m.fl;
    out.missingIDP += m.total - m.idp; b.missingIDP += m.total - m.idp;
  });
  return out;
}

function subReceive_(r, user) {
  ['campus', 'department', 'semester', 'schoolYear', 'source'].forEach(function (k) {
    if (!str_(r[k])) throw new Error('Please fill in: ' + k);
  });
  if (!CAMPUS_CODE[r.campus]) throw new Error('Unknown campus: ' + r.campus);
  assertCampus_(user, r.campus);

  const lines = cleanLines_(r.lines, r.campus, r.department);
  if (!lines.length) throw new Error('Add at least one faculty name.');

  // Tracking number, e.g. TR-MAIN-2026-0001 (each campus + year has its own counter)
  const code = CAMPUS_CODE[r.campus];
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_TR_' + code + '_' + year;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  const tracking = 'TR-' + code + '-' + year + '-' + ('0000' + n).slice(-4);

  const now = new Date();
  const sub = {
    'Tracking No': tracking, 'Campus': r.campus, 'Department': r.department, 'Semester': r.semester,
    'School Year': r.schoolYear, 'Submitted By': r.source, 'Date Received': now, 'Received By': user.name,
    'Status': 'Received', 'Current Holder': user.name, 'Released To': '', 'Released By': '', 'Date Released': '',
    'Attachments': (r.attachments || []).map(str_).filter(Boolean).join(ATT_SEP), 'Remarks': str_(r.remarks), 'Last Updated': now
  };
  ss_().getSheetByName(SHEETS.SUBS).appendRow(SUB_HEADERS.map(function (h) { return sub[h]; }));
  appendLines_(lineRows_(tracking, lines, user.name));

  const fl = lines.filter(function (l) { return l.fl; }).length, idp = lines.filter(function (l) { return l.idp; }).length;
  addLog_(tracking, 'RECEIVED', r.source, user.name, user.name,
    lines.length + ' faculty. Faculty Load ' + fl + '/' + lines.length + ', IDP ' + idp + '/' + lines.length + '. ' + str_(r.remarks));
  return { tracking: tracking, receivedAt: fmt_(now) };
}

function subAddLines_(r, user) {
  const sub = findSub_(r.tracking, user);
  const lines = cleanLines_(r.lines, sub['Campus'], sub['Department']);
  if (!lines.length) throw new Error('Add at least one faculty name.');
  appendLines_(lineRows_(r.tracking, lines, user.name));
  addLog_(r.tracking, 'ADDED FACULTY', '', lines.map(function (l) { return l.name; }).join(', '), user.name, '');
  return { added: lines.length };
}

// Marks one faculty member's Faculty Load or IDP as received (or, for Admin, removes the mark).
function subTick_(r, user) {
  findSub_(r.tracking, user); // checks the campus is allowed
  const isFL = r.field !== 'idp';
  const dateIdx = LINE_HEADERS.indexOf(isFL ? 'Faculty Load Date' : 'IDP Date');
  const sh = ss_().getSheetByName(SHEETS.LINES);
  const last = sh.getLastRow();
  const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  let row = -1;
  for (let i = 0; i < ids.length; i++) { if (ids[i][0] === r.lineId && ids[i][1] === r.tracking) { row = i + 2; break; } }
  if (row < 0) throw new Error('Faculty line not found.');

  const range = sh.getRange(row, 1, 1, LINE_HEADERS.length);
  const vals = range.getValues()[0];
  const label = isFL ? 'FACULTY LOAD' : 'IDP';
  if (r.value === false) {
    if (user.role !== 'Admin') throw new Error('Only an Admin can remove a tick.');
    vals[dateIdx] = ''; vals[dateIdx + 1] = '';
    addLog_(r.tracking, label + ' TICK REMOVED', '', vals[2], user.name, '');
  } else {
    if (vals[dateIdx]) throw new Error('Already marked as received.');
    vals[dateIdx] = new Date(); vals[dateIdx + 1] = user.name;
    addLog_(r.tracking, label + ' RECEIVED', '', vals[2], user.name, '');
  }
  range.setValues([vals]);
  const line = {};
  LINE_HEADERS.forEach(function (h, j) { line[h] = vals[j] instanceof Date ? fmt_(vals[j]) : vals[j]; });
  return { line: line };
}

function subStatus_(r, user) {
  const s = findSub_(r.tracking, user);
  if ((FLOW[s['Status']] || []).indexOf(r.status) === -1) throw new Error('Cannot move from ' + s['Status'] + ' to ' + r.status + '.');
  const holder = r.holder || s['Current Holder'];
  updateSubRow_(s, { 'Status': r.status, 'Current Holder': holder, 'Remarks': r.remarks || s['Remarks'] });
  addLog_(r.tracking, 'STATUS: ' + r.status, s['Current Holder'], holder, user.name, r.remarks);
  return { ok: true };
}

function subRelease_(r, user) {
  const s = findSub_(r.tracking, user);
  if (RELEASABLE.indexOf(s['Status']) === -1) throw new Error('A submission that is ' + s['Status'] + ' cannot be released.');
  if (!str_(r.to)) throw new Error('Please say who or which office receives it.');

  const m = countsFor_(r.tracking);
  const incomplete = m.fl < m.total || m.idp < m.total;
  const summary = 'Faculty Load ' + m.fl + '/' + m.total + ', IDP ' + m.idp + '/' + m.total;
  if (incomplete && !r.confirmIncomplete) throw new Error('INCOMPLETE: ' + summary + '. Release anyway?');

  updateSubRow_(s, { 'Status': 'Released', 'Current Holder': r.to, 'Released To': r.to, 'Released By': user.name,
    'Date Released': new Date(), 'Remarks': r.remarks || s['Remarks'] });
  addLog_(r.tracking, 'RELEASED', s['Current Holder'], r.to, user.name, (incomplete ? 'Released incomplete (' + summary + '). ' : '') + str_(r.remarks));
  return { ok: true };
}

function subReopen_(r, user) {
  if (user.role !== 'Admin') throw new Error('Only an Admin can reopen a released submission.');
  if (!str_(r.remarks)) throw new Error('Please write the reason for reopening.');
  const s = findSub_(r.tracking, user);
  if (s['Status'] !== 'Released') throw new Error('Only released submissions can be reopened.');
  updateSubRow_(s, { 'Status': 'Received', 'Current Holder': user.name, 'Released To': '', 'Released By': '', 'Date Released': '' });
  addLog_(r.tracking, 'REOPENED', s['Released To'], user.name, user.name, r.remarks);
  return { ok: true };
}

// ===================== 8. OTHER DOCUMENTS: memos, letters, orders... (added) =====================
// Any document that is not a Faculty Load / DLP / department submission. They are saved in the Documents sheet
// with Doc Type = the type chosen (the list of types is the "DocTypes" row in the Settings sheet).
// Status, release, reopen and history use the SAME actions as before (updateStatus, release, reopen, timeline).

const DEFAULT_DOC_TYPES = 'Memorandum, Request Letter, Travel Order, Certificate, Report, Endorsement, Others';

function isOther_(d) { return !DOC_TYPES[d['Doc Type']]; }

function docList_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  let rows = visibleDocs_(user).filter(isOther_);
  if (r.docType) rows = rows.filter(function (d) { return d['Doc Type'] === r.docType; });
  if (r.campus) rows = rows.filter(function (d) { return d['Campus'] === r.campus; });
  if (r.status === 'Pending') rows = rows.filter(function (d) { return d['Status'] !== 'Released'; });
  else if (r.status) rows = rows.filter(function (d) { return d['Status'] === r.status; });
  if (r.q) {
    const q = String(r.q).toLowerCase();
    rows = rows.filter(function (d) {
      return [d['Tracking No'], d['Doc Type'], d['Department'], d['Description'], d['Source']].join(' ').toLowerCase().indexOf(q) > -1;
    });
  }
  rows.sort(function (a, b) { return String(b['Date Received']).localeCompare(String(a['Date Received'])); });
  return rows.slice(0, 300).map(function (d) { d.Overdue = isOverdue_(d, days); delete d._row; return d; });
}

function docStats_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const out = { receivedToday: 0, pending: 0, releasedToday: 0, overdue: 0, byType: {} };
  visibleDocs_(user).filter(isOther_).forEach(function (d) {
    if (String(d['Date Received']).indexOf(today) === 0) out.receivedToday++;
    if (String(d['Date Released']).indexOf(today) === 0) out.releasedToday++;
    if (d['Status'] !== 'Released') {
      out.pending++;
      out.byType[d['Doc Type']] = (out.byType[d['Doc Type']] || 0) + 1;
      if (isOverdue_(d, days)) out.overdue++;
    }
  });
  return out;
}

function docReceive_(r, user) {
  const type = str_(r.docType);
  const allowed = splitList_(settings_()['DocTypes'] || DEFAULT_DOC_TYPES);
  if (DOC_TYPES[type]) throw new Error(type + ' has its own page. Use that one.');
  if (allowed.indexOf(type) === -1) throw new Error('Unknown document type: ' + type);
  ['campus', 'department', 'title', 'source'].forEach(function (k) {
    if (!str_(r[k])) throw new Error('Please fill in: ' + k);
  });
  if (!CAMPUS_CODE[r.campus]) throw new Error('Unknown campus: ' + r.campus);
  assertCampus_(user, r.campus);
  if (str_(r.title).length > 200) throw new Error('The title is too long (max 200 characters).');
  if (str_(r.department).length > 120) throw new Error('The office / department is too long.');

  // Tracking number, e.g. DOC-MAIN-2026-0001 (each campus + year has its own counter)
  const code = CAMPUS_CODE[r.campus];
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_DOC_' + code + '_' + year;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  const tracking = 'DOC-' + code + '-' + year + '-' + ('0000' + n).slice(-4);

  const now = new Date();
  const doc = {
    'Tracking No': tracking, 'Doc Type': type, 'Campus': r.campus, 'Department': str_(r.department),
    'Program': '', 'Major': '', 'Faculty Name': '', 'Semester': '', 'School Year': '',
    'Description': str_(r.title) + (str_(r.reference) ? ' | Ref: ' + str_(r.reference) : ''),
    'Source': str_(r.source), 'Date Received': now, 'Received By': user.name, 'Status': 'Received',
    'Current Holder': user.name, 'Released To': '', 'Released By': '', 'Date Released': '',
    'Remarks': str_(r.remarks), 'Last Updated': now
  };
  ss_().getSheetByName(SHEETS.DOCS).appendRow(DOC_HEADERS.map(function (h) { return doc[h]; }));
  addLog_(tracking, 'RECEIVED', str_(r.source), user.name, user.name, str_(r.remarks));
  return { tracking: tracking, receivedAt: fmt_(now) };
}

// ===================== 6. ONE-TIME SETUP (run from the editor) =====================
function setupSheets() {
  const ss = ss_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());

  const defs = [[SHEETS.DOCS, DOC_HEADERS], [SHEETS.LOG, LOG_HEADERS], [SHEETS.USERS, USER_HEADERS],
    [SHEETS.PROGRAMS, PROGRAM_HEADERS], [SHEETS.SETTINGS, ['Key', 'Value']],
    [SHEETS.SUBS, SUB_HEADERS], [SHEETS.LINES, LINE_HEADERS]];

  defs.forEach(function (def) {
    const sh = ss.getSheetByName(def[0]) || ss.insertSheet(def[0]);
    if (sh.getLastRow() > 0) { addMissingColumns_(sh, def[1]); return; } // already set up
    const headers = def[1];
    headers.forEach(function (h, i) {
      // Text format stops Sheets from turning "2026-2027" or hashes into dates/numbers.
      sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat(DATE_COLS.indexOf(h) > -1 ? 'yyyy-mm-dd hh:mm' : '@');
    });
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1f5c46').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  // Starter list of programs: Campus, Department, Program
  const P = [
    ['Main', 'Teacher Education', 'Bachelor in Elementary Education'],
    ['Main', 'Teacher Education', 'Bachelor of Secondary Education'],
    ['Main', 'Arts and Sciences', 'Bachelor of Arts in Political Science'],
    ['Main', 'Arts and Sciences', 'Bachelor of Science in Social Work'],
    ['Main', 'Arts and Sciences', 'Bachelor of Arts in English Language Studies'],
    ['Main', 'Arts and Sciences', 'Bachelor of Science in Environmental Science'],
    ['Main', 'Engineering', 'Bachelor of Science in Civil Engineering'],
    ['Main', 'Engineering', 'Bachelor of Science in Agricultural Biosystems Engineering'],
    ['Main', 'Information Technology', 'Bachelor of Science in Information Technology'],
    ['Main', 'Agriculture and Forestry', 'Bachelor of Science in Agriculture'],
    ['Main', 'Agriculture and Forestry', 'Bachelor of Science in Forestry'],
    ['Pagadian', 'Health Sciences', 'Bachelor of Science in Nursing'],
    ['Pagadian', 'Business and Hospitality', 'Bachelor of Science in Hospitality Management'],
    ['Pagadian', 'Business and Hospitality', 'Bachelor of Science in Entrepreneurship'],
    ['Pagadian', 'Business and Hospitality', 'Bachelor of Science in Tourism Management'],
    ['Pagadian', 'Information Technology', 'Bachelor of Science in Information Technology'],
    ['Dumingag', 'Teacher Education', 'Bachelor of Elementary Education'],
    ['Dumingag', 'Teacher Education', 'Bachelor of Physical Education'],
    ['Dumingag', 'Teacher Education', 'Bachelor of Secondary Education'],
    ['Dumingag', 'Criminal Justice', 'Bachelor of Science in Criminology'],
    ['Dumingag', 'Criminal Justice', 'Bachelor of Science in Industrial Security Management'],
    ['Dumingag', 'Information Technology', 'Bachelor of Science in Information Technology'],
    ['Dumingag', 'Agriculture', 'Bachelor of Science in Agriculture'],
    ['Canuto', 'Teacher Education', 'Bachelor in Technical-Vocational Teacher Education - Food Service Management'],
    ['Canuto', 'Teacher Education', 'Bachelor in Technical-Vocational Teacher Education - Animal Production'],
    ['Canuto', 'Teacher Education', 'Bachelor in Technology and Livelihood Education'],
    ['Canuto', 'Information Technology', 'Bachelor of Science in Information Technology'],
    ['Canuto', 'Industrial Technology', 'Bachelor in Industrial Technology']
  ];
  const pSheet = ss.getSheetByName(SHEETS.PROGRAMS);
  if (pSheet.getLastRow() === 1) {
    const rows = P.map(function (p) { return [p[0], p[1], p[2], '', 'Y']; });
    pSheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  const sSheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (sSheet.getLastRow() === 1) {
    sSheet.getRange(2, 1, 2, 2).setValues([
      ['OverdueDays', '3'],
      ['ReleaseTo', "Dean's Office, Campus Director, VPAA Office, HR Office, Registrar, Department Head"]
    ]);
  }

  // Checklist printed on the Faculty Submissions form. Edit this row in the Settings sheet to match your form.
  const haveSetting = {};
  readTable_(SHEETS.SETTINGS).forEach(function (r) { haveSetting[r['Key']] = true; });
  if (!haveSetting['Attachments']) {
    sSheet.appendRow(['Attachments', 'Faculty Load (with summary of overload), Certification that the Faculty Load was thoroughly checked, Justification Letter (if applicable), Compilation of Individual Daily Plans, Transmittal Letter']);
  }

  // Types of OTHER documents (memos, letters...). Edit this row in the Settings sheet to add or rename types.
  if (!haveSetting['DocTypes']) sSheet.appendRow(['DocTypes', DEFAULT_DOC_TYPES]);

  // First admin. CHANGE THE PIN right away by editing addUser() and running it again.
  if (ss.getSheetByName(SHEETS.USERS).getLastRow() === 1) {
    ss.getSheetByName(SHEETS.USERS).appendRow(['Admin', 'Admin', 'ALL', hash_('1234'), 'Y']);
  }
  CacheService.getScriptCache().removeAll(['boot', 'settings']);
  Logger.log('Done. Login: Admin / 1234 (change it!)');
}

// Adds any header that is missing at the end of an existing sheet (for example "Major" in Faculty Lines).
function addMissingColumns_(sh, headers) {
  const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(str_);
  let col = have.filter(Boolean).length;
  headers.forEach(function (h) {
    if (have.indexOf(h) > -1) return;
    col++;
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat(DATE_COLS.indexOf(h) > -1 ? 'yyyy-mm-dd hh:mm' : '@');
    sh.getRange(1, col).setValue(h).setFontWeight('bold').setBackground('#1f5c46').setFontColor('#ffffff');
  });
}

// Run this after you edit the Programs or Settings sheet, to see the change immediately.
function clearCache() { CacheService.getScriptCache().removeAll(['boot', 'settings']); }

// Edit the 4 constants, then press Run. Running it again with the same NAME resets that person's PIN.
function addUser() {
  const NAME = 'Ana Reyes';
  const ROLE = 'Staff';       // 'Staff' or 'Admin'
  const CAMPUS = 'Main';      // 'ALL', 'Main', 'Pagadian', 'Canuto' or 'Dumingag'
  const PIN = '5678';

  const sh = ss_().getSheetByName(SHEETS.USERS);
  const existing = readTable_(SHEETS.USERS).filter(function (u) { return String(u['Name']).toLowerCase() === NAME.toLowerCase(); })[0];
  const row = [NAME, ROLE, CAMPUS, hash_(PIN), 'Y'];
  if (existing) sh.getRange(existing._row, 1, 1, 5).setValues([row]);
  else sh.appendRow(row);
  Logger.log('Saved user ' + NAME);
}
