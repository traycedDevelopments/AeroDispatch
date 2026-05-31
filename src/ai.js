// KI-Leitstelle — Einsatzgenerierung und Funkdialoge
// Nutzt OpenAI API wenn OPENAI_API_KEY gesetzt ist, sonst hochwertige Offline-Fallbacks

const OPENAI_KEY = process.env.OPENAI_API_KEY;

const STICHWOERTER = [
  { code: 'NA01', title: 'Herzstillstand', priority: 1, notes: 'Reanimation läuft. BLS durch Ersthelfer vor Ort.' },
  { code: 'NA02', title: 'Schweres Polytrauma', priority: 1, notes: 'Verkehrsunfall auf Bundesstraße. Mehrere Verletzte.' },
  { code: 'NA03', title: 'Schlaganfall', priority: 1, notes: 'Patient bewusstlos, einseitige Lähmung. Stroke Unit angefragt.' },
  { code: 'NA04', title: 'Schwerer Atemnotsyndrom', priority: 2, notes: 'Patient hypoxisch, SpO2 < 85%.' },
  { code: 'NA05', title: 'Bergungsunfall', priority: 2, notes: 'Person in unwegsamem Gelände. Bodenrettung nicht erreichbar.' },
  { code: 'ITH01', title: 'Intensivtransport', priority: 2, notes: 'Sekundärtransport beatmeter Patient in Spezialklinik.' },
  { code: 'ITH02', title: 'Neonatologie-Transport', priority: 1, notes: 'Frühgeborenes. Brutkasten-Transport erforderlich.' },
  { code: 'NA06', title: 'Arbeitsunfall', priority: 2, notes: 'Schwere Schnittverletzung. Arteriell blutend.' },
  { code: 'NA07', title: 'Kindernotfall', priority: 1, notes: 'Kind, 4 Jahre. Krampfanfall, Bewusstlosigkeit.' },
  { code: 'SAR01', title: 'Vermisste Person', priority: 2, notes: 'Wanderer seit 6h vermisst. Alpines Gelände. Suchgebiet eingegrenzt.' },
];

const ORTE = [
  { name: 'Autobahn A8, km 134', lat: 48.105, lng: 11.312, type: 'STRASSE' },
  { name: 'Ortsmitte Miesbach', lat: 47.787, lng: 11.832, type: 'URBAN' },
  { name: 'Tegernsee Ufer', lat: 47.712, lng: 11.754, type: 'LAENDLICH' },
  { name: 'Baustelle B13, Wolfratshausen', lat: 47.911, lng: 11.425, type: 'STRASSE' },
  { name: 'Schliersee Bergpfad', lat: 47.731, lng: 11.876, type: 'GEBIRGE' },
  { name: 'Industriegebiet Rosenheim Nord', lat: 47.873, lng: 12.124, type: 'INDUSTRIE' },
  { name: 'Gemeindezentrum Holzkirchen', lat: 47.876, lng: 11.698, type: 'URBAN' },
  { name: 'Bundesstraße B307, Abfahrt Oberaudorf', lat: 47.649, lng: 12.152, type: 'STRASSE' },
  { name: 'Almhütte Spitzingsee', lat: 47.665, lng: 11.877, type: 'GEBIRGE' },
  { name: 'Wohngebiet Bad Aibling', lat: 47.864, lng: 12.007, type: 'URBAN' },
  { name: 'Feldweg bei Bruckmühl', lat: 47.876, lng: 11.921, type: 'LAENDLICH' },
  { name: 'Parkhaus Rosenheim Zentrum', lat: 47.857, lng: 12.129, type: 'URBAN' },
];

const KLINIKEN = [
  { name: 'RoMed Klinikum Rosenheim', lat: 47.856, lng: 12.127, lvl: 'MAX' },
  { name: 'Kreisklinik Miesbach', lat: 47.789, lng: 11.832, lvl: 'GRUND' },
  { name: 'Klinikum Rechts der Isar München', lat: 48.137, lng: 11.601, lvl: 'UNI' },
  { name: 'Krankenhaus Agatharied', lat: 47.785, lng: 11.815, lvl: 'REGEL' },
  { name: 'Klinikum Traunstein', lat: 47.869, lng: 12.641, lvl: 'MAX' },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildAlarmText(incident, unit) {
  const loc = incident.location;
  const dest = incident.destination;
  const destStr = dest ? `, Zielklinik ${dest.name}` : '';
  return `${unit.callsign}, hier Leitstelle. Einsatz ${incident.code} — ${incident.title} — in ${loc.name}. Priorität ${incident.priority}${destStr}. Bitte bestätigen.`;
}

function buildStatusAck(status, incident, unit) {
  const map = {
    STATUS_RESPONDING: `${unit.callsign}, verstanden. Anfahrt notiert. Meldet Ankunft.`,
    STATUS_ON_SCENE: `${unit.callsign}, vor Ort bestätigt. Lage vor Ort melden.`,
    STATUS_PATIENT_LOADED: `${unit.callsign}, Patient aufgenommen. Zielklinik ${incident?.destination?.name || 'unbekannt'} vorbereitet. Zeit läuft.`,
    STATUS_AT_HOSPITAL: `${unit.callsign}, Klinik notiert. Übergabe eingeleitet. Einsatz wird geschlossen.`,
    STATUS_AVAILABLE: `${unit.callsign}, Status frei. Bereitschaft bestätigt. Gute Wache.`,
  };
  return map[`STATUS_${status}`] || `${unit?.callsign || 'Einheit'}, Status ${status} erhalten. Verstanden.`;
}

async function callOpenAI(systemPrompt, userMessage) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json();
  return json.choices[0].message.content.trim();
}

export async function generateIncident(db) {
  const stichwort = pick(STICHWOERTER);
  const ort = pick(ORTE);
  const klinik = pick(KLINIKEN);

  if (OPENAI_KEY) {
    try {
      const system = `Du bist eine deutsche Rettungsleitstelle. Erstelle einen realistischen Hubschrauber-Notfall-Einsatz als JSON mit genau diesen Feldern: code, title, priority (1-3), notes, location (name, lat, lng), destination (name, lat, lng). Antworte NUR mit dem JSON-Objekt, kein Markdown.`;
      const user = `Einsatztyp: ${stichwort.title}. Ort: ${ort.name}. Klinik: ${klinik.name}. Mache den notes-Text realistisch und detailliert.`;
      const raw = await callOpenAI(system, user);
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return parsed;
    } catch(e) {
      console.warn('[AI] OpenAI Fallback:', e.message);
    }
  }

  return {
    code: stichwort.code,
    title: stichwort.title,
    priority: stichwort.priority,
    notes: stichwort.notes,
    location: { name: ort.name, lat: ort.lat, lng: ort.lng, type: ort.type },
    destination: { name: klinik.name, lat: klinik.lat, lng: klinik.lng }
  };
}

export async function generateRadioResponse({ message, incident, unit, db }) {
  if (message === 'ALARM') return buildAlarmText(incident, unit);
  if (message.startsWith('STATUS_')) return buildStatusAck(message.replace('STATUS_', ''), incident, unit);

  if (OPENAI_KEY && incident) {
    try {
      const system = `Du bist die Leitstelle in einem deutschen BOS-Digitalfunk-Einsatz. Antwortformat: kurz, max. 2 Sätze, echter Leitstellen-Sprechfunk-Stil. Kein Smalltalk. Immer mit Rufzeichen beginnen. Aktueller Einsatz: ${incident.code} — ${incident.title} in ${incident.location?.name}. Zugewiesene Einheit: ${unit?.callsign || 'unbekannt'}. Zielklinik: ${incident.destination?.name || 'nicht festgelegt'}.`;
      return await callOpenAI(system, `Pilotmeldung: "${message}"`);
    } catch(e) {
      console.warn('[AI] Radio Fallback:', e.message);
    }
  }

  // Offline Fallbacks
  const msg = message.toLowerCase();
  if (!incident) return `Leitstelle, bitte Einsatznummer angeben.`;
  const cs = unit?.callsign || 'Einheit';
  if (msg.includes('bestätig') || msg.includes('verstanden') || msg.includes('roger')) {
    return `${cs}, bestätigt. Weiter melden.`;
  }
  if (msg.includes('vor ort') || msg.includes('angekommen')) {
    return `${cs}, vor Ort notiert. Lagebericht bitte.`;
  }
  if (msg.includes('patient') && msg.includes('aufgenommen')) {
    return `${cs}, Patient aufgenommen bestätigt. Anflug ${incident.destination?.name || 'Klinik'}.`;
  }
  if (msg.includes('klinik') || msg.includes('übergabe')) {
    return `${cs}, Klinik notiert. Übergabe eingeleitet. Einsatz ${incident.code} abgeschlossen.`;
  }
  if (msg.includes('anforder') || msg.includes('nach') || msg.includes('support')) {
    return `${cs}, Anforderung erhalten. Prüfe Verfügbarkeit. Zurückmelden.`;
  }
  return `${cs}, Leitstelle hört. Meldung empfangen. Bitte weiter melden.`;
}
