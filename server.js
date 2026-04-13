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

const FLOOR_SEQUENCE = ['lg', 'g', '1', '2', '3', '4', '5', '6', '7', '8'];
const FLOOR_LABELS = {
  lg: 'Lower Ground',
  g: 'Ground',
  '1': 'Floor 1',
  '2': 'Floor 2',
  '3': 'Floor 3',
  '4': 'Floor 4',
  '5': 'Floor 5',
  '6': 'Floor 6',
  '7': 'Floor 7',
  '8': 'Floor 8'
};

// Coordinates are derived from room labels in each floor SVG (360x534 viewBox).
const FLOOR_RESOURCE_ROOMS = {
  lg: [
    { type: 'AED Unit', icon: '❤️', room: 'Electrical Panel Room', anchorLeft: '36.8%', anchorTop: '91.7%', offsetLeft: '3.0%', offsetTop: '-7.6%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'Maintenance Room', anchorLeft: '80.6%', anchorTop: '91.7%', offsetLeft: '-4.2%', offsetTop: '-7.6%' }
  ],
  g: [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR G3', anchorLeft: '83.9%', anchorTop: '30.7%', offsetLeft: '-4.4%', offsetTop: '7.0%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR G1', anchorLeft: '7.2%', anchorTop: '59.3%', offsetLeft: '6.4%', offsetTop: '1.0%' },
    { type: 'Medical Room', icon: '🏥', room: 'Conference Room', anchorLeft: '52.5%', anchorTop: '63.5%', offsetLeft: '1.6%', offsetTop: '-2.8%' }
  ],
  '1': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 104', anchorLeft: '84.2%', anchorTop: '33.1%', offsetLeft: '-5.4%', offsetTop: '6.8%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR 101', anchorLeft: '6.9%', anchorTop: '46.0%', offsetLeft: '7.2%', offsetTop: '1.4%' }
  ],
  '2': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 204', anchorLeft: '83.6%', anchorTop: '61.0%', offsetLeft: '-5.8%', offsetTop: '0.0%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR 201', anchorLeft: '26.9%', anchorTop: '92.8%', offsetLeft: '3.8%', offsetTop: '-8.4%' }
  ],
  '3': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 306', anchorLeft: '83.9%', anchorTop: '65.0%', offsetLeft: '-5.6%', offsetTop: '-0.8%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR 303', anchorLeft: '6.7%', anchorTop: '26.9%', offsetLeft: '7.4%', offsetTop: '6.2%' }
  ],
  '4': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 404', anchorLeft: '83.9%', anchorTop: '65.5%', offsetLeft: '-5.6%', offsetTop: '-0.8%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CL 402', anchorLeft: '6.7%', anchorTop: '53.2%', offsetLeft: '7.2%', offsetTop: '0.6%' }
  ],
  '5': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 505', anchorLeft: '83.9%', anchorTop: '65.4%', offsetLeft: '-5.6%', offsetTop: '-0.8%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR 503', anchorLeft: '6.4%', anchorTop: '27.1%', offsetLeft: '7.6%', offsetTop: '6.0%' }
  ],
  '6': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CR 605', anchorLeft: '83.9%', anchorTop: '67.0%', offsetLeft: '-5.6%', offsetTop: '-0.8%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'E. CR 604', anchorLeft: '6.7%', anchorTop: '26.9%', offsetLeft: '7.4%', offsetTop: '6.2%' }
  ],
  '7': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CL 704', anchorLeft: '83.9%', anchorTop: '68.1%', offsetLeft: '-5.8%', offsetTop: '-0.4%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'Library', anchorLeft: '8.6%', anchorTop: '32.0%', offsetLeft: '5.8%', offsetTop: '5.0%' }
  ],
  '8': [
    { type: 'AED Unit', icon: '❤️', room: 'E. CL 803', anchorLeft: '83.9%', anchorTop: '53.4%', offsetLeft: '-5.8%', offsetTop: '0.4%' },
    { type: 'First Aid Kit', icon: '🩹', room: 'Pneumatic Lab', anchorLeft: '5.8%', anchorTop: '33.5%', offsetLeft: '6.4%', offsetTop: '4.8%' }
  ]
};

function shiftPercent(value, delta) {
  return `${(parseFloat(value) + parseFloat(delta)).toFixed(1)}%`;
}

function resolveRoomPinPosition(pin) {
  const left = shiftPercent(pin.anchorLeft, pin.offsetLeft || 0);
  const top = shiftPercent(pin.anchorTop, pin.offsetTop || 0);

  return { left, top };
}

function buildDefaultMapResources() {
  const resources = [];

  FLOOR_SEQUENCE.forEach(floorKey => {
    const floorLabel = FLOOR_LABELS[floorKey] || `Floor ${floorKey}`;
    const roomPins = FLOOR_RESOURCE_ROOMS[floorKey] || [];

    roomPins.forEach(pin => {
      const position = resolveRoomPinPosition(pin);

      resources.push({
        icon: pin.icon,
        name: `${pin.type} — ${pin.room}`,
        locationLabel: `${floorLabel} · ${pin.room}`,
        floorKey,
        distance: `${floorLabel} · ${pin.room}`,
        status: 'AVAILABLE',
        left: position.left,
        top: position.top,
        markerTitle: `${pin.type} · ${pin.room}`
      });
    });
  });

  return resources;
}

function buildDefaultLocationOptions() {
  const locations = [];

  FLOOR_SEQUENCE.forEach(floorKey => {
    const floorLabel = FLOOR_LABELS[floorKey] || `Floor ${floorKey}`;
    const roomPins = FLOOR_RESOURCE_ROOMS[floorKey] || [];

    roomPins.forEach(pin => {
      locations.push(`${floorLabel} · ${pin.room}`);
    });
  });

  return locations;
}

const DEFAULT_CLIENT_CONFIG = {
  ui: {
    mapTitle: 'Campus Map',
    mapSubtitle: 'Medical resources and key campus areas for emergency navigation.'
  },
  locations: [
    ...buildDefaultLocationOptions()
  ],
  contacts: [
    {
      icon: '🏥',
      name: 'Medical Room',
      role: 'Block C · Room 001',
      callLabel: 'CALL'
    },
    {
      icon: '👩‍⚕️',
      name: 'On-Duty Doctor',
      role: 'Campus Emergency Response',
      callLabel: 'CALL'
    },
    {
      icon: '🚨',
      name: 'Security Control',
      role: 'Main Gate Desk',
      callLabel: 'CALL'
    }
  ],
  map: {
    buildings: [
      { label: 'BLOCK A', subLabel: 'CSE/IT', left: '8%', top: '10%', width: '20%', height: '24%' },
      { label: 'BLOCK B', subLabel: 'ECE/ME', left: '34%', top: '10%', width: '20%', height: '24%' },
      { label: 'LIBRARY', subLabel: '', left: '60%', top: '10%', width: '24%', height: '24%' },
      { label: 'CANTEEN', subLabel: '', left: '8%', top: '55%', width: '25%', height: '22%' },
      { label: 'BLOCK C', subLabel: 'MECH', left: '40%', top: '55%', width: '20%', height: '22%' },
      { label: 'SPORTS COMPLEX', subLabel: '', left: '67%', top: '55%', width: '22%', height: '22%' }
    ],
    youMarker: { label: '📍 YOU', left: '41%', top: '26%' },
    resources: buildDefaultMapResources(),
    locations: buildDefaultLocationOptions()
  }
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDefaultClientConfig() {
  return deepClone(DEFAULT_CLIENT_CONFIG);
}

function createTenantState() {
  return {
    activeAlert: null,
    alertHistory: [],
    lastUpdatedAt: null,
    config: getDefaultClientConfig()
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

function inferResourceFloorKey(resource) {
  const explicit = String(resource.floorKey || resource.floor || '').trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  const nameAndDistance = [resource.name, resource.distance].filter(Boolean).join(' ').toLowerCase();
  if (nameAndDistance.includes('floor 1') || nameAndDistance.includes('1st floor')) {
    return '1';
  }

  return 'g';
}

function normalizeMapConfig(mapConfig) {
  if (!mapConfig || typeof mapConfig !== 'object') {
    return mapConfig;
  }

  const resources = Array.isArray(mapConfig.resources) ? mapConfig.resources : [];
  const locations = Array.isArray(mapConfig.locations) && mapConfig.locations.length > 0
    ? mapConfig.locations
    : resources.map(resource => String(resource.locationLabel || resource.name || resource.distance || '').trim()).filter(Boolean);
  return {
    ...mapConfig,
    locations,
    resources: resources.map(resource => ({
      ...resource,
      floorKey: inferResourceFloorKey(resource)
    }))
  };
}

function normalizeTenant(rawTenant) {
  const source = rawTenant || {};
  const baseConfig = source.config && typeof source.config === 'object'
    ? source.config
    : getDefaultClientConfig();
  const normalizedConfig = {
    ...baseConfig,
    map: normalizeMapConfig(baseConfig.map)
  };

  return {
    ...createTenantState(),
    ...source,
    alertHistory: Array.isArray(source.alertHistory) ? source.alertHistory : [],
    config: normalizedConfig
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

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
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
    config: tenant.config || getDefaultClientConfig(),
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

  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const relativePath = pathname.replace(/^\/+/, '');
    const filePath = path.join(ROOT_DIR, relativePath);
    const normalizedRoot = path.resolve(ROOT_DIR);
    const normalizedFilePath = path.resolve(filePath);

    if (!normalizedFilePath.startsWith(normalizedRoot)) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (!fs.existsSync(normalizedFilePath) || !fs.statSync(normalizedFilePath).isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }

    const content = fs.readFileSync(normalizedFilePath);
    res.writeHead(200, {
      'Content-Type': getMimeType(normalizedFilePath),
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
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
