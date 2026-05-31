import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_DB = {
  units: [
    {
      id: 'unit-1',
      callsign: 'Christoph 15',
      type: 'H145',
      base: 'München',
      status: 'AVAILABLE',
      simConnected: false,
      position: { lat: 47.97, lng: 11.57, alt: 0, heading: 0, speed: 0, onGround: true, phase: 'PARKED' }
    },
    {
      id: 'unit-2',
      callsign: 'Christoph 1',
      type: 'H145',
      base: 'Nürnberg',
      status: 'AVAILABLE',
      simConnected: false,
      position: { lat: 49.45, lng: 11.08, alt: 0, heading: 0, speed: 0, onGround: true, phase: 'PARKED' }
    }
  ],
  incidents: [],
  statusEvents: []
};

export function readDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) { fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2)); return structuredClone(DEFAULT_DB); }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

export function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function nextId(prefix, arr) {
  const nums = arr.map(x => parseInt(x.id?.toString().replace(prefix + '-', '') || '0', 10)).filter(n => !isNaN(n));
  return `${prefix}-${(Math.max(0, ...nums) + 1)}`;
}
