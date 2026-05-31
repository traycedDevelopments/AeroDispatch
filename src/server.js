import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDb, writeDb, nextId } from './store.js';
import { canTransitionUnitStatus, deriveIncidentStatus, UnitStatuses, IncidentStatuses } from './state-machine.js';
import { generateIncident, generateRadioResponse } from './ai.js';

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
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
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
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(filePath);
  const mime = mimeTypes[ext] || 'text/plain';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(fs.readFileSync(filePath));
}

const wsClients = new Set();

export function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: new Date().toISOString() });
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// Auto-generate incidents every 3–8 minutes if a unit is available
function scheduleNextIncident() {
  const delay = (180 + Math.random() * 300) * 1000;
  setTimeout(async () => {
    const db = readDb();
    const available = db.units.find(u => u.status === UnitStatuses.AVAILABLE);
    const active = db.incidents.filter(i => ![IncidentStatuses.COMPLETED, IncidentStatuses.CANCELLED].includes(i.status));
    if (available && active.length < 3) {
      try {
        const draft = await generateIncident(db);
        const incident = {
          id: nextId('incident', db.incidents),
          ...draft,
          status: IncidentStatuses.PENDING,
          assignedUnitId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          log: [{ ts: new Date().toISOString(), actor: 'KI-Leitstelle', text: `Einsatz generiert: ${draft.title}` }]
        };
        db.incidents.push(incident);
        writeDb(db);
        broadcast('incident:created', incident);
        console.log('[AI] Incident generated:', incident.code, incident.title);
      } catch (e) {
        console.error('[AI] Incident generation failed:', e.message);
      }
    }
    scheduleNextIncident();
  }, delay);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Static UI files
  if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
    const uiDir = path.join(__dirname, '..', 'ui');
    const filePath = path.join(uiDir, url.pathname === '/' ? 'index.html' : url.pathname);
    return serveStatic(res, filePath);
  }

  // Health
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, version: '1.0.0' });
  }

  // Units
  if (req.method === 'GET' && url.pathname === '/api/units') {
    return send(res, 200, readDb().units);
  }

  // Incidents
  if (req.method === 'GET' && url.pathname === '/api/incidents') {
    return send(res, 200, readDb().incidents);
  }

  // Status events
  if (req.method === 'GET' && url.pathname === '/api/status-events') {
    return send(res, 200, readDb().statusEvents);
  }

  // AI: generate incident on demand
  if (req.method === 'POST' && url.pathname === '/api/ai/generate-incident') {
    const db = readDb();
    try {
      const draft = await generateIncident(db);
      const incident = {
        id: nextId('incident', db.incidents),
        ...draft,
        status: IncidentStatuses.PENDING,
        assignedUnitId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        log: [{ ts: new Date().toISOString(), actor: 'KI-Leitstelle', text: `Einsatz generiert: ${draft.title}` }]
      };
      db.incidents.push(incident);
      writeDb(db);
      broadcast('incident:created', incident);
      return send(res, 201, incident);
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  // AI: radio response
  if (req.method === 'POST' && url.pathname === '/api/ai/radio') {
    const body = await parseBody(req);
    const db = readDb();
    const incident = db.incidents.find(i => i.id === body.incidentId);
    const unit = db.units.find(u => u.id === body.unitId);
    try {
      const response = await generateRadioResponse({ message: body.message, incident, unit, db });
      // append to incident log
      if (incident) {
        incident.log = incident.log || [];
        incident.log.push({ ts: new Date().toISOString(), actor: unit?.callsign || 'Pilot', text: body.message });
        incident.log.push({ ts: new Date().toISOString(), actor: 'KI-Leitstelle', text: response });
        incident.updatedAt = new Date().toISOString();
        writeDb(db);
        broadcast('incident:updated', incident);
      }
      broadcast('radio:message', { from: 'KI-Leitstelle', text: response, incidentId: body.incidentId });
      return send(res, 200, { response });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  // Create incident (manual)
  if (req.method === 'POST' && url.pathname === '/api/incidents') {
    const db = readDb();
    const body = await parseBody(req);
    if (!body.code || !body.title || !body.location?.name) {
      return send(res, 400, { error: 'code, title and location.name required' });
    }
    const incident = {
      id: nextId('incident', db.incidents),
      code: body.code, title: body.title,
      priority: body.priority ?? 3,
      status: IncidentStatuses.PENDING,
      location: body.location,
      destination: body.destination ?? null,
      assignedUnitId: null,
      notes: body.notes ?? '',
      log: [{ ts: new Date().toISOString(), actor: 'System', text: `Einsatz angelegt: ${body.title}` }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.incidents.push(incident);
    writeDb(db);
    broadcast('incident:created', incident);
    return send(res, 201, incident);
  }

  // Assign unit to incident
  const assignMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)\/assign$/);
  if (req.method === 'POST' && assignMatch) {
    const db = readDb();
    const body = await parseBody(req);
    const incident = db.incidents.find(i => i.id === assignMatch[1]);
    const unit = db.units.find(u => u.id === body.unitId);
    if (!incident) return send(res, 404, { error: 'Incident not found' });
    if (!unit) return send(res, 404, { error: 'Unit not found' });
    if (unit.status !== UnitStatuses.AVAILABLE) return send(res, 400, { error: `Unit not available (${unit.status})` });
    incident.assignedUnitId = unit.id;
    incident.status = IncidentStatuses.DISPATCHED;
    incident.updatedAt = new Date().toISOString();
    incident.log = incident.log || [];
    incident.log.push({ ts: new Date().toISOString(), actor: 'KI-Leitstelle', text: `${unit.callsign} alarmiert zum Einsatz.` });
    unit.status = UnitStatuses.ALARMED;
    const event = { id: nextId('status', db.statusEvents), unitId: unit.id, incidentId: incident.id, from: UnitStatuses.AVAILABLE, to: UnitStatuses.ALARMED, source: 'system', createdAt: new Date().toISOString() };
    db.statusEvents.push(event);
    writeDb(db);
    broadcast('unit:status', { unit, event });
    broadcast('incident:updated', incident);
    // AI alarm message
    generateRadioResponse({ message: 'ALARM', incident, unit, db })
      .then(msg => broadcast('radio:message', { from: 'KI-Leitstelle', text: msg, incidentId: incident.id }))
      .catch(() => {});
    return send(res, 200, { incident, unit });
  }

  // Unit status update
  const statusMatch = url.pathname.match(/^\/api\/units\/([^/]+)\/status$/);
  if (req.method === 'POST' && statusMatch) {
    const db = readDb();
    const body = await parseBody(req);
    const unit = db.units.find(u => u.id === statusMatch[1]);
    if (!unit) return send(res, 404, { error: 'Unit not found' });
    if (!body.status) return send(res, 400, { error: 'status required' });
    if (!canTransitionUnitStatus(unit.status, body.status)) {
      return send(res, 400, { error: `Invalid transition: ${unit.status} → ${body.status}` });
    }
    const oldStatus = unit.status;
    unit.status = body.status;
    const incident = db.incidents.find(i => i.assignedUnitId === unit.id && ![IncidentStatuses.COMPLETED, IncidentStatuses.CANCELLED].includes(i.status));
    if (incident) {
      incident.status = deriveIncidentStatus(body.status, incident.status);
      incident.updatedAt = new Date().toISOString();
      incident.log = incident.log || [];
      const statusLabels = { RESPONDING: 'auf Anfahrt', ON_SCENE: 'vor Ort', PATIENT_LOADED: 'Patient aufgenommen', AT_HOSPITAL: 'Klinik erreicht', AVAILABLE: 'wieder verfügbar' };
      incident.log.push({ ts: new Date().toISOString(), actor: unit.callsign, text: `Status: ${statusLabels[body.status] || body.status}` });
      if (body.status === UnitStatuses.AVAILABLE) incident.assignedUnitId = null;
    }
    const event = { id: nextId('status', db.statusEvents), unitId: unit.id, incidentId: incident?.id ?? null, from: oldStatus, to: body.status, source: body.source ?? 'pilot', createdAt: new Date().toISOString() };
    db.statusEvents.push(event);
    writeDb(db);
    broadcast('unit:status', { unit, event });
    if (incident) broadcast('incident:updated', incident);
    // AI status acknowledgement
    if (incident && ['RESPONDING', 'ON_SCENE', 'PATIENT_LOADED', 'AT_HOSPITAL'].includes(body.status)) {
      generateRadioResponse({ message: `STATUS_${body.status}`, incident, unit, db })
        .then(msg => broadcast('radio:message', { from: 'KI-Leitstelle', text: msg, incidentId: incident.id }))
        .catch(() => {});
    }
    return send(res, 200, { unit, incident: incident ?? null, event });
  }

  // MSFS position update
  if (req.method === 'POST' && url.pathname === '/api/sim/position') {
    const body = await parseBody(req);
    const db = readDb();
    const unit = db.units.find(u => u.id === body.unitId || u.callsign === body.callsign);
    if (unit) {
      unit.position = { lat: body.lat, lng: body.lng, alt: body.alt, heading: body.heading, speed: body.speed, onGround: body.onGround, phase: body.phase };
      unit.simConnected = true;
      unit.simType = body.simType || 'MSFS';
      writeDb(db);
      broadcast('unit:position', { unitId: unit.id, callsign: unit.callsign, ...body });
    }
    return send(res, 200, { ok: true });
  }

  // MSFS sim info
  if (req.method === 'GET' && url.pathname === '/api/sim/status') {
    const db = readDb();
    const units = db.units.map(u => ({ id: u.id, callsign: u.callsign, simConnected: u.simConnected || false, position: u.position || null }));
    return send(res, 200, { units });
  }

  return send(res, 404, { error: 'Not found' });
});

try {
  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ event: 'connected', data: { message: 'AeroDispatch v1.0 bereit' }, ts: new Date().toISOString() }));
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Handle radio messages from client
        if (msg.event === 'radio:send') {
          const db = readDb();
          const incident = db.incidents.find(i => i.id === msg.data.incidentId);
          const unit = db.units.find(u => u.id === msg.data.unitId);
          const response = await generateRadioResponse({ message: msg.data.text, incident, unit, db });
          if (incident) {
            incident.log = incident.log || [];
            incident.log.push({ ts: new Date().toISOString(), actor: unit?.callsign || 'Pilot', text: msg.data.text });
            incident.log.push({ ts: new Date().toISOString(), actor: 'KI-Leitstelle', text: response });
            incident.updatedAt = new Date().toISOString();
            writeDb(db);
            broadcast('incident:updated', incident);
          }
          broadcast('radio:message', { from: 'KI-Leitstelle', text: response, incidentId: msg.data.incidentId });
          broadcast('radio:message', { from: unit?.callsign || 'Pilot', text: msg.data.text, incidentId: msg.data.incidentId, outbound: true });
        }
      } catch(e) { /* ignore */ }
    });
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
  console.log('WebSocket aktiv.');
} catch (e) {
  console.log('ws package nicht gefunden — npm install ws');
}

server.listen(port, () => {
  console.log(`AeroDispatch v1.0 → http://localhost:${port}`);
  scheduleNextIncident();
});
