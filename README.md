# AeroDispatch

**KI-gestützte Luftrettungs-Leitstellensimulation**

---

## Phase 1 + Realtime — Fachkern, API, WebSocket, Pilot Dashboard

Keine externen Abhängigkeiten für Core — WebSocket benötigt `ws` package.

## Start

```bash
npm install ws   # optional: aktiviert WebSocket Realtime
npm run seed     # Seed-Daten erzeugen
npm run dev      # Server + UI starten → http://localhost:3000
```

## Features

- Unit-Status-State-Machine mit validierten Übergängen
- Incident-Lifecycle automatisch aus Unit-Status abgeleitet
- REST-API + JSON-Datastore (keine externe DB nötig)
- **WebSocket Realtime-Layer**: Live-Updates für Status, Incidents und neue Alarmierungen
- Pilot-Dashboard: Unit, Einsatzliste, Realtime-Log, neuen Einsatz anlegen
- Fallback-Polling wenn WS nicht verfügbar
- Flash-Animation bei neuen Einsätzen

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | /api/health | Healthcheck |
| GET | /api/units | Alle Einheiten |
| GET | /api/incidents | Alle Einsätze |
| GET | /api/status-events | Status-Eventlog |
| POST | /api/incidents | Neuer Einsatz |
| POST | /api/incidents/:id/assign | Einsatz zuweisen |
| POST | /api/units/:id/status | Statuswechsel |

## WebSocket Events

| Event | Payload | Wann |
|---|---|---|
| `connected` | `{ message }` | Bei WS-Verbindung |
| `unit:status` | `{ unit, event }` | Bei jedem Statuswechsel |
| `incident:updated` | `Incident` | Bei Incident-Änderung |
| `incident:created` | `Incident` | Bei neuem Einsatz |

## Statusflow

```
frei → alarmiert → anflug → vor_ort → patient_an_bord → anflug_klinik → an_klinik → frei
```

## Nächste Phasen

- **Phase 3**: Kartenintegration (MapLibre + OSM)
- **Phase 4**: KI-Leitstelle textbasiert (Groq/OpenAI)
- **Phase 5**: Voice/Funk (STT + TTS)
- **Phase 6**: Simulator-Bridge (MSFS SimConnect)
