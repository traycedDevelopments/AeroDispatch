const API = '';

const statusLabels = {
  available: 'Frei',
  alarmed: 'Alarmiert',
  enroute: 'Anflug',
  on_scene: 'Vor Ort',
  patient_on_board: 'Patient an Bord',
  enroute_hospital: 'Anflug Klinik',
  at_hospital: 'An Klinik',
  out_of_service: 'Außer Dienst'
};

const allowedTransitions = {
  available: ['alarmed', 'out_of_service'],
  alarmed: ['enroute', 'available'],
  enroute: ['on_scene', 'available'],
  on_scene: ['patient_on_board', 'available'],
  patient_on_board: ['enroute_hospital', 'available'],
  enroute_hospital: ['at_hospital', 'available'],
  at_hospital: ['available'],
  out_of_service: ['available']
};

let myUnit = null;
let incidents = [];
let statusEvents = [];
let logEntries = [];
let selectedIncidentId = null;
let ws = null;
let wsConnected = false;

// ─── API ────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  return res.json();
}

// ─── WebSocket ──────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    wsConnected = true;
    document.getElementById('wsIndicator').classList.add('active');
    document.getElementById('wsStatus').textContent = 'live';
    document.getElementById('wsStatus').classList.add('connected');
    addLogEntry({ type: 'system', text: 'Echtzeit-Verbindung hergestellt' });
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch (_) {}
  };

  ws.onclose = () => {
    wsConnected = false;
    document.getElementById('wsIndicator').classList.remove('active');
    document.getElementById('wsStatus').textContent = 'getrennt';
    document.getElementById('wsStatus').classList.remove('connected');
    addLogEntry({ type: 'system', text: 'Verbindung getrennt – reconnect in 3s…' });
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => ws.close();
}

function handleWsMessage(msg) {
  const { event, data } = msg;

  if (event === 'unit:status') {
    const { unit, event: ev } = data;
    if (unit.id === myUnit?.id) myUnit = unit;
    if (ev) statusEvents = [...statusEvents, ev];
    addLogEntry({ type: 'unit', event, from: ev?.from, to: ev?.to, source: ev?.source });
    renderUnit();
    renderIncidents();
  }

  if (event === 'incident:updated') {
    incidents = incidents.map(i => i.id === data.id ? data : i);
    addLogEntry({ type: 'incident', event, text: `${data.code}: ${data.status}` });
    renderIncidents();
  }

  if (event === 'incident:created') {
    incidents = [...incidents, data];
    addLogEntry({ type: 'incident', event, text: `Neuer Einsatz: ${data.code} – ${data.title}` });
    renderIncidents();
    // flash the new card
    setTimeout(() => {
      const card = document.querySelector(`[data-id="${data.id}"]`);
      if (card) card.classList.add('new-flash');
    }, 50);
  }
}

function addLogEntry(entry) {
  logEntries.unshift({ ...entry, ts: new Date() });
  if (logEntries.length > 100) logEntries.pop();
  renderLog();
}

// ─── Load ────────────────────────────────────────────────
async function loadAll() {
  try {
    const [units, incs, events] = await Promise.all([
      api('/api/units'),
      api('/api/incidents'),
      api('/api/status-events')
    ]);
    const callsign = document.getElementById('pilotCallsign').textContent;
    myUnit = units.find(u => u.callsign === callsign);
    incidents = incs;
    statusEvents = events;
    renderUnit();
    renderIncidents();
    renderLog();
    document.getElementById('connectionDot').className = 'connection-dot ok';
  } catch (e) {
    document.getElementById('connectionDot').className = 'connection-dot error';
  }
}

// ─── Render: Unit ────────────────────────────────────────
function renderUnit() {
  const el = document.getElementById('unitCard');
  if (!myUnit) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Keine Einheit zugewiesen.</div>';
    el.classList.remove('skeleton-box');
    document.getElementById('statusButtons').innerHTML = '';
    return;
  }
  el.classList.remove('skeleton-box');
  el.innerHTML = `
    <div class="callsign">${myUnit.callsign}</div>
    <div class="unit-type">${myUnit.type}</div>
    <div class="status-pill status-${myUnit.status}">${statusLabels[myUnit.status] ?? myUnit.status}</div>
    <div class="unit-home">📍 ${myUnit.homeBase}</div>
  `;
  renderStatusButtons();
}

function renderStatusButtons() {
  const el = document.getElementById('statusButtons');
  if (!myUnit) { el.innerHTML = ''; return; }
  const transitions = allowedTransitions[myUnit.status] ?? [];
  if (!transitions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3>Status setzen</h3>` + transitions.map(s =>
    `<button class="btn-status" data-status="${s}">${statusLabels[s] ?? s}</button>`
  ).join('');
  el.querySelectorAll('.btn-status').forEach(btn =>
    btn.addEventListener('click', () => setStatus(btn.dataset.status))
  );
}

async function setStatus(status) {
  if (!myUnit) return;
  const activeIncident = incidents.find(
    i => i.assignedUnitId === myUnit.id && !['completed','cancelled'].includes(i.status)
  );
  const result = await api(`/api/units/${myUnit.id}/status`, 'POST', {
    status,
    incidentId: activeIncident?.id ?? null,
    source: 'pilot'
  });
  if (result.error) { alert(result.error); return; }
  // If WS not connected, update locally
  if (!wsConnected) {
    myUnit = result.unit;
    if (result.incident) incidents = incidents.map(i => i.id === result.incident.id ? result.incident : i);
    if (result.event) statusEvents = [...statusEvents, result.event];
    renderUnit();
    renderIncidents();
  }
}

// ─── Render: Incidents ──────────────────────────────────
function renderIncidents() {
  const el = document.getElementById('incidentList');
  if (!incidents.length) {
    el.innerHTML = '<div style="color:var(--text-faint);font-size:12px;padding:var(--space-4)">Keine Einsätze.</div>';
    return;
  }
  const sorted = [...incidents].sort((a, b) => a.priority - b.priority || new Date(b.createdAt) - new Date(a.createdAt));
  el.innerHTML = sorted.map(inc => {
    const canAssign = myUnit?.status === 'available' && inc.status === 'pending' && !inc.assignedUnitId;
    return `
    <div class="incident-card ${selectedIncidentId === inc.id ? 'selected' : ''}" data-id="${inc.id}">
      <div class="incident-top">
        <span class="incident-code">${inc.code}</span>
        <span class="incident-prio prio-${inc.priority}">P${inc.priority}</span>
      </div>
      <div class="incident-title">${inc.title}</div>
      <div class="incident-loc">📍 ${inc.location?.name ?? '—'}</div>
      ${inc.destination ? `<div class="incident-loc" style="margin-top:2px">🏥 ${inc.destination.name}</div>` : ''}
      ${inc.notes ? `<div style="font-size:11px;color:var(--text-faint);margin-top:4px">${inc.notes}</div>` : ''}
      <div class="incident-status-row">
        <span class="incident-status-tag istatus-${inc.status}">${inc.status}</span>
        ${inc.assignedUnitId ? `<span style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono)">${inc.assignedUnitId}</span>` : ''}
      </div>
      ${canAssign ? `<div class="assign-btn-row"><button class="btn btn-primary btn-sm btn-full" data-assign="${inc.id}">▶ Übernehmen</button></div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('[data-assign]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); assignIncident(btn.dataset.assign); })
  );
  el.querySelectorAll('.incident-card').forEach(card =>
    card.addEventListener('click', () => { selectedIncidentId = card.dataset.id; renderIncidents(); })
  );
}

async function assignIncident(incidentId) {
  if (!myUnit) return;
  const result = await api(`/api/incidents/${incidentId}/assign`, 'POST', { unitId: myUnit.id });
  if (result.error) { alert(result.error); return; }
  if (!wsConnected) {
    myUnit = result.unit;
    incidents = incidents.map(i => i.id === result.incident.id ? result.incident : i);
    renderUnit();
    renderIncidents();
  }
}

// ─── Render: Log ─────────────────────────────────────────
function renderLog() {
  const el = document.getElementById('statusLog');
  if (!logEntries.length && !statusEvents.length) {
    el.innerHTML = '<div style="color:var(--text-faint)">Kein Eintrag.</div>';
    return;
  }
  const wsEntries = logEntries.map(e => {
    const time = e.ts.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (e.type === 'unit' && e.from) {
      return `<div class="log-entry ws-event">
        <span class="log-time">${time}</span>
        <span class="log-from">${statusLabels[e.from] ?? e.from}</span>
        <span class="log-arrow">→</span>
        <span class="log-to">${statusLabels[e.to] ?? e.to}</span>
        <span class="log-source">[${e.source ?? 'ws'}]</span>
      </div>`;
    }
    if (e.type === 'incident') {
      return `<div class="log-entry ws-incident">
        <span class="log-time">${time}</span>
        <span class="log-event">INCIDENT</span>
        <span style="color:var(--text-muted)">${e.text}</span>
      </div>`;
    }
    return `<div class="log-entry">
      <span class="log-time">${time}</span>
      <span style="color:var(--text-faint)">${e.text ?? ''}</span>
    </div>`;
  });
  const apiEntries = [...statusEvents].reverse().map(e => {
    const time = new Date(e.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="log-entry">
      <span class="log-time">${time}</span>
      <span class="log-from">${statusLabels[e.from] ?? e.from}</span>
      <span class="log-arrow">→</span>
      <span class="log-to">${statusLabels[e.to] ?? e.to}</span>
      <span class="log-source">[${e.source}]</span>
    </div>`;
  });
  el.innerHTML = [...wsEntries, ...apiEntries].join('');
}

// ─── Modal ───────────────────────────────────────────────
document.getElementById('newIncidentBtn').addEventListener('click', () =>
  document.getElementById('modalBackdrop').classList.remove('hidden')
);
['closeModal','cancelModal'].forEach(id =>
  document.getElementById(id).addEventListener('click', () =>
    document.getElementById('modalBackdrop').classList.add('hidden')
  )
);
document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) document.getElementById('modalBackdrop').classList.add('hidden');
});
document.getElementById('incidentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const incident = {
    code: fd.get('code'),
    title: fd.get('title'),
    priority: Number(fd.get('priority')),
    location: { name: fd.get('locationName'), lat: parseFloat(fd.get('lat')) || 0, lng: parseFloat(fd.get('lng')) || 0 },
    destination: fd.get('destName') ? { name: fd.get('destName') } : null,
    notes: fd.get('notes')
  };
  const result = await api('/api/incidents', 'POST', incident);
  if (result.error) { alert(result.error); return; }
  if (!wsConnected) { incidents = [...incidents, result]; renderIncidents(); }
  document.getElementById('modalBackdrop').classList.add('hidden');
  e.target.reset();
});

// ─── Refresh button ──────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', loadAll);

// ─── Boot ────────────────────────────────────────────────
loadAll();
connectWS();
// Fallback polling wenn WS nicht verbunden
setInterval(() => { if (!wsConnected) loadAll(); }, 5000);
