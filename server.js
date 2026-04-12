const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const HTML_FILE = path.join(ROOT_DIR, 'medresponse_v2.html');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'state.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_HISTORY_ITEMS = 100;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const htmlCache = {
  content: '',
  etag: '',
  mtimeMs: 0
};

const demoLocations = [
  'Block A · Room 101 · 1st Floor',
  'Block A · Lab 3 · Ground Floor',
  'Block B · Room 203 · 2nd Floor',
  'Block B · Corridor 2B',
  'Library · Reading Hall',
  'Canteen · Main Hall',
  'Block C · Room 001',
  'Sports Complex · Ground'
];

const demoContacts = [
  {
    name: 'Campus Medical Room',
    role: 'Block C · Room 001 · 24/7',
    type: 'hospital',
    callLabel: 'CALL'
  },
  {
    name: 'Dr. Sharma (On Duty)',
    role: 'Campus Medical Officer',
    type: 'doctor',
    callLabel: 'CALL'
  },
  {
    name: 'College Security',
    role: 'Gate · Ext. 100',
    type: 'security',
    callLabel: 'CALL'
  }
];

const demoResources = [
  {
    name: 'AED Unit — Block A Lobby',
    distance: '~80m · Ground Floor · Near entrance',
    type: 'aed',
    status: 'AVAILABLE'
  },
  {
    name: 'AED Unit — Library Floor 1',
    distance: '~140m · Near circulation desk',
    type: 'aed',
    status: 'AVAILABLE'
  },
  {
    name: 'Medical Room — Block C',
    distance: '~200m · Ground Floor · Room 001',
    type: 'medical',
    status: 'AVAILABLE'
  },
  {
    name: 'First Aid Kit — Canteen',
    distance: '~110m · Behind serving counter',
    type: 'kit',
    status: 'AVAILABLE'
  }
];

const demoStaff = [
  {
    name: 'Dr. Priya Sharma',
    role: 'Campus Medical Officer',
    badge: 'EN ROUTE'
  },
  {
    name: 'Nurse Rajan',
    role: 'First Aid Coordinator',
    badge: 'AVAILABLE'
  },
  {
    name: 'Dr. Anil Mehta',
    role: 'Visiting Physician',
    badge: 'BUSY'
  },
  {
    name: 'Nurse Kavya',
    role: 'Triage Nurse',
    badge: 'AVAILABLE'
  }
];

const demoGuides = [
  { title: 'Fainting / Unconscious', category: 'critical', severity: 'CRITICAL' },
  { title: 'Cardiac Arrest / No Pulse', category: 'critical', severity: 'CRITICAL' },
  { title: 'Seizure / Convulsions', category: 'critical', severity: 'CRITICAL' },
  { title: 'Severe Allergic Reaction', category: 'moderate', severity: 'MODERATE' },
  { title: 'Heavy Bleeding / Deep Cut', category: 'moderate', severity: 'MODERATE' },
  { title: 'Fracture / Bone Injury', category: 'stable', severity: 'STABLE' },
  { title: 'Heat Exhaustion', category: 'stable', severity: 'STABLE' }
];

const STAFF_SCOPED_ROLES = new Set(['staff', 'admin']);

function createDefaultState() {
  return {
    activeAlert: null,
    alertHistory: [],
    lastUpdatedAt: null
  };
}

function ensureStateDirectory() {
  const directory = path.dirname(STATE_FILE);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return createDefaultState();
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...createDefaultState(),
      ...parsed,
      alertHistory: Array.isArray(parsed.alertHistory) ? parsed.alertHistory : []
    };
  } catch {
    return createDefaultState();
  }
}

function saveState(nextState) {
  ensureStateDirectory();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');
}

let state = loadState();

function getHtmlPayload() {
  const stats = fs.statSync(HTML_FILE);
  if (htmlCache.content && htmlCache.mtimeMs === stats.mtimeMs) {
    return htmlCache;
  }

  const content = fs.readFileSync(HTML_FILE, 'utf8');
  htmlCache.content = content;
  htmlCache.mtimeMs = stats.mtimeMs;
  htmlCache.etag = `W/\"${Buffer.byteLength(content, 'utf8')}-${Number(stats.mtimeMs)}\"`;
  return htmlCache;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCollege(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function isStaffScopedRole(role) {
  return STAFF_SCOPED_ROLES.has(normalizeRole(role));
}

function isSameCollege(left, right) {
  const normalizedLeft = normalizeCollege(left);
  const normalizedRight = normalizeCollege(right);
  return Boolean(normalizedLeft) && Boolean(normalizedRight) && normalizedLeft === normalizedRight;
}

function getViewerScopeFromRequest(requestUrl, fallback = {}) {
  const role = normalizeRole(requestUrl.searchParams.get('role') || fallback.role);
  const college = String(requestUrl.searchParams.get('college') || fallback.college || '').trim();
  return { role, college };
}

function canViewAlertForScope(alert, scope) {
  if (!alert) {
    return false;
  }

  if (!isStaffScopedRole(scope.role)) {
    return true;
  }

  return isSameCollege(alert.college, scope.college);
}

function getScopedActiveAlert(scope) {
  return canViewAlertForScope(state.activeAlert, scope) ? state.activeAlert : null;
}

function getScopedHistory(scope) {
  if (!isStaffScopedRole(scope.role)) {
    return state.alertHistory;
  }

  return state.alertHistory.filter(alert => isSameCollege(alert.college, scope.college));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    ...CORS_HEADERS
  });
  res.end(body);
}

function sendHtml(res, content, etag) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'ETag': etag,
    'Content-Length': Buffer.byteLength(content, 'utf8'),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(content);
}

function sendText(res, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(content);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function buildBootstrap(scope = {}) {
  const activeAlert = getScopedActiveAlert(scope);
  return {
    appName: 'MedResponse',
    college: 'MIT College of Engineering',
    locations: demoLocations,
    contacts: demoContacts,
    resources: demoResources,
    staff: demoStaff,
    guides: demoGuides,
    activeAlert,
    alertHistory: getScopedHistory(scope)
  };
}

function createAlert(payload) {
  const activeAlert = state.activeAlert;
  if (activeAlert && activeAlert.status === 'active') {
    const sameLocation = activeAlert.location === payload.location;
    return {
      duplicate: true,
      sameLocation,
      alert: activeAlert
    };
  }

  const createdAt = nowIso();
  const alert = {
    id: `alert_${Date.now()}`,
    title: payload.title || 'Student Unresponsive',
    location: payload.location,
    userName: payload.userName || 'Anonymous',
    role: payload.role || 'student',
    college: String(payload.college || '').trim(),
    status: 'active',
    severity: payload.severity || 'critical',
    createdAt,
    updatedAt: createdAt,
    resolvedAt: null,
    notes: payload.notes || 'Emergency response requested from campus UI.'
  };

  state.activeAlert = alert;
  state.alertHistory.unshift(alert);
  if (state.alertHistory.length > MAX_HISTORY_ITEMS) {
    state.alertHistory = state.alertHistory.slice(0, MAX_HISTORY_ITEMS);
  }
  state.lastUpdatedAt = createdAt;
  saveState(state);
  return {
    duplicate: false,
    alert
  };
}

function resolveActiveAlert(alertId, resolverName) {
  const activeAlert = state.activeAlert;
  if (!activeAlert) {
    return { found: false };
  }

  if (alertId && activeAlert.id !== alertId) {
    return { found: false, alert: activeAlert };
  }

  const resolvedAt = nowIso();
  const resolvedAlert = {
    ...activeAlert,
    status: 'resolved',
    resolvedAt,
    updatedAt: resolvedAt,
    resolvedBy: resolverName || 'System'
  };

  state.activeAlert = null;
  state.alertHistory = state.alertHistory.map(alert => {
    if (alert.id !== resolvedAlert.id) {
      return alert;
    }
    return resolvedAlert;
  });
  state.lastUpdatedAt = resolvedAt;
  saveState(state);
  return { found: true, alert: resolvedAlert };
}

function getAlertAgeSeconds(alert) {
  if (!alert || !alert.createdAt) {
    return 0;
  }

  const createdAt = new Date(alert.createdAt).getTime();
  if (Number.isNaN(createdAt)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
}

async function routeRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...CORS_HEADERS
    });
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = requestUrl;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/medresponse_v2.html')) {
    const html = getHtmlPayload();
    if (req.headers['if-none-match'] === html.etag) {
      res.writeHead(304, {
        'ETag': html.etag,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }
    sendHtml(res, html.content, html.etag);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'medresponse-backend',
      now: nowIso(),
      activeAlert: Boolean(state.activeAlert)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const scope = getViewerScopeFromRequest(requestUrl);
    sendJson(res, 200, buildBootstrap(scope));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/alert/current') {
    const scope = getViewerScopeFromRequest(requestUrl);
    const scopedActiveAlert = getScopedActiveAlert(scope);
    sendJson(res, 200, {
      activeAlert: scopedActiveAlert,
      ageSeconds: getAlertAgeSeconds(scopedActiveAlert)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/alerts/history') {
    const scope = getViewerScopeFromRequest(requestUrl);
    sendJson(res, 200, {
      items: getScopedHistory(scope)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const name = String(body.name || '').trim();
    const college = String(body.college || '').trim();
    const role = normalizeRole(body.role || 'student');

    if (!name) {
      sendJson(res, 400, { ok: false, message: 'Name is required' });
      return;
    }

    const scope = {
      role,
      college: college || 'MIT College of Engineering'
    };

    sendJson(res, 200, {
      ok: true,
      user: {
        name,
        displayName: name.split(/\s+/)[0],
        college: scope.college,
        role
      },
      activeAlert: getScopedActiveAlert(scope)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/alerts') {
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const location = String(body.location || '').trim();
    if (!location) {
      sendJson(res, 400, { ok: false, message: 'Location is required' });
      return;
    }

    const result = createAlert(body);
    if (result.duplicate) {
      sendJson(res, 409, {
        ok: false,
        message: result.sameLocation ? 'Alert already sent from this location' : 'Another active alert already exists',
        activeAlert: result.alert
      });
      return;
    }

    sendJson(res, 201, {
      ok: true,
      alert: result.alert
    });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/alerts/') && pathname.endsWith('/resolve')) {
    const parts = pathname.split('/').filter(Boolean);
    const alertId = parts[2];
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const resolverRole = normalizeRole(body.role || '');
    const resolverCollege = String(body.college || '').trim();
    const scopedResolver = isStaffScopedRole(resolverRole);

    if (scopedResolver && state.activeAlert && !isSameCollege(state.activeAlert.college, resolverCollege)) {
      sendJson(res, 403, {
        ok: false,
        message: 'You can only resolve alerts from your college',
        activeAlert: getScopedActiveAlert({ role: resolverRole, college: resolverCollege })
      });
      return;
    }

    const result = resolveActiveAlert(alertId, body.resolvedBy);
    if (!result.found) {
      sendJson(res, 404, {
        ok: false,
        message: 'No matching active alert found',
        activeAlert: state.activeAlert
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      alert: result.alert
    });
    return;
  }

  sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  routeRequest(req, res).catch(error => {
    sendJson(res, 500, {
      ok: false,
      message: error.message || 'Internal server error'
    });
  });
});

server.listen(PORT, () => {
  console.log(`MedResponse backend running at http://localhost:${PORT}`);
});
