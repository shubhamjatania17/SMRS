const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const PRIMARY_HTML_FILE = path.join(ROOT_DIR, 'index.html');
const LEGACY_HTML_FILE = path.join(ROOT_DIR, 'medresponse_v2.html');
const HTML_FILE = fs.existsSync(PRIMARY_HTML_FILE) ? PRIMARY_HTML_FILE : LEGACY_HTML_FILE;
const STATE_FILE = path.join(ROOT_DIR, 'data', 'state.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_HISTORY_ITEMS = 100;
const DEFAULT_CLIENT_ID = 'default';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Client-Id',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const htmlCache = {
  content: '',
  etag: '',
  mtimeMs: 0
};

const streamClients = new Map();

function createTenantState() {
  return {
    activeAlert: null,
    alertHistory: [],
    lastUpdatedAt: null
  };
}

function createDefaultState() {
  return {
    tenants: {},
    lastUpdatedAt: null
  };
}

function ensureStateDirectory() {
  const directory = path.dirname(STATE_FILE);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function sanitizeClientId(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return (normalized || DEFAULT_CLIENT_ID).slice(0, 64);
}

function normalizeTenant(rawTenant) {
  const source = rawTenant || {};
  return {
    ...createTenantState(),
    ...source,
    alertHistory: Array.isArray(source.alertHistory) ? source.alertHistory : []
  };
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return createDefaultState();
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const nextState = createDefaultState();

    if (parsed && parsed.tenants && typeof parsed.tenants === 'object') {
      const entries = Object.entries(parsed.tenants);
      for (const [clientId, tenant] of entries) {
        nextState.tenants[sanitizeClientId(clientId)] = normalizeTenant(tenant);
      }
      nextState.lastUpdatedAt = parsed.lastUpdatedAt || null;
      return nextState;
    }

    // Backward compatibility with legacy single-tenant state shape.
    if (parsed && (parsed.activeAlert || parsed.alertHistory)) {
      nextState.tenants[DEFAULT_CLIENT_ID] = {
        ...createTenantState(),
        activeAlert: parsed.activeAlert || null,
        alertHistory: Array.isArray(parsed.alertHistory) ? parsed.alertHistory : [],
        lastUpdatedAt: parsed.lastUpdatedAt || null
      };
      nextState.lastUpdatedAt = parsed.lastUpdatedAt || null;
      return nextState;
    }

    return nextState;
  } catch {
    return createDefaultState();
  }
}

function saveState(nextState) {
  ensureStateDirectory();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');
}

let state = loadState();

function getTenantState(clientId, createIfMissing = true) {
  const safeClientId = sanitizeClientId(clientId);
  if (!state.tenants[safeClientId] && createIfMissing) {
    state.tenants[safeClientId] = createTenantState();
  }
  return state.tenants[safeClientId] || createTenantState();
}

function getClientIdFromRequest(requestUrl, body = {}, req = null) {
  const queryClientId =
    requestUrl.searchParams.get('clientId') ||
    requestUrl.searchParams.get('client') ||
    '';

  const headerClientId = req ? (req.headers['x-client-id'] || '') : '';
  const bodyClientId = body && typeof body === 'object' ? body.clientId : '';

  return sanitizeClientId(queryClientId || headerClientId || bodyClientId || DEFAULT_CLIENT_ID);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

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
    ETag: etag,
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

function getSnapshot(clientId) {
  const tenant = getTenantState(clientId);
  return {
    clientId: sanitizeClientId(clientId),
    activeAlert: tenant.activeAlert,
    alertHistory: tenant.alertHistory,
    lastUpdatedAt: tenant.lastUpdatedAt
  };
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addStreamClient(clientId, res) {
  const safeClientId = sanitizeClientId(clientId);
  if (!streamClients.has(safeClientId)) {
    streamClients.set(safeClientId, new Set());
  }

  streamClients.get(safeClientId).add(res);
}

function removeStreamClient(clientId, res) {
  const safeClientId = sanitizeClientId(clientId);
  if (!streamClients.has(safeClientId)) {
    return;
  }

  const tenantClients = streamClients.get(safeClientId);
  tenantClients.delete(res);
  if (tenantClients.size === 0) {
    streamClients.delete(safeClientId);
  }
}

function broadcastSnapshot(clientId, reason) {
  const safeClientId = sanitizeClientId(clientId);
  const tenantClients = streamClients.get(safeClientId);
  if (!tenantClients || tenantClients.size === 0) {
    return;
  }

  const payload = {
    reason,
    ...getSnapshot(safeClientId)
  };

  for (const clientRes of tenantClients) {
    sendSseEvent(clientRes, 'state:update', payload);
  }
}

function createAlert(payload, clientId) {
  const tenant = getTenantState(clientId);
  const activeAlert = tenant.activeAlert;
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
    title: payload.title || 'Emergency Alert',
    location: payload.location,
    userName: payload.userName || 'Unknown User',
    role: payload.role || 'student',
    clientId: sanitizeClientId(clientId),
    status: 'active',
    severity: payload.severity || 'critical',
    createdAt,
    updatedAt: createdAt,
    resolvedAt: null,
    notes: payload.notes || ''
  };

  tenant.activeAlert = alert;
  tenant.alertHistory.unshift(alert);
  if (tenant.alertHistory.length > MAX_HISTORY_ITEMS) {
    tenant.alertHistory = tenant.alertHistory.slice(0, MAX_HISTORY_ITEMS);
  }
  tenant.lastUpdatedAt = createdAt;
  state.lastUpdatedAt = createdAt;
  saveState(state);

  return {
    duplicate: false,
    alert
  };
}

function resolveActiveAlert(alertId, resolverName, clientId) {
  const tenant = getTenantState(clientId);
  const activeAlert = tenant.activeAlert;
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

  tenant.activeAlert = null;
  tenant.alertHistory = tenant.alertHistory.map(alert => {
    if (alert.id !== resolvedAlert.id) {
      return alert;
    }
    return resolvedAlert;
  });

  tenant.lastUpdatedAt = resolvedAt;
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

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/medresponse_v2.html')) {
    const html = getHtmlPayload();
    if (req.headers['if-none-match'] === html.etag) {
      res.writeHead(304, {
        ETag: html.etag,
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
      tenantCount: Object.keys(state.tenants || {}).length
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    sendJson(res, 200, {
      appName: 'MedResponse',
      ...getSnapshot(clientId)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stream') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS_HEADERS
    });

    res.write(': connected\n\n');
    addStreamClient(clientId, res);
    sendSseEvent(res, 'state:update', {
      reason: 'connected',
      ...getSnapshot(clientId)
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      removeStreamClient(clientId, res);
    });

    return;
  }

  if (req.method === 'GET' && pathname === '/api/alert/current') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    const tenant = getTenantState(clientId);
    const activeAlert = tenant.activeAlert;
    sendJson(res, 200, {
      activeAlert,
      ageSeconds: getAlertAgeSeconds(activeAlert)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/alerts/history') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    const tenant = getTenantState(clientId);
    sendJson(res, 200, {
      items: tenant.alertHistory
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
    const role = normalizeRole(body.role || 'student');
    const clientId = getClientIdFromRequest(requestUrl, body, req);

    if (!name) {
      sendJson(res, 400, { ok: false, message: 'Name is required' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      user: {
        name,
        displayName: name.split(/\s+/)[0],
        role,
        clientId
      },
      ...getSnapshot(clientId)
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
    const clientId = getClientIdFromRequest(requestUrl, body, req);

    if (!location) {
      sendJson(res, 400, { ok: false, message: 'Location is required' });
      return;
    }

    const result = createAlert(body, clientId);
    if (result.duplicate) {
      sendJson(res, 409, {
        ok: false,
        message: result.sameLocation ? 'Alert already sent from this location' : 'Another active alert already exists',
        activeAlert: result.alert
      });
      return;
    }

    broadcastSnapshot(clientId, 'alert-created');
    sendJson(res, 201, {
      ok: true,
      alert: result.alert,
      ...getSnapshot(clientId)
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

    const clientId = getClientIdFromRequest(requestUrl, body, req);
    const result = resolveActiveAlert(alertId, body.resolvedBy, clientId);

    if (!result.found) {
      const tenant = getTenantState(clientId);
      sendJson(res, 404, {
        ok: false,
        message: 'No matching active alert found',
        activeAlert: tenant.activeAlert
      });
      return;
    }

    broadcastSnapshot(clientId, 'alert-resolved');
    sendJson(res, 200, {
      ok: true,
      alert: result.alert,
      ...getSnapshot(clientId)
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
