const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT_DIR, 'data', 'state.json');
const STATE_KEY = 'smrs:state:v1';
const DEFAULT_CLIENT_ID = 'default';
const MAX_HISTORY_ITEMS = 100;

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

const FLOOR_PLAN_FILES = {
  lg: 'floor_lg_dark.svg',
  g: 'floor_g_dark.svg',
  '1': 'floor_1_dark.svg',
  '2': 'floor_2_dark.svg',
  '3': 'floor_3_dark.svg',
  '4': 'floor_4_dark.svg',
  '5': 'floor_5_dark.svg',
  '6': 'floor_6_dark.svg',
  '7': 'floor_7_dark.svg',
  '8': 'floor_8_dark.svg'
};

const GROUND_FLOOR_SPECIAL_RESOURCES = [
  {
    type: 'Medical Room',
    icon: '🏥',
    room: 'Admin Department',
    anchorLeft: '34.4%',
    anchorTop: '63.5%',
    offsetLeft: '2.0%',
    offsetTop: '-1.2%'
  },
  {
    type: 'AED Unit',
    icon: '❤️',
    room: 'Admin Department',
    anchorLeft: '34.4%',
    anchorTop: '63.5%',
    offsetLeft: '-2.0%',
    offsetTop: '1.2%'
  },
  {
    type: 'First Aid Kit',
    icon: '🩹',
    room: 'Main Entrance Desk',
    anchorLeft: '83.1%',
    anchorTop: '18.0%',
    offsetLeft: '0.0%',
    offsetTop: '0.0%'
  }
];

const ROOM_LABEL_EXCLUDE_PATTERNS = [
  /^floor\b/i,
  /^ground floor\b/i,
  /^lift$/i,
  /entrance/i,
  /^staircase\b/i,
  /^exit$/i,
  /fire fighting/i,
  /^na$/i
];

const ROOM_TYPE_OVERRIDES = {};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Client-Id',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function decodeSvgText(value) {
  return String(value || '')
    .replace(/&#10;|&#x0A;|\n/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isRoomLabel(label) {
  if (!label) {
    return false;
  }

  return !ROOM_LABEL_EXCLUDE_PATTERNS.some(pattern => pattern.test(label));
}

function getRoomTypeMeta(roomName) {
  const normalized = String(roomName || '').trim().toLowerCase();
  return ROOM_TYPE_OVERRIDES[normalized] || { type: 'Mapped Room', icon: '📍' };
}

function extractSvgRoomLabels(svgContent) {
  const labels = [];
  const textBlocks = svgContent.match(/<text[^>]*>[\s\S]*?<\/text>/g) || [];

  textBlocks.forEach(textBlock => {
    const spanMatches = [...textBlock.matchAll(/<tspan[^>]*x=\"([^\"]+)\"[^>]*y=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/tspan>/g)];
    if (spanMatches.length === 0) {
      return;
    }

    const firstX = parseFloat(spanMatches[0][1]);
    const firstY = parseFloat(spanMatches[0][2]);
    if (!Number.isFinite(firstX) || !Number.isFinite(firstY)) {
      return;
    }

    const label = decodeSvgText(
      spanMatches
        .map(match => decodeSvgText(match[3]))
        .filter(Boolean)
        .join(' ')
    );

    if (!isRoomLabel(label)) {
      return;
    }

    labels.push({
      room: label,
      x: firstX,
      y: firstY
    });
  });

  return labels;
}

function shiftPercent(value, delta) {
  return `${(parseFloat(value) + parseFloat(delta)).toFixed(1)}%`;
}

function resolveRoomPinPosition(pin) {
  return {
    left: shiftPercent(pin.anchorLeft, pin.offsetLeft || 0),
    top: shiftPercent(pin.anchorTop, pin.offsetTop || 0)
  };
}

function buildFloorResourceRooms() {
  const roomsByFloor = {};

  FLOOR_SEQUENCE.forEach(floorKey => {
    const fileName = FLOOR_PLAN_FILES[floorKey];
    const floorSvgPath = fileName ? path.join(ROOT_DIR, 'assets', 'floors', fileName) : '';

    if (!floorSvgPath || !fs.existsSync(floorSvgPath)) {
      roomsByFloor[floorKey] = [];
      return;
    }

    const svgContent = fs.readFileSync(floorSvgPath, 'utf8');
    const labels = extractSvgRoomLabels(svgContent);
    const dedupe = new Set();

    roomsByFloor[floorKey] = labels
      .filter(label => {
        if (floorKey !== 'g') {
          return true;
        }
        const roomName = String(label.room || '').trim().toLowerCase();
        return roomName !== 'admin department';
      })
      .filter(label => {
        const key = label.room.toLowerCase();
        if (dedupe.has(key)) {
          return false;
        }
        dedupe.add(key);
        return true;
      })
      .map(label => {
        const roomMeta = getRoomTypeMeta(label.room);
        return {
          type: roomMeta.type,
          icon: roomMeta.icon,
          room: label.room,
          anchorLeft: `${((label.x / 360) * 100).toFixed(1)}%`,
          anchorTop: `${((label.y / 534) * 100).toFixed(1)}%`,
          offsetLeft: '0.0%',
          offsetTop: '0.0%'
        };
      });

    if (floorKey === 'g') {
      roomsByFloor[floorKey] = roomsByFloor[floorKey].concat(GROUND_FLOOR_SPECIAL_RESOURCES);
    }
  });

  return roomsByFloor;
}

const FLOOR_RESOURCE_ROOMS = buildFloorResourceRooms();

function buildDefaultMapResources() {
  const resources = [];

  FLOOR_SEQUENCE.forEach(floorKey => {
    const floorLabel = FLOOR_LABELS[floorKey] || `Floor ${floorKey}`;
    const roomPins = FLOOR_RESOURCE_ROOMS[floorKey] || [];

    roomPins.forEach(pin => {
      const position = resolveRoomPinPosition(pin);
      const resourceName = pin.type === 'Mapped Room' ? pin.room : `${pin.type} — ${pin.room}`;
      const markerTitle = pin.type === 'Mapped Room' ? pin.room : `${pin.type} · ${pin.room}`;

      resources.push({
        icon: pin.icon,
        name: resourceName,
        locationLabel: `${floorLabel} · ${pin.room}`,
        floorKey,
        distance: `${floorLabel} · ${pin.room}`,
        status: 'AVAILABLE',
        left: position.left,
        top: position.top,
        markerTitle
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
  locations: buildDefaultLocationOptions(),
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
  const defaultResources = buildDefaultMapResources();
  const defaultByLocation = new Map(
    defaultResources
      .map(resource => [String(resource.locationLabel || resource.distance || '').trim().toLowerCase(), resource])
      .filter(([key]) => Boolean(key))
  );

  const customResources = [];
  const seenCustomLocations = new Set();

  resources.forEach(resource => {
    const key = String(resource.locationLabel || resource.distance || '').trim().toLowerCase();
    if (!key || defaultByLocation.has(key) || seenCustomLocations.has(key)) {
      return;
    }
    seenCustomLocations.add(key);
    customResources.push(resource);
  });

  const mergedResources = [...defaultResources, ...customResources];
  const locations = [...new Set(
    mergedResources
      .map(resource => String(resource.locationLabel || resource.name || resource.distance || '').trim())
      .filter(Boolean)
  )];

  return {
    ...mapConfig,
    locations,
    resources: mergedResources.map(resource => ({
      ...resource,
      floorKey: inferResourceFloorKey(resource)
    }))
  };
}

function normalizeTenant(rawTenant) {
  const source = rawTenant || {};
  const baseConfig = source.config && typeof source.config === 'object' ? source.config : getDefaultClientConfig();
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

function normalizeState(rawState) {
  const nextState = createDefaultState();
  const parsed = rawState && typeof rawState === 'object' ? rawState : null;

  if (parsed && parsed.tenants && typeof parsed.tenants === 'object') {
    Object.entries(parsed.tenants).forEach(([clientId, tenant]) => {
      nextState.tenants[sanitizeClientId(clientId)] = normalizeTenant(tenant);
    });
    nextState.lastUpdatedAt = parsed.lastUpdatedAt || null;
    return nextState;
  }

  if (parsed && (parsed.activeAlert || parsed.alertHistory)) {
    nextState.tenants[DEFAULT_CLIENT_ID] = {
      ...createTenantState(),
      activeAlert: parsed.activeAlert || null,
      alertHistory: Array.isArray(parsed.alertHistory) ? parsed.alertHistory : [],
      lastUpdatedAt: parsed.lastUpdatedAt || null
    };
    nextState.lastUpdatedAt = parsed.lastUpdatedAt || null;
  }

  return nextState;
}

function getStateDirectory() {
  return path.dirname(STATE_FILE);
}

function ensureStateDirectory() {
  const directory = getStateDirectory();
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function getVercelKv() {
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
    return null;
  }

  try {
    const { kv } = require('@vercel/kv');
    return kv;
  } catch {
    return null;
  }
}

async function loadState() {
  const kv = getVercelKv();
  if (kv) {
    const stored = await kv.get(STATE_KEY);
    if (!stored) {
      return createDefaultState();
    }

    if (typeof stored === 'string') {
      try {
        return normalizeState(JSON.parse(stored));
      } catch {
        return createDefaultState();
      }
    }

    return normalizeState(stored);
  }

  try {
    if (!fs.existsSync(STATE_FILE)) {
      return createDefaultState();
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

async function saveState(nextState) {
  const kv = getVercelKv();
  if (kv) {
    await kv.set(STATE_KEY, JSON.stringify(nextState));
    return;
  }

  ensureStateDirectory();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function getClientIdFromRequest(requestUrl, body = {}, req = null) {
  const queryClientId = requestUrl.searchParams.get('clientId') || requestUrl.searchParams.get('client') || '';
  const headerClientId = req ? (req.headers['x-client-id'] || '') : '';
  const bodyClientId = body && typeof body === 'object' ? body.clientId : '';

  return sanitizeClientId(queryClientId || headerClientId || bodyClientId || DEFAULT_CLIENT_ID);
}

function getTenantState(state, clientId, createIfMissing = true) {
  const safeClientId = sanitizeClientId(clientId);
  if (!state.tenants[safeClientId] && createIfMissing) {
    state.tenants[safeClientId] = createTenantState();
  }

  return state.tenants[safeClientId] || createTenantState();
}

function getSnapshot(state, clientId) {
  const tenant = getTenantState(state, clientId);
  return {
    clientId: sanitizeClientId(clientId),
    config: tenant.config || getDefaultClientConfig(),
    activeAlert: tenant.activeAlert,
    alertHistory: tenant.alertHistory,
    lastUpdatedAt: tenant.lastUpdatedAt
  };
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

function createAlert(state, payload, clientId) {
  const tenant = getTenantState(state, clientId);
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

  return {
    duplicate: false,
    alert
  };
}

function resolveActiveAlert(state, alertId, resolverName, clientId) {
  const tenant = getTenantState(state, clientId);
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

  return { found: true, alert: resolvedAlert };
}

function escalateActiveAlert(state, alertId, escalatedBy, clientId, severity = 'critical') {
  const tenant = getTenantState(state, clientId);
  const activeAlert = tenant.activeAlert;
  if (!activeAlert) {
    return { found: false };
  }

  if (alertId && activeAlert.id !== alertId) {
    return { found: false, alert: activeAlert };
  }

  const updatedAt = nowIso();
  const escalatedAlert = {
    ...activeAlert,
    severity: severity || 'critical',
    updatedAt,
    escalatedBy: escalatedBy || 'System'
  };

  tenant.activeAlert = escalatedAlert;
  tenant.alertHistory = tenant.alertHistory.map(alert => {
    if (alert.id !== escalatedAlert.id) {
      return alert;
    }
    return escalatedAlert;
  });

  tenant.lastUpdatedAt = updatedAt;
  state.lastUpdatedAt = updatedAt;

  return { found: true, alert: escalatedAlert };
}

function clearDashboardData(state, clientId) {
  const tenant = getTenantState(state, clientId);
  const clearedAt = nowIso();

  tenant.activeAlert = null;
  tenant.alertHistory = [];
  tenant.lastUpdatedAt = clearedAt;
  state.lastUpdatedAt = clearedAt;

  return { clearedAt };
}

function clearResolvedDashboardData(state, clientId) {
  const tenant = getTenantState(state, clientId);
  const clearedAt = nowIso();
  const beforeCount = Array.isArray(tenant.alertHistory) ? tenant.alertHistory.length : 0;

  tenant.alertHistory = (tenant.alertHistory || []).filter(alert => alert && alert.status === 'active');
  const removedCount = Math.max(0, beforeCount - tenant.alertHistory.length);

  tenant.lastUpdatedAt = clearedAt;
  state.lastUpdatedAt = clearedAt;

  return {
    clearedAt,
    removedCount
  };
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

function sendText(res, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    ...CORS_HEADERS
  });
  res.end(content);
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleApiRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, 'http://localhost');
  const { pathname } = requestUrl;

  if (req.method === 'GET' && pathname === '/api/health') {
    const state = await loadState();
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
    const state = await loadState();
    sendJson(res, 200, {
      appName: 'MedResponse',
      ...getSnapshot(state, clientId)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/stream') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    const state = await loadState();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS_HEADERS
    });
    res.write(': connected\n\n');
    sendSseEvent(res, 'state:update', {
      reason: 'snapshot',
      ...getSnapshot(state, clientId)
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/api/alert/current') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    const state = await loadState();
    const tenant = getTenantState(state, clientId);
    const activeAlert = tenant.activeAlert;
    sendJson(res, 200, {
      activeAlert,
      ageSeconds: getAlertAgeSeconds(activeAlert)
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/alerts/history') {
    const clientId = getClientIdFromRequest(requestUrl, {}, req);
    const state = await loadState();
    const tenant = getTenantState(state, clientId);
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
    const state = await loadState();

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
      ...getSnapshot(state, clientId)
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
    const state = await loadState();

    if (!location) {
      sendJson(res, 400, { ok: false, message: 'Location is required' });
      return;
    }

    const result = createAlert(state, body, clientId);
    if (result.duplicate) {
      sendJson(res, 409, {
        ok: false,
        message: result.sameLocation ? 'Alert already sent from this location' : 'Another active alert already exists',
        activeAlert: result.alert
      });
      return;
    }

    await saveState(state);
    sendJson(res, 201, {
      ok: true,
      alert: result.alert,
      ...getSnapshot(state, clientId)
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
    const state = await loadState();
    const result = resolveActiveAlert(state, alertId, body.resolvedBy, clientId);

    if (!result.found) {
      const tenant = getTenantState(state, clientId);
      sendJson(res, 404, {
        ok: false,
        message: 'No matching active alert found',
        activeAlert: tenant.activeAlert
      });
      return;
    }

    await saveState(state);
    sendJson(res, 200, {
      ok: true,
      alert: result.alert,
      ...getSnapshot(state, clientId)
    });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/alerts/') && pathname.endsWith('/escalate')) {
    const parts = pathname.split('/').filter(Boolean);
    const alertId = parts[2];
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const clientId = getClientIdFromRequest(requestUrl, body, req);
    const state = await loadState();
    const result = escalateActiveAlert(state, alertId, body.escalatedBy, clientId, body.severity || 'critical');

    if (!result.found) {
      const tenant = getTenantState(state, clientId);
      sendJson(res, 404, {
        ok: false,
        message: 'No matching active alert found',
        activeAlert: tenant.activeAlert
      });
      return;
    }

    await saveState(state);
    sendJson(res, 200, {
      ok: true,
      alert: result.alert,
      ...getSnapshot(state, clientId)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/dashboard/clear') {
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const role = normalizeRole(body.role || '');
    if (role !== 'staff' && role !== 'admin') {
      sendJson(res, 403, {
        ok: false,
        message: 'Only staff/admin can clear dashboard data'
      });
      return;
    }

    const clientId = getClientIdFromRequest(requestUrl, body, req);
    const state = await loadState();
    const result = clearDashboardData(state, clientId);

    await saveState(state);
    sendJson(res, 200, {
      ok: true,
      message: 'Dashboard data cleared',
      clearedAt: result.clearedAt,
      ...getSnapshot(state, clientId)
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/dashboard/clear-resolved') {
    const body = await readBody(req).catch(error => ({ error }));
    if (body.error) {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' });
      return;
    }

    const role = normalizeRole(body.role || '');
    if (role !== 'staff' && role !== 'admin') {
      sendJson(res, 403, {
        ok: false,
        message: 'Only staff/admin can clear resolved incidents'
      });
      return;
    }

    const clientId = getClientIdFromRequest(requestUrl, body, req);
    const state = await loadState();
    const result = clearResolvedDashboardData(state, clientId);

    await saveState(state);
    sendJson(res, 200, {
      ok: true,
      message: 'Resolved incidents cleared',
      clearedAt: result.clearedAt,
      removedCount: result.removedCount,
      ...getSnapshot(state, clientId)
    });
    return;
  }

  sendText(res, 404, 'Not found');
}

module.exports = {
  handleApiRequest,
  getDefaultClientConfig,
  sanitizeClientId,
  getSnapshot,
  loadState,
  saveState
};