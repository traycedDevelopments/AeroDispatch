import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDb, writeDb, nextId } from './store.js';
import { canTransitionUnitStatus, deriveIncidentStatus, UnitStatuses, IncidentStatuses } from './state-machine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = path.extname(filePath);
  const mime = mimeTypes[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(fs.readFileSync(filePath));
}

// WebSocket clients registry
const wsClients = new Set();

export function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
    const uiDir = path.join(__dirname, '..', 'ui');
    const filePath = path.join(uiDir, url.pathname === '/' ? 'index.html' : url.pathname);
    return serveStatic(res, filePath);
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, version: '0.2.0' });
  }

  if (req.method === 'GET' && url.pathname === '/api/units') {
    return send(res, 200, readDb().units);
  }

  if (req.method === 'GET' && url.pathname === '/api/incidents') {
    return send(res, 200, readDb().incidents);
  }

  if (req.method === 'GET' && url.pathname === '/api/status-events') {
    return send(res, 200, readDb().statusEvents);
  }

  if (req.method === 'POST' && url.pathname === '/api/incidents') {
    const db = readDb();
    const body = await parseBody(req);
    if (!body.code || !body.title || !body.location?.name) {
      return send(res, 400, { error: 'code, title and location.name are required' });
    }
    const incident = {
      id: nextId('incident', db.incidents),
      code: body.code,
      title: body.title,
      priority: body.priority ?? 3,
      status: IncidentStatuses.PENDING,
      location: body.location,
      destination: body.destination ?? null,
      assignedUnitId: null,
      notes: body.notes ?? '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.incidents.push(incident);
    writeDb(db);
    broadcast('incident:created', incident);
    return send(res, 201, incident);
  }

  const assignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign$/);
  if (req.method === 'POST' && assignMatch) {
    const db = readDb();
    const incidentId = assignMatch[1];
    const body = await parseBody(req);
    const incident = db.incidents.find(i => i.id === incidentId);
    const unit = db.units.find(u => u.id === body.unitId);
    if (!incident) return send(res, 404, { error: 'Incident not found' });
    if (!unit) return send(res, 404, { error: 'Unit not found' });
    if (unit.status !== UnitStatuses.AVAILABLE) return send(res, 400, { error: `Unit not available (${unit.status})` });
    incident.assignedUnitId = unit.id;
    incident.status = IncidentStatuses.DISPATCHED;
    incident.updatedAt = new Date().toISOString();
    unit.status = UnitStatuses.ALARMED;
    const event = {
      id: nextId('status', db.statusEvents),
      unitId: unit.id,
      incidentId: incident.id,
      from: UnitStatuses.AVAILABLE,
      to: UnitStatuses.ALARMED,
      source: 'system',
      createdAt: new Date().toISOString()
    };
    db.statusEvents.push(event);
    writeDb(db);
    broadcast('unit:status', { unit, event });
    broadcast('incident:updated', incident);
    return send(res, 200, { incident, unit });
  }

  const statusMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/status$/);
  if (req.method === 'POST' && statusMatch) {
    const db = readDb();
    const unitId = statusMatch[1];
    const body = await parseBody(req);
    const unit = db.units.find(u => u.id === unitId);
    if (!unit) return send(res, 404, { error: 'Unit not found' });
    if (!body.status) return send(res, 400, { error: 'status is required' });
    if (!canTransitionUnitStatus(unit.status, body.status)) {
      return send(res, 400, { error: `Invalid transition: ${unit.status} → ${body.status}` });
    }
    const oldStatus = unit.status;
    unit.status = body.status;
    const incident = body.incidentId
      ? db.incidents.find(i => i.id === body.incidentId)
      : db.incidents.find(i => i.assignedUnitId === unit.id && ![IncidentStatuses.COMPLETED, IncidentStatuses.CANCELLED].includes(i.status));
    if (incident) {
      incident.status = deriveIncidentStatus(body.status, incident.status);
      incident.updatedAt = new Date().toISOString();
      if (body.status === UnitStatuses.AVAILABLE && incident.assignedUnitId === unit.id) {
        incident.assignedUnitId = null;
      }
    }
    const event = {
      id: nextId('status', db.statusEvents),
      unitId: unit.id,
      incidentId: incident?.id ?? null,
      from: oldStatus,
      to: body.status,
      source: body.source ?? 'pilot',
      createdAt: new Date().toISOString()
    };
    db.statusEvents.push(event);
    writeDb(db);
    broadcast('unit:status', { unit, event });
    if (incident) broadcast('incident:updated', incident);
    return send(res, 200, { unit, incident: incident ?? null, event });
  }

  return send(res, 404, { error: 'Not found' });
});

// WebSocket upgrade
try {
  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ event: 'connected', data: { message: 'AeroDispatch WS ready' }, ts: new Date().toISOString() }));
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
  console.log('WebSocket server active.');
} catch (e) {
  console.log('ws package not found — WebSocket disabled. Run: npm install ws');
}

server.listen(port, () => {
  console.log(`AeroDispatch v0.2 → http://localhost:${port}`);
});
