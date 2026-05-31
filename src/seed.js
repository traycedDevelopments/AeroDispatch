import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeDb } from './store.js';
import { UnitStatuses, IncidentStatuses } from './state-machine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const now = new Date().toISOString();

writeDb({
  users: [
    { id: 'user_0001', name: 'Moritz', role: 'pilot', callsign: 'Christoph 51', createdAt: now }
  ],
  units: [
    {
      id: 'unit_0001',
      callsign: 'Christoph 51',
      type: 'BK 117',
      homeBase: 'Backnang',
      status: UnitStatuses.AVAILABLE,
      pilotId: 'user_0001',
      createdAt: now
    },
    {
      id: 'unit_0002',
      callsign: 'Christoph 11',
      type: 'H135',
      homeBase: 'Stuttgart',
      status: UnitStatuses.AVAILABLE,
      pilotId: null,
      createdAt: now
    }
  ],
  incidents: [
    {
      id: 'incident_0001',
      code: 'H-Intern-Transfer',
      title: 'Intensivtransport nach Stuttgart',
      priority: 2,
      status: IncidentStatuses.PENDING,
      location: { name: 'Rems-Murr-Klinikum Winnenden', lat: 48.8761, lng: 9.3982 },
      destination: { name: 'Klinikum Stuttgart', lat: 48.7842, lng: 9.1770 },
      assignedUnitId: null,
      notes: 'Patient: 62J, Intensivpflichtiger Polytrauma, Zuweisung Stroke-Unit',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'incident_0002',
      code: 'NA-Notfall',
      title: 'Reanimation Autobahn A81',
      priority: 1,
      status: IncidentStatuses.PENDING,
      location: { name: 'A81 bei Mundelsheim', lat: 48.9651, lng: 9.2133 },
      destination: null,
      assignedUnitId: null,
      notes: 'Meldung: bewusstloser Fahrer, Ersthelfer vor Ort',
      createdAt: now,
      updatedAt: now
    }
  ],
  statusEvents: [],
  radioMessages: []
});

console.log('Seed complete.');
