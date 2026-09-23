/**
 * Kuttyolum Collectorum – Reservation Preference Form & Dashboard
 * =================================================================
 * Google Apps Script backend.
 *
 * Recommended: a standalone Apps Script project with Script Property
 * SPREADSHEET_ID = the school master spreadsheet's ID (the one already
 * containing the school list). A script bound to that sheet also works.
 *
 *   <first sheet / "Schools">  ← existing school master list — READ ONLY here.
 *                                Columns are matched by header name (case/
 *                                punctuation don't matter): school name,
 *                                UDISE code, H.M/contact, phone, address.
 *                                Set Script Property SCHOOLS_SHEET_NAME if
 *                                the tab isn't named "Schools".
 *   Schools_Extra              ← schools added/edited from the dashboard
 *                                (never writes to the sheet above).
 *   Reservation_Submissions    ← one row per submitted form.
 *   Reservation_Audit          ← every submit / edit / delete / school change.
 *
 * Deployed as a web app it is a JSON API only (see doGet / doPost). The
 * form and dashboard pages live in web/ and are hosted on Cloudflare Pages.
 *
 * NOTE: top-level declarations use `var` on purpose so the local preview
 * harness (preview/) can load this file unchanged.
 */

var CONFIG = {
  TITLE: 'Kuttyolum Collectorum',
  SUBTITLE: 'District Administration, Kozhikode',

  // Leave blank when the script is bound to the school master spreadsheet.
  // Can also be supplied as Script Property SPREADSHEET_ID.
  SPREADSHEET_ID: '',

  SHEETS: {
    SCHOOLS_EXTRA: 'Schools_Extra',
    SUBMISSIONS: 'Reservation_Submissions',
    AUDIT: 'Reservation_Audit'
  },

  DISTRICTS: {
    'Kozhikode': ['Kozhikode City', 'Kozhikode Rural', 'Chevayur', 'Feroke'],
    'Vatakara': ['Vatakara', 'Koyilandy', 'Nadapuram', 'Melady', 'Thodannur', 'Kunnummal', 'Chombala'],
    'Thamarassery': ['Thamarassery', 'Koduvally', 'Mukkam', 'Balussery', 'Kunnamangalam', 'Perambra']
  },

  CLASSES: ['5', '6', '7', '8', '9', '10', '11', '12'],
  INSTITUTION_TYPES: ['Aided', 'Unaided', 'Private'],
  RESERVATIONS: ['Fisheries', 'Girls Only', 'SC / ST', 'Rural Area', 'PWD'],
  NO_RESERVATION: 'No Reservations',

  // 6h (CacheService's max) is safe here: every write that changes the
  // school list or districts (addSchool/updateSchool/setSchoolStatus, and
  // the setup script property changes) already calls invalidate_(), so a
  // long TTL only avoids repeat slow cold reads — it never serves stale data.
  FORM_CACHE_SECONDS: 21600
};

var HEADERS = {
  SCHOOLS_EXTRA: ['School Name', 'UDISE Code', 'Contact Person', 'Phone', 'Address',
                  'Educational District', 'Sub-District', 'Institution Type', 'Status', 'Added At', 'Added By'],
  SUBMISSIONS: ['Submission ID', 'Timestamp', 'School Name', 'School Source', 'UDISE Code', 'Institution Type',
                'Educational District', 'Sub-District', 'Address', 'Total Students', 'Classes Participating',
                'Contact Person Name', 'Contact Person Mobile', 'Teacher Coordinator Name', 'Teacher Coordinator Mobile',
                'Email', 'Reservations', 'Accessibility Support', 'Parent Consent', 'Photo Video Consent',
                'Medical Info', 'Declaration', 'Status', 'Updated At', 'Updated By'],
  AUDIT: ['Timestamp', 'Action', 'Submission ID', 'Previous Value', 'New Value', 'User']
};

var STATUS = { ACTIVE: 'ACTIVE', DELETED: 'DELETED' };
var FORM_CACHE_KEY = 'kc_form_v1';


/* =========================================================================
 *  JSON API (the web pages are hosted separately, e.g. Cloudflare Pages)
 *
 *   POST <exec-url>  body {fn, args:[...]}
 *   getFormBootstrap  – public (no PIN): schools list, districts, options
 *   submitReservation – public (no PIN): writes one submission
 *   everything else   – admin, first arg is the PIN
 * ========================================================================= */

var API_FUNCTIONS = {
  getFormBootstrap: getFormBootstrap,
  submitReservation: submitReservation,
  getAdminBootstrap: getAdminBootstrap,
  getAdminState: getAdminState,
  updateSubmission: updateSubmission,
  setSubmissionStatus: setSubmissionStatus,
  addSchool: addSchool,
  updateSchool: updateSchool,
  setSchoolStatus: setSchoolStatus,
  promoteSubmissionSchool: promoteSubmissionSchool
};

function doGet(e) {
  try {
    return json_({ ok: true, service: CONFIG.TITLE + ' API' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = API_FUNCTIONS.hasOwnProperty(body.fn) ? API_FUNCTIONS[body.fn] : null;
    if (!fn) throw new Error('Unknown API function: ' + body.fn);
    return json_({ ok: true, result: fn.apply(null, Array.isArray(body.args) ? body.args : []) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


/* =========================================================================
 *  One-time setup (run from the Apps Script editor)
 * ========================================================================= */

function setup() {
  var ss = ss_();
  ensureSheet_(ss, CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA);
  ensureSheet_(ss, CONFIG.SHEETS.SUBMISSIONS, HEADERS.SUBMISSIONS);
  ensureSheet_(ss, CONFIG.SHEETS.AUDIT, HEADERS.AUDIT);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PIN')) {
    var pin = String(Math.floor(100000 + Math.random() * 900000));
    props.setProperty('ADMIN_PIN', pin);
    Logger.log('Admin PIN generated: ' + pin + '   (change it under Project Settings → Script Properties → ADMIN_PIN)');
  } else {
    Logger.log('Admin PIN already set (Project Settings → Script Properties → ADMIN_PIN).');
  }
  Logger.log('Setup complete. School master list detected: ' + readExternalSchools_().length + ' school(s).');
}

/** Generates a fresh random admin PIN and prints it to the execution log. */
function resetAdminPin() {
  var pin = String(Math.floor(100000 + Math.random() * 900000));
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pin);
  Logger.log('New admin PIN: ' + pin);
}


/* =========================================================================
 *  PUBLIC FORM API (no PIN)
 * ========================================================================= */

function getFormBootstrap() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(FORM_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var out = {
    meta: { title: CONFIG.TITLE, subtitle: CONFIG.SUBTITLE },
    districts: CONFIG.DISTRICTS,
    classes: CONFIG.CLASSES,
    institutionTypes: CONFIG.INSTITUTION_TYPES,
    reservationOptions: CONFIG.RESERVATIONS,
    noReservation: CONFIG.NO_RESERVATION,
    schools: mergedSchools_(false).map(function (s) {
      return { name: s.name, udise: s.udise, contact: s.contact, phone: s.phone, address: s.address };
    })
  };
  try { cache.put(FORM_CACHE_KEY, JSON.stringify(out), CONFIG.FORM_CACHE_SECONDS); } catch (e) { /* >100KB – skip cache */ }
  return out;
}

/**
 * payload = {
 *   schoolName, schoolSource: 'LISTED'|'NEW', udise, institutionType,
 *   district, subDistrict, address, totalStudents, classes: [...],
 *   contactName, contactPhone, coordinatorName, coordinatorPhone, email,
 *   reservations: [...], accessibility, parentConsent, photoConsent,
 *   medicalInfo, declaration
 * }
 */
function submitReservation(payload) {
  payload = payload || {};
  return withLock_(function () {
    var schoolName = clean_(payload.schoolName);
    if (!schoolName) throw new Error('School name is required.');

    var district = clean_(payload.district);
    if (!CONFIG.DISTRICTS.hasOwnProperty(district)) throw new Error('Select a valid educational district.');
    var subDistrict = clean_(payload.subDistrict);
    if (CONFIG.DISTRICTS[district].indexOf(subDistrict) < 0) throw new Error('Select a valid sub-district.');

    var institutionType = clean_(payload.institutionType);
    if (CONFIG.INSTITUTION_TYPES.indexOf(institutionType) < 0) throw new Error('Select whether the school is Aided, Unaided or Private.');

    // Classes, teacher coordinator, email, accessibility/consent and medical
    // info are intentionally NOT collected here — they're already gathered
    // by the separate registration/session-confirmation form that shares
    // this spreadsheet. Kept optional (not required) so old integrations or
    // a future combined form can still pass them through if ever needed.
    var classes = [].concat(payload.classes || []).map(clean_).filter(Boolean);

    var totalStudents = Number(payload.totalStudents);
    if (!isFinite(totalStudents) || totalStudents < 0 || Math.floor(totalStudents) !== totalStudents) {
      throw new Error('Enter a valid total number of students.');
    }

    var contactName = clean_(payload.contactName);
    var contactPhone = clean_(payload.contactPhone);
    if (!contactName) throw new Error('Contact person name is required.');
    if (!validPhone_(contactPhone)) throw new Error('Enter a valid contact person mobile number.');

    var coordName = clean_(payload.coordinatorName);
    var coordPhone = clean_(payload.coordinatorPhone);
    var email = clean_(payload.email);

    var reservations = [].concat(payload.reservations || []).map(clean_).filter(Boolean);
    if (reservations.indexOf(CONFIG.NO_RESERVATION) >= 0) reservations = [CONFIG.NO_RESERVATION];
    if (!reservations.length) throw new Error('Select at least one reservation option, or "No Reservations".');
    reservations.forEach(function (r) {
      if (r !== CONFIG.NO_RESERVATION && CONFIG.RESERVATIONS.indexOf(r) < 0) throw new Error('Unknown reservation category: ' + r);
    });

    if (!payload.declaration) throw new Error('Please confirm the declaration before submitting.');

    var sh = sheet_(CONFIG.SHEETS.SUBMISSIONS, HEADERS.SUBMISSIONS);
    var id = fmtId_('SUB', nextSeq_(sh, 'Submission ID', 'SUB'));
    var now = new Date();
    sh.appendRow([
      id, now, schoolName, clean_(payload.schoolSource) === 'NEW' ? 'NEW' : 'LISTED',
      clean_(payload.udise), institutionType, district, subDistrict, clean_(payload.address),
      totalStudents, classes.join(', '), contactName, contactPhone, coordName, coordPhone, email,
      reservations.join(', '), bool_(payload.accessibility) ? 'Yes' : 'No', bool_(payload.parentConsent) ? 'Yes' : 'No',
      bool_(payload.photoConsent) ? 'Yes' : 'No', clean_(payload.medicalInfo), true, STATUS.ACTIVE, now, ''
    ]);
    audit_([{ action: 'SUBMIT', id: id, next: schoolName + ' (' + district + ' / ' + subDistrict + ') submitted' }], 'Form');
    invalidate_();
    return { ok: true, id: id, message: 'Thank you! The confirmation for ' + schoolName + ' has been recorded.' };
  });
}


/* =========================================================================
 *  ADMIN API (every call requires the PIN)
 * ========================================================================= */

function getAdminBootstrap(pin) {
  auth_(pin);
  var ss = ss_();
  ensureSheet_(ss, CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA);
  ensureSheet_(ss, CONFIG.SHEETS.SUBMISSIONS, HEADERS.SUBMISSIONS);
  ensureSheet_(ss, CONFIG.SHEETS.AUDIT, HEADERS.AUDIT);
  var state = adminSnapshot_();
  state.user = activeEmail_();
  return state;
}

function getAdminState(pin) {
  auth_(pin);
  return adminSnapshot_();
}

/** changes = any subset of the submission fields (see submitReservation) */
function updateSubmission(pin, id, changes, official) {
  auth_(pin);
  changes = changes || {};
  return withLock_(function () {
    var sh = sheet_(CONFIG.SHEETS.SUBMISSIONS, HEADERS.SUBMISSIONS);
    var subs = readSubmissions_();
    var s = findBy_(subs, 'id', clean_(id));
    if (!s) throw new Error('Submission ' + id + ' not found.');

    var next = {
      'School Name': changes.schoolName != null ? clean_(changes.schoolName) : s.schoolName,
      'UDISE Code': changes.udise != null ? clean_(changes.udise) : s.udise,
      'Institution Type': changes.institutionType != null ? clean_(changes.institutionType) : s.institutionType,
      'Educational District': changes.district != null ? clean_(changes.district) : s.district,
      'Sub-District': changes.subDistrict != null ? clean_(changes.subDistrict) : s.subDistrict,
      'Address': changes.address != null ? clean_(changes.address) : s.address,
      'Total Students': changes.totalStudents != null ? Number(changes.totalStudents) : s.totalStudents,
      'Classes Participating': changes.classes != null ? [].concat(changes.classes).map(clean_).filter(Boolean).join(', ') : s.classes.join(', '),
      'Contact Person Name': changes.contactName != null ? clean_(changes.contactName) : s.contactName,
      'Contact Person Mobile': changes.contactPhone != null ? clean_(changes.contactPhone) : s.contactPhone,
      'Teacher Coordinator Name': changes.coordinatorName != null ? clean_(changes.coordinatorName) : s.coordinatorName,
      'Teacher Coordinator Mobile': changes.coordinatorPhone != null ? clean_(changes.coordinatorPhone) : s.coordinatorPhone,
      'Email': changes.email != null ? clean_(changes.email) : s.email,
      'Reservations': changes.reservations != null ? [].concat(changes.reservations).map(clean_).filter(Boolean).join(', ') : s.reservations.join(', '),
      'Accessibility Support': changes.accessibility != null ? (bool_(changes.accessibility) ? 'Yes' : 'No') : (s.accessibility ? 'Yes' : 'No'),
      'Parent Consent': changes.parentConsent != null ? (bool_(changes.parentConsent) ? 'Yes' : 'No') : (s.parentConsent ? 'Yes' : 'No'),
      'Photo Video Consent': changes.photoConsent != null ? (bool_(changes.photoConsent) ? 'Yes' : 'No') : (s.photoConsent ? 'Yes' : 'No'),
      'Medical Info': changes.medicalInfo != null ? clean_(changes.medicalInfo) : s.medicalInfo
    };
    if (!next['School Name']) throw new Error('School name is required.');
    if (!CONFIG.DISTRICTS.hasOwnProperty(next['Educational District'])) throw new Error('Invalid educational district.');
    if (CONFIG.DISTRICTS[next['Educational District']].indexOf(next['Sub-District']) < 0) throw new Error('Invalid sub-district.');

    var user = actor_(official);
    var now = new Date();
    setCells_(sh, colMap_(sh), s._row, mergeObj_(next, { 'Updated At': now, 'Updated By': user }));
    audit_([{ action: 'UPDATE', id: s.id, prev: describeSubmission_(s), next: next['School Name'] + ' updated' }], user);
    invalidate_();
    return { ok: true, message: 'Submission ' + s.id + ' updated.', state: adminSnapshot_() };
  });
}

/** status = 'DELETED' (soft delete) or 'ACTIVE' (restore) */
function setSubmissionStatus(pin, id, status, official) {
  auth_(pin);
  status = key_(status);
  if (status !== STATUS.ACTIVE && status !== STATUS.DELETED) throw new Error('Invalid status.');
  return withLock_(function () {
    var sh = sheet_(CONFIG.SHEETS.SUBMISSIONS, HEADERS.SUBMISSIONS);
    var s = findBy_(readSubmissions_(), 'id', clean_(id));
    if (!s) throw new Error('Submission ' + id + ' not found.');
    var user = actor_(official);
    var now = new Date();
    setCells_(sh, colMap_(sh), s._row, { 'Status': status, 'Updated At': now, 'Updated By': user });
    audit_([{ action: status === STATUS.DELETED ? 'DELETE' : 'RESTORE', id: s.id, prev: describeSubmission_(s), next: status }], user);
    invalidate_();
    return { ok: true, message: 'Submission ' + s.id + (status === STATUS.DELETED ? ' deleted.' : ' restored.'), state: adminSnapshot_() };
  });
}

/** school = { name, udise, contact, phone, address, district, subDistrict, institutionType } */
function addSchool(pin, school, official) {
  auth_(pin);
  school = school || {};
  var name = clean_(school.name);
  if (!name) throw new Error('School name is required.');
  return withLock_(function () {
    var sh = sheet_(CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA);
    var existing = findBy_(readObjects_(sh).map(mapSchoolExtra_), 'nameKey', norm_(name));
    if (existing && existing.status === STATUS.ACTIVE) throw new Error(name + ' is already in the school list.');
    var user = actor_(official);
    var now = new Date();
    if (existing) {
      setCells_(sh, colMap_(sh), existing._row, {
        'UDISE Code': clean_(school.udise), 'Contact Person': clean_(school.contact), 'Phone': clean_(school.phone),
        'Address': clean_(school.address), 'Educational District': clean_(school.district), 'Sub-District': clean_(school.subDistrict),
        'Institution Type': clean_(school.institutionType), 'Status': STATUS.ACTIVE, 'Added At': now, 'Added By': user
      });
    } else {
      sh.appendRow([name, clean_(school.udise), clean_(school.contact), clean_(school.phone), clean_(school.address),
        clean_(school.district), clean_(school.subDistrict), clean_(school.institutionType), STATUS.ACTIVE, now, user]);
    }
    audit_([{ action: 'SCHOOL_ADD', next: name + ' added to school list' }], user);
    invalidate_();
    return { ok: true, message: name + ' added to the school list.', state: adminSnapshot_() };
  });
}

function updateSchool(pin, name, changes, official) {
  auth_(pin);
  changes = changes || {};
  return withLock_(function () {
    var sh = sheet_(CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA);
    var row = findBy_(readObjects_(sh).map(mapSchoolExtra_), 'nameKey', norm_(clean_(name)));
    if (!row) throw new Error('School "' + name + '" was not found in the managed school list.');
    var user = actor_(official);
    var next = {};
    if (changes.name != null) next['School Name'] = clean_(changes.name);
    if (changes.udise != null) next['UDISE Code'] = clean_(changes.udise);
    if (changes.contact != null) next['Contact Person'] = clean_(changes.contact);
    if (changes.phone != null) next['Phone'] = clean_(changes.phone);
    if (changes.address != null) next['Address'] = clean_(changes.address);
    if (changes.district != null) next['Educational District'] = clean_(changes.district);
    if (changes.subDistrict != null) next['Sub-District'] = clean_(changes.subDistrict);
    if (changes.institutionType != null) next['Institution Type'] = clean_(changes.institutionType);
    next['Added At'] = new Date();
    next['Added By'] = user;
    setCells_(sh, colMap_(sh), row._row, next);
    audit_([{ action: 'SCHOOL_UPDATE', next: (next['School Name'] || row.name) + ' updated' }], user);
    invalidate_();
    return { ok: true, message: 'School updated.', state: adminSnapshot_() };
  });
}

function setSchoolStatus(pin, name, status, official) {
  auth_(pin);
  status = key_(status);
  if (status !== STATUS.ACTIVE && status !== STATUS.DELETED) throw new Error('Invalid status.');
  return withLock_(function () {
    var sh = sheet_(CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA);
    var row = findBy_(readObjects_(sh).map(mapSchoolExtra_), 'nameKey', norm_(clean_(name)));
    if (!row) throw new Error('School "' + name + '" was not found in the managed school list.');
    var user = actor_(official);
    setCells_(sh, colMap_(sh), row._row, { 'Status': status, 'Added At': new Date(), 'Added By': user });
    audit_([{ action: status === STATUS.DELETED ? 'SCHOOL_REMOVE' : 'SCHOOL_RESTORE', next: row.name }], user);
    invalidate_();
    return { ok: true, message: row.name + (status === STATUS.DELETED ? ' removed from the school list.' : ' restored.'), state: adminSnapshot_() };
  });
}

/** Convenience: copies a "school not listed" submission's details into the managed school list. */
function promoteSubmissionSchool(pin, id, official) {
  auth_(pin);
  var s = findBy_(readSubmissions_(), 'id', clean_(id));
  if (!s) throw new Error('Submission ' + id + ' not found.');
  return addSchool(pin, {
    name: s.schoolName, udise: s.udise, contact: s.contactName, phone: s.contactPhone, address: s.address,
    district: s.district, subDistrict: s.subDistrict, institutionType: s.institutionType
  }, official);
}


/* =========================================================================
 *  Dashboard aggregation
 * ========================================================================= */

function adminSnapshot_() {
  var subs = readSubmissions_();
  var active = subs.filter(function (s) { return s.status === STATUS.ACTIVE; });

  var totalStudents = active.reduce(function (a, s) { return a + (s.totalStudents || 0); }, 0);
  var byInstitution = counter_(active, function (s) { return s.institutionType || 'Not specified'; });
  var byDistrict = counter_(active, function (s) { return s.district || 'Not specified'; });
  var bySubDistrict = counter_(active, function (s) { return (s.district || '?') + ' — ' + (s.subDistrict || 'Not specified'); });
  var byClassMap = {};
  active.forEach(function (s) { s.classes.forEach(function (c) { byClassMap[c] = (byClassMap[c] || 0) + 1; }); });

  var reservationCounts = {};
  CONFIG.RESERVATIONS.concat([CONFIG.NO_RESERVATION]).forEach(function (r) { reservationCounts[r] = 0; });
  active.forEach(function (s) { s.reservations.forEach(function (r) { reservationCounts[r] = (reservationCounts[r] || 0) + 1; }); });

  return {
    meta: { title: CONFIG.TITLE, subtitle: CONFIG.SUBTITLE, serverTime: Date.now() },
    kpis: {
      schools: active.length,
      totalStudents: totalStudents,
      districts: Object.keys(byDistrict).length,
      accessibility: active.filter(function (s) { return s.accessibility; }).length,
      parentConsent: active.filter(function (s) { return s.parentConsent; }).length,
      photoConsent: active.filter(function (s) { return s.photoConsent; }).length,
      needingReservation: active.filter(function (s) { return s.reservations.indexOf(CONFIG.NO_RESERVATION) < 0; }).length
    },
    byInstitution: toList_(byInstitution),
    byDistrict: toList_(byDistrict),
    bySubDistrict: toList_(bySubDistrict),
    byClass: CONFIG.CLASSES.map(function (c) { return { name: 'Class ' + c, count: byClassMap[c] || 0 }; }),
    reservations: CONFIG.RESERVATIONS.concat([CONFIG.NO_RESERVATION]).map(function (r) { return { name: r, count: reservationCounts[r] || 0 }; }),
    submissions: subs.map(publicSubmission_).sort(function (a, b) { return b.ts - a.ts; }),
    schoolsExtra: readObjects_(sheet_(CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA)).map(mapSchoolExtra_),
    districts: CONFIG.DISTRICTS,
    classes: CONFIG.CLASSES,
    institutionTypes: CONFIG.INSTITUTION_TYPES,
    reservationOptions: CONFIG.RESERVATIONS,
    noReservation: CONFIG.NO_RESERVATION
  };
}


/* =========================================================================
 *  Schools (external master list, read-only, fuzzy header matching)
 * ========================================================================= */

/** Reads the school master list. Header text is matched case/punctuation-insensitively. */
function readExternalSchools_() {
  var ss = ss_();
  var sh = null;
  var forced = PropertiesService.getScriptProperties().getProperty('SCHOOLS_SHEET_NAME');
  if (forced) sh = ss.getSheetByName(forced);
  if (!sh) {
    ['Schools', 'School List', 'Master List', 'Master', 'Sheet1'].some(function (n) {
      sh = ss.getSheetByName(n);
      return !!sh;
    });
  }
  if (!sh) {
    var reserved = [CONFIG.SHEETS.SCHOOLS_EXTRA, CONFIG.SHEETS.SUBMISSIONS, CONFIG.SHEETS.AUDIT];
    ss.getSheets().some(function (candidate) {
      if (reserved.indexOf(candidate.getName()) < 0) { sh = candidate; return true; }
      return false;
    });
  }
  if (!sh) return [];

  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var idx = {};
  values[0].forEach(function (h, i) { var n = norm_(h); if (idx[n] === undefined) idx[n] = i; });
  var col = function (names) {
    for (var i = 0; i < names.length; i++) if (idx[names[i]] !== undefined) return idx[names[i]];
    return -1;
  };
  var cName = col(['schoolname', 'nameoftheschool', 'institutionname', 'name']);
  var cUdise = col(['udisecode', 'udise', 'udisenumber']);
  var cContact = col(['hmcontact', 'hm', 'contact', 'contactperson', 'headofinstitutioncontact', 'headmaster', 'principal', 'contactname', 'nameofcontact']);
  var cPhone = col(['phone', 'mobile', 'phonenumber', 'mobilenumber', 'contactnumber', 'hmmobile', 'hmphone']);
  var cAddress = col(['address', 'schooladdress', 'fulladdress']);
  if (cName < 0) return [];
  var get = function (row, c) { return c < 0 ? '' : row[c]; };

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var nm = clean_(get(row, cName));
    if (!nm) continue;
    out.push({
      name: nm, udise: clean_(get(row, cUdise)), contact: clean_(get(row, cContact)),
      phone: clean_(get(row, cPhone)), address: clean_(get(row, cAddress)), source: 'LISTED'
    });
  }
  return out;
}

/** External master list merged with the dashboard-managed Schools_Extra list. */
function mergedSchools_(includeInactive) {
  var map = {};
  readExternalSchools_().forEach(function (s) { map[norm_(s.name)] = s; });
  readObjects_(sheet_(CONFIG.SHEETS.SCHOOLS_EXTRA, HEADERS.SCHOOLS_EXTRA)).map(mapSchoolExtra_).forEach(function (r) {
    if (!r.name) return;
    if (r.status === STATUS.DELETED && !includeInactive) { delete map[r.nameKey]; return; }
    map[r.nameKey] = { name: r.name, udise: r.udise, contact: r.contact, phone: r.phone, address: r.address, source: 'LISTED' };
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function mapSchoolExtra_(r) {
  return {
    name: clean_(r['School Name']), nameKey: norm_(r['School Name']), udise: clean_(r['UDISE Code']),
    contact: clean_(r['Contact Person']), phone: clean_(r['Phone']), address: clean_(r['Address']),
    district: clean_(r['Educational District']), subDistrict: clean_(r['Sub-District']),
    institutionType: clean_(r['Institution Type']), status: key_(r['Status']) || STATUS.ACTIVE,
    addedAt: toMs_(r['Added At']), addedBy: clean_(r['Added By']), _row: r._row
  };
}


/* =========================================================================
 *  Sheet access
 * ========================================================================= */

function ss_() {
  var id = CONFIG.SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Bind the script to the school master sheet or set SPREADSHEET_ID.');
  return ss;
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function (v) { return v === '' || v === null; });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1f3d3d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function sheet_(name, headers) {
  var ss = ss_();
  return ss.getSheetByName(name) || ensureSheet_(ss, name, headers);
}

/** Reads a sheet into objects keyed by header text. Adds `_row` (1-based). */
function readObjects_(sh) {
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(clean_);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i], o = { _row: i + 1 }, blank = true;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      o[headers[j]] = row[j];
      if (row[j] !== '' && row[j] !== null) blank = false;
    }
    if (!blank) out.push(o);
  }
  return out;
}

function colMap_(sh) {
  var map = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach(function (h, i) { map[clean_(h)] = i + 1; });
  return map;
}

function setCells_(sh, cols, row, values) {
  Object.keys(values).forEach(function (h) {
    if (!cols[h]) throw new Error('Column "' + h + '" missing in ' + sh.getName());
    sh.getRange(row, cols[h]).setValue(values[h]);
  });
}

function readSubmissions_() {
  return readObjects_(ss_().getSheetByName(CONFIG.SHEETS.SUBMISSIONS)).map(function (r) {
    return {
      id: clean_(r['Submission ID']), ts: toMs_(r['Timestamp']), schoolName: clean_(r['School Name']),
      schoolSource: clean_(r['School Source']) || 'LISTED', udise: clean_(r['UDISE Code']),
      institutionType: clean_(r['Institution Type']), district: clean_(r['Educational District']),
      subDistrict: clean_(r['Sub-District']), address: clean_(r['Address']),
      totalStudents: Number(r['Total Students']) || 0,
      classes: splitList_(r['Classes Participating']),
      contactName: clean_(r['Contact Person Name']), contactPhone: clean_(r['Contact Person Mobile']),
      coordinatorName: clean_(r['Teacher Coordinator Name']), coordinatorPhone: clean_(r['Teacher Coordinator Mobile']),
      email: clean_(r['Email']), reservations: splitList_(r['Reservations']),
      accessibility: yes_(r['Accessibility Support']), parentConsent: yes_(r['Parent Consent']),
      photoConsent: yes_(r['Photo Video Consent']), medicalInfo: clean_(r['Medical Info']),
      status: key_(r['Status']) || STATUS.ACTIVE, updatedAt: toMs_(r['Updated At']), updatedBy: clean_(r['Updated By']),
      _row: r._row
    };
  }).filter(function (s) { return s.id; });
}

function publicSubmission_(s) {
  return {
    id: s.id, ts: s.ts, schoolName: s.schoolName, schoolSource: s.schoolSource, udise: s.udise,
    institutionType: s.institutionType, district: s.district, subDistrict: s.subDistrict, address: s.address,
    totalStudents: s.totalStudents, classes: s.classes, contactName: s.contactName, contactPhone: s.contactPhone,
    coordinatorName: s.coordinatorName, coordinatorPhone: s.coordinatorPhone, email: s.email,
    reservations: s.reservations, accessibility: s.accessibility, parentConsent: s.parentConsent,
    photoConsent: s.photoConsent, medicalInfo: s.medicalInfo, status: s.status, updatedAt: s.updatedAt, updatedBy: s.updatedBy
  };
}

function describeSubmission_(s) {
  return s.schoolName + ' | ' + s.district + ' / ' + s.subDistrict + ' | ' + s.totalStudents + ' students | ' + s.status;
}

function audit_(entries, user) {
  if (!entries || !entries.length) return;
  var sh = sheet_(CONFIG.SHEETS.AUDIT, HEADERS.AUDIT);
  var now = new Date();
  var rows = entries.map(function (a) {
    return [now, a.action, a.id || '', a.prev || '', a.next || '', user || 'Form'];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.AUDIT.length).setValues(rows);
}


/* =========================================================================
 *  Helpers
 * ========================================================================= */

function auth_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!expected) throw new Error('Admin PIN is not configured. Run setup() in the Apps Script editor.');
  if (String(pin == null ? '' : pin).trim() !== String(expected).trim()) throw new Error('Invalid PIN');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function invalidate_() {
  try { CacheService.getScriptCache().remove(FORM_CACHE_KEY); } catch (e) { /* ignore */ }
}

function activeEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function actor_(official) {
  var parts = [clean_(official), activeEmail_()].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Dashboard';
}

function counter_(list, keyFn) {
  var map = {};
  list.forEach(function (item) { var k = keyFn(item); map[k] = (map[k] || 0) + 1; });
  return map;
}

function toList_(map) {
  return Object.keys(map).map(function (k) { return { name: k, count: map[k] }; }).sort(function (a, b) { return b.count - a.count; });
}

function mergeObj_(a, b) {
  var o = {};
  Object.keys(a).forEach(function (k) { o[k] = a[k]; });
  Object.keys(b).forEach(function (k) { o[k] = b[k]; });
  return o;
}

function findBy_(list, field, value) {
  for (var i = 0; i < list.length; i++) if (list[i][field] === value) return list[i];
  return null;
}

function nextSeq_(sh, header, prefix) {
  var cols = colMap_(sh);
  var c = cols[header];
  if (!c) return 1;
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(2, c, last - 1, 1).getValues();
  var re = new RegExp('^' + prefix + '-(\\d+)$');
  var max = 0;
  vals.forEach(function (row) { var m = re.exec(String(row[0] || '')); if (m) max = Math.max(max, Number(m[1])); });
  return max + 1;
}

function fmtId_(prefix, n) {
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return prefix + '-' + s;
}

function validPhone_(s) {
  var digits = String(s == null ? '' : s).replace(/\D/g, '');
  return digits.length >= 10;
}

function bool_(v) { return v === true || v === 'true' || v === 'Yes' || v === 'yes' || v === 1; }
function yes_(v) { return key_(v) === 'YES' || v === true; }

function splitList_(s) {
  return String(s == null ? '' : s).split(/[,;\n|]+/).map(clean_).filter(Boolean);
}

function clean_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function key_(s) { return clean_(s).toUpperCase(); }
function norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function toMs_(v) {
  if (v instanceof Date) return v.getTime();
  if (v === '' || v === null || v === undefined) return 0;
  var d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
