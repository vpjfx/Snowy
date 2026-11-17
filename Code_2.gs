/**
 * SNOWY — servidor (Google Apps Script)
 *
 * Qué hace: guarda los leads, los trabajos de la galería, el equipo y el estado
 * de la cuadrilla en TU hoja de Google. El sitio web (index.html) habla con este
 * archivo. Pasos de instalación: mira LEEME.md.
 *
 * Seguridad en corto:
 *  - Cualquier persona puede MANDAR un lead y VER la parte pública (precios, clima,
 *    galería, disponibilidad). Nada más.
 *  - Todo lo demás exige entrar con nombre + PIN (pestaña "Team" de la hoja).
 *  - Los PIN solo viven en tu hoja. Tras 5 intentos fallidos se bloquea 15 min.
 *  - No se guardan coordenadas del equipo, solo la zona que ellos escriben.
 *  - Seguimiento tipo "Uber": cada lead tiene un código largo y secreto (tk). Con él el
 *    cliente ve el estado y el tiempo estimado. La ubicación del equipo vive solo unos
 *    minutos en la memoria temporal del servidor, nunca en la hoja, y el cliente nunca
 *    recibe coordenadas: solo la distancia aproximada.
 */

var TZ = 'America/Chicago';
var STALE_HOURS = 14;      // un estado de equipo más viejo que esto se considera "fuera"
var TOKEN_HOURS = 12;      // cuánto dura la sesión del panel
var SERVICES = ['driveway', 'walks', 'patio', 'salt', 'season'];
var STATUSES = ['nuevo', 'contactado', 'cotizado', 'agendado', 'completado', 'pagado', 'perdido'];
var PAY_METHODS = ['zelle', 'cashapp', 'btc', 'cash'];
var CREW_STATES = ['working', 'available', 'off'];
var TRACK_STAGES = ['enroute', 'arrived', 'working', 'done'];
var LEAD_JSON_COL = 14, LEAD_TK_COL = 15;
var SOURCES = ['web', 'phone', 'text', 'facebook', 'referral', 'door'];

var SHEETS = {
  Leads: ['id', 'creado', 'estado', 'nombre', 'telefono', 'email', 'direccion', 'ciudad', 'servicios', 'cotizacion', 'cobrado', 'fecha_servicio', 'asignado', 'json', 'tk'],
  Jobs: ['id', 'fecha', 'lugar', 'servicios', 'json'],
  Team: ['nombre', 'pin', 'rol', 'activo', 'zonas'],
  Crew: ['nombre', 'estado', 'lugar', 'hasta', 'nota', 'actualizado'],
  Config: ['clave', 'valor']
};
var NUMERIC_COLS = { Leads: [10, 11] };

var DEFAULT_CONFIG = {
  brand: 'Snowy', area: 'Chicagoland, IL', hours: '', phone: '', email: '', notifyEmail: '',
  trigger: 2, insured: false, license: '', zelle: '', zelleName: '', cashtag: '', btc: '',
  cashOK: true, terms: 'completion',
  prices: { drive_s: 45, drive_m: 70, drive_l: 110, walks: 20, patio: 30, salt: 25 },
  baseLat: 41.8781, baseLng: -87.6298, radius: 35, showCrew: true, zones: []
};
var PUBLIC_KEYS = ['brand', 'area', 'hours', 'phone', 'email', 'trigger', 'insured', 'license', 'zelle', 'zelleName',
  'cashtag', 'btc', 'cashOK', 'terms', 'prices', 'baseLat', 'baseLng', 'radius', 'showCrew', 'zones'];

/* ================= entradas web ================= */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'public';
  var out;
  try {
    if (action === 'ping') out = { ok: true, service: 'snowy', ready: !!ss_().getSheetByName('Team') };
    else if (action === 'public') out = publicPayload_();
    else if (action === 'track') out = track_(e.parameter.t);
    else out = { ok: false, error: 'unknown' };
  } catch (err) {
    console.error(err);
    out = { ok: false, error: 'server' };
  }
  return json_(out);
}

function doPost(e) {
  var out;
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = route_(d);
  } catch (err) {
    console.error(err);
    out = { ok: false, error: 'server' };
  }
  return json_(out);
}

function route_(d) {
  if (!d || typeof d !== 'object') return fail_('bad_request');
  if (d.action === 'submitLead') return withLock_(function () { return submitLead_(d.lead, d.link); });
  if (d.action === 'login') return login_(d);
  var me = readToken_(d.token);
  if (!me) return fail_('auth');
  switch (d.action) {
    case 'panel': return panel_(me);
    case 'addLead': return withLock_(function () { return addLead_(me, d.lead); });
    case 'patchLead': return withLock_(function () { return patchLead_(me, d.id, d.patch); });
    case 'deleteLead': return me.role === 'owner' ? withLock_(function () { return deleteLead_(d.id); }) : fail_('forbidden');
    case 'saveJob': return withLock_(function () { return saveJob_(d.job); });
    case 'deleteJob': return me.role === 'owner' ? withLock_(function () { return deleteJob_(d.id); }) : fail_('forbidden');
    case 'uploadPhoto': return uploadPhoto_(d.data);
    case 'setStatus': return withLock_(function () { return setStatus_(me, d.status); });
    case 'setTrack': return withLock_(function () { return setTrack_(me, d); });
    case 'ping': return ping_(d);
    case 'saveConfig': return me.role === 'owner' ? withLock_(function () { return saveConfig_(d.config); }) : fail_('forbidden');
    default: return fail_('unknown');
  }
}

/* ================= instalación ================= */

/** Ejecútala UNA vez desde el editor. Crea las pestañas, los PIN y la carpeta de fotos. */
function setup() {
  Object.keys(SHEETS).forEach(function (n) { sheet_(n); });
  var team = sheet_('Team');
  if (team.getLastRow() < 2) {
    var rows = [['Dueño', pin_(), 'owner', 'TRUE', ''], ['Equipo 1', pin_(), 'crew', 'TRUE', ''], ['Equipo 2', pin_(), 'crew', 'TRUE', ''], ['Equipo 3', pin_(), 'crew', 'TRUE', '']];
    team.getRange(2, 1, rows.length, 5).setValues(rows);
  }
  ensureHeaders_();
  if (!rows_('Config').length) saveConfig_(DEFAULT_CONFIG);
  secret_();
  photoFolder_();
  var msg = 'Listo. Abre la pestaña "Team": ahí están los nombres y los PIN. Cámbialos por los de tu gente (máximo 4). Después: Implementar > Nueva implementación > Aplicación web.';
  Logger.log(msg);
  return msg;
}

/** Si ya tenías la hoja de una versión anterior, agrega las columnas nuevas sin tocar tus datos. */
function ensureHeaders_() {
  Object.keys(SHEETS).forEach(function (n) {
    var sh = sheet_(n), head = SHEETS[n], numeric = NUMERIC_COLS[n] || [];
    for (var c = 1; c <= head.length; c++) {
      if (!String(sh.getRange(1, c).getValue()).trim()) {
        sh.getRange(1, c).setValue(head[c - 1]).setFontWeight('bold');
        if (numeric.indexOf(c) < 0) sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
      }
    }
  });
}

function pin_() { return ('' + Math.floor(100000 + Math.random() * 900000)); }

/* ================= acceso a la hoja ================= */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var numeric = NUMERIC_COLS[name] || [];
    for (var c = 1; c <= head.length; c++) {
      if (numeric.indexOf(c) < 0) sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
    }
  }
  return sh;
}

function rows_(name) {
  var sh = sheet_(name), n = sh.getLastRow();
  if (n < 2) return [];
  var head = SHEETS[name];
  var vals = sh.getRange(2, 1, n - 1, head.length).getDisplayValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = typeof r[j] === 'string' ? r[j].trim() : r[j]; });
    return o;
  });
}

/** Evita que un texto escrito por un cliente se interprete como fórmula de la hoja. */
function cell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? ' ' + v : v;
}

function parseJson_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(code, field) { var o = { ok: false, error: code }; if (field) o.field = field; return o; }

/* ================= validación ================= */

function str_(v, max) { return (typeof v === 'string' ? v : (v == null ? '' : String(v))).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function num_(v, min, max) { var n = Number(v); return isFinite(n) && v !== '' && v !== null && n >= min && n <= max ? n : null; }
function oneOf_(v, list, dflt) { return list.indexOf(v) > -1 ? v : dflt; }
function digits_(s) { return String(s || '').replace(/\D/g, ''); }
function isDate_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function cleanLead_(l, fromTeam) {
  if (!l || typeof l !== 'object') return { err: fail_('invalid') };
  var services = (Array.isArray(l.services) ? l.services : []).filter(function (s) { return SERVICES.indexOf(s) > -1; });
  services = services.filter(function (s, i) { return services.indexOf(s) === i; });
  var c = {
    name: str_(l.name, 80), phone: str_(l.phone, 30), email: str_(l.email, 120),
    address: str_(l.address, 140), city: str_(l.city, 60), zip: str_(l.zip, 10),
    lat: num_(l.lat, -90, 90), lng: num_(l.lng, -180, 180), distMi: num_(l.distMi, 0, 5000),
    inArea: typeof l.inArea === 'boolean' ? l.inArea : null,
    ptype: oneOf_(l.ptype, ['home', 'biz'], 'home'), size: oneOf_(l.size, ['s', 'm', 'l'], 's'),
    services: services, freq: oneOf_(l.freq, ['once', 'storm', 'season'], 'storm'),
    urgency: oneOf_(l.urgency, ['now', '24', 'week', 'plan'], '24'), contact: oneOf_(l.contact, ['text', 'call', 'email'], 'text'),
    notes: str_(l.notes, 800), lang: l.lang === 'es' ? 'es' : 'en',
    source: fromTeam ? oneOf_(l.source, SOURCES, 'phone') : 'web'
  };
  if (c.name.length < 2) return { err: fail_('invalid', 'name') };
  if (digits_(c.phone).length < 10) return { err: fail_('invalid', 'phone') };
  if (c.address.length < 5) return { err: fail_('invalid', 'address') };
  if (!c.services.length) return { err: fail_('invalid', 'services') };
  if (c.lat === null || c.lng === null) { c.lat = null; c.lng = null; }
  return { lead: c };
}

/* ================= leads ================= */

function leadRow_(l) {
  var paid = (l.payments || []).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
  return [l.id, Utilities.formatDate(new Date(l.createdAt), TZ, 'yyyy-MM-dd HH:mm'), l.status, cell_(l.name), cell_(l.phone), cell_(l.email),
    cell_(l.address), cell_(l.city), cell_((l.services || []).join(', ')), l.quote == null ? '' : l.quote, paid || '',
    l.scheduledFor || '', cell_(l.assignee || ''), JSON.stringify(l), l.tk || ''];
}

function findLeadRow_(id) {
  var sh = sheet_('Leads'), n = sh.getLastRow();
  if (n < 2 || !id) return null;
  var ids = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return null;
}

function newLead_(clean) {
  var cfg = getConfig_();
  var id = 'l' + Date.now().toString(36) + Utilities.getUuid().replace(/-/g, '').slice(0, 4);
  var brand = (cfg.brand || 'SN').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'SN';
  var lead = { id: id, code: brand + '-' + id.slice(-4).toUpperCase(), createdAt: Date.now(), status: 'nuevo' };
  Object.keys(clean).forEach(function (k) { lead[k] = clean[k]; });
  lead.quote = null; lead.scheduledFor = ''; lead.internalNotes = ''; lead.payments = []; lead.assignee = '';
  lead.tk = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  lead.zone = zoneFor_(cfg.zones, lead.city, lead.zip);
  var sh = sheet_('Leads');
  sh.getRange(sh.getLastRow() + 1, 1, 1, SHEETS.Leads.length).setValues([leadRow_(lead)]);
  return lead;
}

function submitLead_(raw, link) {
  if (raw && typeof raw.website === 'string' && raw.website.trim()) return { ok: true, code: 'SN-0000' }; // trampa para robots
  var res = cleanLead_(raw, false);
  if (res.err) return res.err;
  var cache = CacheService.getScriptCache();
  var dupKey = 'dup_' + digits_(res.lead.phone).slice(-10);
  var prev = cache.get(dupKey);
  if (prev) { var pd = parseJson_(prev) || {}; return { ok: true, code: pd.c || '', tk: pd.t || '', duplicate: true }; }
  var hour = +cache.get('rl_hour') || 0;
  if (hour >= 60) return fail_('busy');
  var lead = newLead_(res.lead);
  cache.put('rl_hour', String(hour + 1), 3600);
  cache.put(dupKey, JSON.stringify({ c: lead.code, t: lead.tk }), 600);
  notifyNewLead_(lead);
  mailCustomer_(lead, 'received', safeLink_(link));
  return { ok: true, id: lead.id, code: lead.code, tk: lead.tk };
}

function addLead_(me, raw) {
  var res = cleanLead_(raw, true);
  if (res.err) return res.err;
  return { ok: true, lead: newLead_(res.lead) };
}

function patchLead_(me, id, patch) {
  var row = findLeadRow_(id);
  if (!row || !patch || typeof patch !== 'object') return fail_('not_found');
  var sh = sheet_('Leads');
  var lead = parseJson_(sh.getRange(row, LEAD_JSON_COL).getValue());
  if (!lead) return fail_('not_found');
  if ('status' in patch && STATUSES.indexOf(patch.status) > -1) lead.status = patch.status;
  if ('quote' in patch) lead.quote = patch.quote === null || patch.quote === '' ? null : num_(patch.quote, 0, 1000000);
  if ('lat' in patch && 'lng' in patch) {
    var la = num_(patch.lat, -90, 90), ln = num_(patch.lng, -180, 180);
    if (la !== null && ln !== null) { lead.lat = la; lead.lng = ln; }
  }
  if ('scheduledFor' in patch && (patch.scheduledFor === '' || isDate_(patch.scheduledFor))) lead.scheduledFor = patch.scheduledFor;
  if ('internalNotes' in patch) lead.internalNotes = str_(patch.internalNotes, 2000);
  if ('assignee' in patch) {
    var who = str_(patch.assignee, 40);
    lead.assignee = (who && findMember_(who)) ? findMember_(who).name : '';
  }
  if ('payments' in patch && Array.isArray(patch.payments)) {
    lead.payments = patch.payments.slice(0, 50).map(function (p) {
      return { id: str_(p && p.id, 24) || ('p' + Date.now().toString(36)), method: oneOf_(p && p.method, PAY_METHODS, 'cash'),
        amount: Math.round((num_(p && p.amount, 0, 1000000) || 0) * 100) / 100, ref: str_(p && p.ref, 80), at: num_(p && p.at, 0, 4102444800000) || Date.now() };
    });
  }
  lead.updatedBy = me.name; lead.updatedAt = Date.now();
  sh.getRange(row, 1, 1, SHEETS.Leads.length).setValues([leadRow_(lead)]);
  try { CacheService.getScriptCache().remove('trk_' + lead.tk); } catch (e) { /* nada */ }
  return { ok: true, lead: lead };
}

function deleteLead_(id) {
  var row = findLeadRow_(id);
  if (!row) return fail_('not_found');
  sheet_('Leads').deleteRow(row);
  return { ok: true };
}

function notifyNewLead_(lead) {
  try {
    var cfg = getConfig_();
    var to = cfg.notifyEmail || Session.getEffectiveUser().getEmail();
    if (!to) return;
    var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lead.lat != null ? lead.lat + ',' + lead.lng : lead.address + ' ' + lead.city);
    var lines = ['Nuevo lead ' + lead.code, '', 'Nombre: ' + lead.name, 'Teléfono: ' + lead.phone];
    if (lead.email) lines.push('Email: ' + lead.email);
    lines.push('Dirección: ' + lead.address + (lead.city ? ', ' + lead.city : ''));
    if (lead.inArea === false) lines.push('OJO: fuera de tu zona de servicio (' + (lead.distMi != null ? Math.round(lead.distMi) + ' mi' : '?') + ')');
    if (lead.zone) {
      var sug = members_().filter(function (m) { return m.active && m.role === 'crew' && (!m.zones.length || m.zones.indexOf(lead.zone) > -1); }).map(function (m) { return m.name; });
      lines.push('Zona: ' + lead.zone + (sug.length ? ' (cubre: ' + sug.join(', ') + ')' : ''));
    }
    lines.push('Servicios: ' + lead.services.join(', '), 'Cuándo: ' + lead.urgency, 'Prefiere: ' + lead.contact + ' (' + lead.lang + ')');
    if (lead.notes) lines.push('Notas: ' + lead.notes);
    lines.push('', 'Mapa: ' + maps);
    MailApp.sendEmail(to, '[' + cfg.brand + '] Nuevo lead ' + lead.code + ' — ' + lead.name, lines.join('\n'));
  } catch (err) { console.error('mail: ' + err); }
}

/* ================= trabajos (galería) ================= */

function photoFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* la borraron: crear otra */ } }
  var f = DriveApp.createFolder('Snowy fotos');
  p.setProperty('FOLDER_ID', f.getId());
  return f;
}

function inFolder_(fileId) {
  try {
    var f = DriveApp.getFileById(fileId), fid = photoFolder_().getId(), ps = f.getParents();
    while (ps.hasNext()) if (ps.next().getId() === fid) return f;
  } catch (e) { /* no existe */ }
  return null;
}

function uploadPhoto_(dataUrl) {
  var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl || ''));
  if (!m || m[2].length > 4000000) return fail_('invalid');
  var ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'snowy-' + Date.now() + '.' + ext);
  var file = photoFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId() };
}

function findJobRow_(id) {
  var list = rows_('Jobs');
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]._row;
  return null;
}

function jobRow_(j) {
  return [j.id, j.date, cell_(j.place), cell_((j.services || []).join(', ')), JSON.stringify(j)];
}

function saveJob_(raw) {
  if (!raw || typeof raw !== 'object') return fail_('invalid');
  var services = (Array.isArray(raw.services) ? raw.services : []).filter(function (s) { return SERVICES.indexOf(s) > -1 && s !== 'season'; });
  var photoB = str_(raw.photoB, 80), photoA = str_(raw.photoA, 80);
  var id = str_(raw.id, 24).replace(/[^A-Za-z0-9_-]/g, '') || ('j' + Date.now().toString(36));
  var job = { id: id, date: raw.date, place: str_(raw.place, 120), services: services, note: str_(raw.note, 60), consent: raw.consent === true, photoB: photoB, photoA: photoA };
  if (!isDate_(job.date)) return fail_('invalid', 'date');
  if (job.place.length < 4) return fail_('invalid', 'place');
  if (!services.length) return fail_('invalid', 'services');
  if (!job.consent) return fail_('invalid', 'consent');
  if (!photoB && !photoA) return fail_('invalid', 'photos');
  var row = findJobRow_(id), old = row ? parseJson_(sheet_('Jobs').getRange(row, SHEETS.Jobs.length).getValue()) : null;
  var keep = old || {};
  if (photoB && photoB !== keep.photoB && !inFolder_(photoB)) return fail_('invalid', 'photos');
  if (photoA && photoA !== keep.photoA && !inFolder_(photoA)) return fail_('invalid', 'photos');
  job.createdAt = keep.createdAt || Date.now();
  var sh = sheet_('Jobs');
  if (row) sh.getRange(row, 1, 1, SHEETS.Jobs.length).setValues([jobRow_(job)]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, SHEETS.Jobs.length).setValues([jobRow_(job)]);
  // fotos reemplazadas: a la papelera
  [keep.photoB, keep.photoA].forEach(function (pid) { if (pid && pid !== photoB && pid !== photoA) trash_(pid); });
  invalidatePublic_();
  return { ok: true, job: job };
}

function trash_(fileId) {
  var f = inFolder_(fileId);
  if (f) { try { f.setTrashed(true); } catch (e) { console.error(e); } }
}

function deleteJob_(id) {
  var row = findJobRow_(id);
  if (!row) return fail_('not_found');
  var sh = sheet_('Jobs'), job = parseJson_(sh.getRange(row, SHEETS.Jobs.length).getValue()) || {};
  sh.deleteRow(row);
  trash_(job.photoB); trash_(job.photoA);
  invalidatePublic_();
  return { ok: true };
}

/* ================= seguimiento (en camino / ETA) ================= */

/** Solo se aceptan enlaces https sencillos; el servidor les agrega #t=<código>. */
function safeLink_(v) {
  var base = String(v || '').split('#')[0].split('?')[0];
  return base.length <= 200 && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(base) ? base : '';
}

function haversine_(la1, lo1, la2, lo2) {
  var R = 3958.8, r = Math.PI / 180, dl = (la2 - la1) * r, dn = (lo2 - lo1) * r;
  var a = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findLeadByTk_(tk) {
  if (!/^[a-f0-9]{12}$/.test(String(tk || ''))) return null;
  var sh = sheet_('Leads'), n = sh.getLastRow();
  if (n < 2) return null;
  var tks = sh.getRange(2, LEAD_TK_COL, n - 1, 1).getDisplayValues();
  for (var i = 0; i < tks.length; i++) {
    if (tks[i][0] === tk) return parseJson_(sh.getRange(i + 2, LEAD_JSON_COL).getValue());
  }
  return null;
}

function stageOf_(lead, now) {
  if (lead.status === 'pagado') return 'paid';
  if (lead.status === 'perdido') return 'closed';
  if (lead.status === 'completado') return 'done';
  var t = lead.track;
  if (t && TRACK_STAGES.indexOf(t.stage) > -1 && now - t.at < 6 * 3600000) return t.stage;
  return lead.status === 'nuevo' ? 'received' : 'confirmed';
}

function track_(tk) {
  var cache = CacheService.getScriptCache(), key = 'trk_' + String(tk || '');
  var hit = cache.get(key);
  if (hit) { var o = parseJson_(hit); if (o) { o.now = Date.now(); return o; } }
  var lead = findLeadByTk_(tk);
  if (!lead) { try { cache.put(key, JSON.stringify({ ok: false, error: 'not_found' }), 20); } catch (e) { /* nada */ } return fail_('not_found'); }
  var now = Date.now(), stage = stageOf_(lead, now), cfg = getConfig_();
  var paid = (lead.payments || []).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
  var v = { ok: true, now: now, code: lead.code, stage: stage, first: String(lead.name || '').split(' ')[0], lang: lead.lang === 'es' ? 'es' : 'en',
    services: lead.services || [], quote: lead.quote == null ? null : lead.quote, paid: paid || 0,
    crew: lead.track && stage !== 'received' && stage !== 'confirmed' ? lead.track.by : '', since: lead.track ? lead.track.at : (lead.createdAt || 0),
    zone: lead.zone || '', eta: null, arrive: null, live: false, distMi: null };
  if (stage === 'enroute') {
    var eta = lead.track.eta, base = lead.track.etaAt || lead.track.at;
    var loc = parseJson_(cache.get('loc_' + lead.id));
    if (loc && now - loc.at < 180000) {
      v.live = now - loc.at < 90000;
      if (loc.eta != null) { eta = loc.eta; base = loc.at; }
      if (lead.lat != null && lead.lng != null) v.distMi = Math.round(haversine_(loc.lat, loc.lng, lead.lat, lead.lng) * 10) / 10;
    }
    if (eta != null) { v.eta = Math.max(0, Math.round(eta - (now - base) / 60000)); v.arrive = now + v.eta * 60000; }
  }
  try { cache.put(key, JSON.stringify(v), 8); } catch (e) { /* sin caché */ }
  return v;
}

function mailCustomer_(lead, kind, link) {
  try {
    var to = String(lead.email || '').trim();
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) return;
    var cfg = getConfig_(), es = lead.lang === 'es', first = String(lead.name || '').split(' ')[0];
    var url = link ? link + '#t=' + lead.tk : '', subj, lines;
    if (kind === 'received') {
      subj = es ? cfg.brand + ': recibimos tu solicitud ' + lead.code : cfg.brand + ': we got your request ' + lead.code;
      lines = es ? ['Hola ' + first + ',', '', 'Recibimos tu solicitud ' + lead.code + '. Te confirmamos precio y horario muy pronto.']
                 : ['Hi ' + first + ',', '', 'We got your request ' + lead.code + '. We will confirm the price and timing very soon.'];
    } else if (kind === 'enroute') {
      var eta = lead.track && lead.track.eta != null ? lead.track.eta : null;
      subj = es ? cfg.brand + ': tu equipo va en camino' : cfg.brand + ': your crew is on the way';
      lines = es ? ['Hola ' + first + ',', '', 'Tu equipo ya va en camino' + (eta != null ? ' (llega en unos ' + eta + ' min)' : '') + '.']
                 : ['Hi ' + first + ',', '', 'Your crew is on the way' + (eta != null ? ' (about ' + eta + ' min away)' : '') + '.'];
    } else {
      subj = es ? cfg.brand + ': trabajo terminado' : cfg.brand + ': job done';
      lines = es ? ['Hola ' + first + ',', '', 'Terminamos el trabajo en tu propiedad. ¡Gracias por confiar en nosotros!'] : ['Hi ' + first + ',', '', 'We finished the job at your property. Thank you for trusting us!'];
    }
    if (url) lines.push('', (es ? 'Sigue tu solicitud: ' : 'Track your request: ') + url);
    if (cfg.phone) lines.push('', (es ? 'Dudas: ' : 'Questions: ') + cfg.phone);
    var msg = { to: to, subject: subj, body: lines.join('\n'), name: cfg.brand };
    if (cfg.email) msg.replyTo = cfg.email;
    MailApp.sendEmail(msg);
  } catch (err) { console.error('mail: ' + err); }
}

/** El equipo avanza el trabajo: en camino -> llegué -> limpiando -> terminé. */
function setTrack_(me, d) {
  var row = findLeadRow_(d && d.id);
  if (!row) return fail_('not_found');
  var stage = d.stage === 'clear' ? 'clear' : oneOf_(d.stage, TRACK_STAGES, '');
  if (!stage) return fail_('invalid', 'stage');
  var sh = sheet_('Leads'), lead = parseJson_(sh.getRange(row, LEAD_JSON_COL).getValue());
  if (!lead) return fail_('not_found');
  var cache = CacheService.getScriptCache(), now = Date.now(), prev = lead.track && lead.track.stage;
  if (!lead.tk) lead.tk = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  if (stage === 'clear') {
    delete lead.track; cache.remove('enr_' + lead.id); cache.remove('loc_' + lead.id);
  } else {
    lead.track = { stage: stage, by: me.name, at: now, eta: stage === 'enroute' ? num_(d.eta, 0, 240) : null, etaAt: now };
    lead.assignee = me.name;
    if (stage === 'enroute') cache.put('enr_' + lead.id, '1', 10800);
    else { cache.remove('enr_' + lead.id); cache.remove('loc_' + lead.id); }
    if (stage === 'done' && ['nuevo', 'contactado', 'cotizado', 'agendado'].indexOf(lead.status) > -1) lead.status = 'completado';
    if (stage === 'enroute' && lead.status === 'nuevo') lead.status = 'contactado';
  }
  lead.updatedBy = me.name; lead.updatedAt = now;
  sh.getRange(row, 1, 1, SHEETS.Leads.length).setValues([leadRow_(lead)]);
  if (stage === 'done') setStatus_(me, { state: 'available', place: '', until: '', note: '' });
  else if (stage !== 'clear') setStatus_(me, { state: 'working', place: lead.city || lead.zone || '', until: '', note: 'Lead ' + lead.code });
  cache.remove('trk_' + lead.tk);
  if ((stage === 'enroute' && prev !== 'enroute') || (stage === 'done' && prev !== 'done')) mailCustomer_(lead, stage, safeLink_(d.link));
  return { ok: true, lead: lead, crew: crewFull_() };
}

/** Ubicación del equipo mientras va en camino. Solo memoria temporal (15 min), nunca la hoja. */
function ping_(d) {
  var id = str_(d && d.id, 30).replace(/[^A-Za-z0-9]/g, '');
  var lat = num_(d && d.lat, -90, 90), lng = num_(d && d.lng, -180, 180);
  if (!id || lat === null || lng === null) return fail_('invalid');
  var cache = CacheService.getScriptCache();
  if (!cache.get('enr_' + id)) return fail_('not_enroute');
  cache.put('loc_' + id, JSON.stringify({ lat: lat, lng: lng, at: Date.now(), eta: num_(d.eta, 0, 240) }), 900);
  return { ok: true };
}

/* ================= equipo ================= */

function members_() {
  return rows_('Team').filter(function (r) { return r.nombre; }).map(function (r) {
    return { name: r.nombre, pin: r.pin, role: /^owner|due/i.test(r.rol) ? 'owner' : 'crew', active: !/^(false|no|0|inactivo)$/i.test(String(r.activo).trim()),
      zones: String(r.zonas || '').split(',').map(function (z) { return z.trim(); }).filter(Boolean) };
  });
}
function findMember_(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  var list = members_();
  for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === n && list[i].active) return list[i];
  return null;
}

function crewRows_() {
  return rows_('Crew').filter(function (r) { return r.nombre; }).map(function (r) {
    return { name: r.nombre, state: oneOf_(r.estado, CREW_STATES, 'off'), place: r.lugar, until: r.hasta, note: r.nota, updated: +r.actualizado || 0, _row: r._row };
  });
}

function setStatus_(me, raw) {
  if (!raw || typeof raw !== 'object') return fail_('invalid');
  var until = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.until || '')) ? raw.until : '';
  var rec = [me.name, oneOf_(raw.state, CREW_STATES, 'off'), cell_(str_(raw.place, 60)), until, cell_(str_(raw.note, 80)), String(Date.now())];
  var sh = sheet_('Crew'), mine = crewRows_().filter(function (r) { return r.name.toLowerCase() === me.name.toLowerCase(); })[0];
  if (mine) sh.getRange(mine._row, 1, 1, 6).setValues([rec]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, 6).setValues([rec]);
  invalidatePublic_();
  return { ok: true, crew: crewFull_() };
}

function crewFull_() {
  var st = crewRows_();
  return members_().filter(function (m) { return m.active; }).map(function (m) {
    var s = st.filter(function (r) { return r.name.toLowerCase() === m.name.toLowerCase(); })[0];
    return { name: m.name, role: m.role, zones: m.zones, state: s ? s.state : 'off', place: s ? s.place : '', until: s ? s.until : '', note: s ? s.note : '', updated: s ? s.updated : 0 };
  });
}

function crewPublic_() {
  var now = Date.now(), active = {};
  members_().forEach(function (m) { if (m.active) active[m.name.toLowerCase()] = m; });
  return crewRows_().filter(function (r) { return active[r.name.toLowerCase()] && now - r.updated < STALE_HOURS * 3600000; })
    .map(function (r) { return { state: r.state, place: r.place, until: r.until, updated: r.updated, zones: active[r.name.toLowerCase()].zones }; });
}

/* ================= sesión ================= */

function secret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}
function sign_(payload) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())); }
function safeEq_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function makeToken_(name) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ n: name, e: Date.now() + TOKEN_HOURS * 3600000 }), Utilities.Charset.UTF_8);
  return body + '.' + sign_(body);
}
function readToken_(token) {
  if (typeof token !== 'string') return null;
  var p = token.split('.');
  if (p.length !== 2 || !safeEq_(sign_(p[0]), p[1])) return null;
  var obj = parseJson_(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[0])).getDataAsString());
  if (!obj || !(obj.e > Date.now())) return null;
  var m = findMember_(obj.n);       // si te quitan del equipo, la sesión muere al instante
  return m ? { name: m.name, role: m.role } : null;
}
function pinOk_(stored, entered) {
  var s = String(stored).trim(), e = String(entered).trim();
  if (!s || !e) return false;
  return safeEq_(s, e) || safeEq_(s.replace(/^0+/, ''), e.replace(/^0+/, ''));
}
function login_(d) {
  var name = str_(d.name, 40), pin = str_(d.pin, 20);
  if (!name || !pin) return fail_('credentials');
  var cache = CacheService.getScriptCache(), key = 'fail_' + name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  var fails = +cache.get(key) || 0;
  if (fails >= 5) return fail_('locked');
  var m = findMember_(name);
  if (!m || !pinOk_(m.pin, pin)) {
    cache.put(key, String(fails + 1), 900);
    Utilities.sleep(400);
    return fail_('credentials');
  }
  cache.remove(key);
  return { ok: true, token: makeToken_(m.name), name: m.name, role: m.role, hours: TOKEN_HOURS };
}

/* ================= configuración ================= */

function getConfig_() {
  var cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  var rows = rows_('Config');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].clave === 'business') {
      var saved = parseJson_(rows[i].valor) || {};
      Object.keys(saved).forEach(function (k) { if (k !== 'prices') cfg[k] = saved[k]; });
      cfg.prices = Object.assign({}, DEFAULT_CONFIG.prices, saved.prices || {});
    }
  }
  return cfg;
}

function saveConfig_(raw) {
  raw = raw || {};
  var cur = getConfig_(), p = raw.prices || {};
  var c = {
    brand: str_(raw.brand, 30) || 'Snowy', area: str_(raw.area, 80), hours: str_(raw.hours, 80), phone: str_(raw.phone, 30),
    email: str_(raw.email, 120), notifyEmail: str_(raw.notifyEmail, 200),
    trigger: num_(raw.trigger, 0.5, 24) || 2, insured: raw.insured === true, license: str_(raw.license, 40),
    zelle: str_(raw.zelle, 120), zelleName: str_(raw.zelleName, 80), cashtag: str_(raw.cashtag, 40).replace(/^\$/, ''),
    btc: str_(raw.btc, 100).replace(/[^A-Za-z0-9]/g, ''), cashOK: raw.cashOK !== false,
    terms: oneOf_(raw.terms, ['completion', 'before', 'days7'], 'completion'),
    prices: {}, baseLat: num_(raw.baseLat, -90, 90), baseLng: num_(raw.baseLng, -180, 180),
    radius: num_(raw.radius, 1, 200) || cur.radius, showCrew: raw.showCrew !== false,
    zones: raw.zones === undefined ? cur.zones : cleanZones_(raw.zones)
  };
  if (c.baseLat === null || c.baseLng === null) { c.baseLat = cur.baseLat; c.baseLng = cur.baseLng; }
  Object.keys(DEFAULT_CONFIG.prices).forEach(function (k) { var v = num_(p[k], 0, 10000); c.prices[k] = v === null ? cur.prices[k] : v; });
  var sh = sheet_('Config'), rows = rows_('Config'), row = null;
  for (var i = 0; i < rows.length; i++) if (rows[i].clave === 'business') row = rows[i]._row;
  var rec = ['business', JSON.stringify(c)];
  if (row) sh.getRange(row, 1, 1, 2).setValues([rec]); else sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([rec]);
  invalidatePublic_();
  return { ok: true, config: c };
}

function cleanZones_(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map(function (z) {
    var name = str_(z && z.name, 30);
    var places = (Array.isArray(z && z.places) ? z.places : []).slice(0, 40).map(function (p) { return str_(p, 40); }).filter(Boolean);
    return name && places.length ? { name: name, places: places } : null;
  }).filter(Boolean);
}

/** A qué zona pertenece una dirección: por ciudad o por ZIP (las dos listas se escriben en Ajustes). */
function zoneFor_(zones, city, zip) {
  var c = String(city || '').trim().toLowerCase(), z = String(zip || '').trim().slice(0, 5);
  var list = Array.isArray(zones) ? zones : [];
  for (var i = 0; i < list.length; i++) {
    var places = list[i].places || [];
    for (var j = 0; j < places.length; j++) {
      var p = String(places[j]).trim().toLowerCase();
      if (p && ((c && p === c) || (z && p === z))) return list[i].name;
    }
  }
  return '';
}

/* ================= respuestas ================= */

function invalidatePublic_() { try { CacheService.getScriptCache().remove('pub'); } catch (e) { /* nada */ } }

function publicPayload_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('pub');
  if (hit) { var o = parseJson_(hit); if (o) { o.now = Date.now(); return o; } }
  var cfg = getConfig_(), pub = {};
  PUBLIC_KEYS.forEach(function (k) { pub[k] = cfg[k]; });
  var jobs = rows_('Jobs').map(function (r) { return parseJson_(r.json); })
    .filter(function (j) { return j && j.consent === true && (j.photoA || j.photoB); })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 60)
    .map(function (j) { return { id: j.id, date: j.date, place: j.place, services: j.services, note: j.note, photoB: j.photoB, photoA: j.photoA }; });
  var out = { ok: true, config: pub, jobs: jobs, crew: cfg.showCrew ? crewPublic_() : [] };
  try { cache.put('pub', JSON.stringify(out), 30); } catch (e) { /* demasiado grande: sin caché */ }
  out.now = Date.now();
  return out;
}

function panel_(me) {
  var cfg = getConfig_();
  if (me.role !== 'owner') delete cfg.notifyEmail;
  var leads = rows_('Leads').map(function (r) { return parseJson_(r.json); }).filter(Boolean)
    .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  var jobs = rows_('Jobs').map(function (r) { return parseJson_(r.json); }).filter(Boolean);
  return { ok: true, me: me, config: cfg, leads: leads, jobs: jobs, crew: crewFull_(),
    team: members_().filter(function (m) { return m.active; }).map(function (m) { return { name: m.name, role: m.role, zones: m.zones }; }), now: Date.now() };
}
