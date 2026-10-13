/**
 * FACULTY LOAD TRACKER - BACKEND (Google Apps Script)
 * ---------------------------------------------------
 * Paste this whole file into: Google Sheet > Extensions > Apps Script.
 * The script is "bound" to the sheet, so it reads/writes that sheet directly.
 *
 * FIRST TIME:  run setupSheets() once from the editor.
 * ADD STAFF:   edit the constants inside addUser(), then run it.
 * PUBLISH:     Deploy > New deployment > Web app
 *              Execute as: Me | Who has access: Anyone
 */

// ===================== 1. SETTINGS =====================
const TZ = 'Asia/Manila';
const SHEETS = { DOCS: 'Documents', LOG: 'Movements', USERS: 'Users', PROGRAMS: 'Programs', SETTINGS: 'Settings' };

const DOC_HEADERS = ['Tracking No', 'Doc Type', 'Campus', 'Department', 'Program', 'Major', 'Faculty Name',
  'Semester', 'School Year', 'Description', 'Source', 'Date Received', 'Received By', 'Status',
  'Current Holder', 'Released To', 'Released By', 'Date Released', 'Remarks', 'Last Updated'];
const LOG_HEADERS = ['Log ID', 'Tracking No', 'Action', 'From', 'To', 'Done By', 'Timestamp', 'Remarks'];
const USER_HEADERS = ['Name', 'Role', 'Campus', 'PIN Hash', 'Active'];
const PROGRAM_HEADERS = ['Campus', 'Department', 'Program', 'Major', 'Active'];
const DATE_COLS = ['Date Received', 'Date Released', 'Last Updated', 'Timestamp'];

const CAMPUS_CODE = { Main: 'MAIN', Pagadian: 'PAG', Canuto: 'CAN', Dumingag: 'DUM' };
const WHOLE = '(Whole department)';

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

const WRITES = ['receive', 'updateStatus', 'release', 'reopen'];
const HANDLERS = {
  login: login_, bootstrap: bootstrap_, list: list_, timeline: timeline_, stats: stats_,
  receive: receive_, updateStatus: updateStatus_, release: release_, reopen: reopen_
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

function settings_() {
  const s = {};
  readTable_(SHEETS.SETTINGS).forEach(function (r) { s[r['Key']] = r['Value']; });
  return s;
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
  const s = settings_();
  const programs = readTable_(SHEETS.PROGRAMS)
    .filter(function (p) { return String(p['Active']).toUpperCase() === 'Y'; })
    .map(function (p) { return { Campus: p['Campus'], Department: p['Department'], Program: p['Program'], Major: p['Major'] }; });
  return {
    programs: programs,
    overdueDays: Number(s['OverdueDays'] || 3),
    releaseTo: String(s['ReleaseTo'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    flow: FLOW, releasable: RELEASABLE, whole: WHOLE
  };
}

function list_(r, user) {
  const days = Number(settings_()['OverdueDays'] || 3);
  let rows = visibleDocs_(user);
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
  const docs = visibleDocs_(user);
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
  ['campus', 'department', 'program', 'semester', 'schoolYear', 'source'].forEach(function (k) {
    if (!String(r[k] || '').trim()) throw new Error('Please fill in: ' + k);
  });
  assertCampus_(user, r.campus);

  // The program must really exist for that campus + department (stops wrong combinations).
  const ok = readTable_(SHEETS.PROGRAMS).some(function (p) {
    return p['Campus'] === r.campus && p['Department'] === r.department &&
      (r.program === WHOLE || p['Program'] === r.program);
  });
  if (!ok) throw new Error('That campus / department / program combination does not exist.');

  // Tracking number, e.g. FL-MAIN-2026-0001 (each campus + year has its own counter)
  const code = CAMPUS_CODE[r.campus];
  const year = Utilities.formatDate(new Date(), TZ, 'yyyy');
  const props = PropertiesService.getScriptProperties();
  const key = 'seq_' + code + '_' + year;
  const n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  const tracking = 'FL-' + code + '-' + year + '-' + ('0000' + n).slice(-4);

  const now = new Date();
  const doc = {
    'Tracking No': tracking, 'Doc Type': 'Faculty Load', 'Campus': r.campus, 'Department': r.department,
    'Program': r.program, 'Major': r.major || '', 'Faculty Name': r.facultyName || '',
    'Semester': r.semester, 'School Year': r.schoolYear, 'Description': r.description || '',
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

// ===================== 6. ONE-TIME SETUP (run from the editor) =====================
function setupSheets() {
  const ss = ss_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());

  const defs = [[SHEETS.DOCS, DOC_HEADERS], [SHEETS.LOG, LOG_HEADERS], [SHEETS.USERS, USER_HEADERS],
    [SHEETS.PROGRAMS, PROGRAM_HEADERS], [SHEETS.SETTINGS, ['Key', 'Value']]];

  defs.forEach(function (def) {
    const sh = ss.getSheetByName(def[0]) || ss.insertSheet(def[0]);
    if (sh.getLastRow() > 0) return; // already set up
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

  // First admin. CHANGE THE PIN right away by editing addUser() and running it again.
  if (ss.getSheetByName(SHEETS.USERS).getLastRow() === 1) {
    ss.getSheetByName(SHEETS.USERS).appendRow(['Admin', 'Admin', 'ALL', hash_('1234'), 'Y']);
  }
  Logger.log('Done. Login: Admin / 1234 (change it!)');
}

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
