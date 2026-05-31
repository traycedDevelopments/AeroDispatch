export const UnitStatuses = {
  AVAILABLE: 'AVAILABLE',
  ALARMED: 'ALARMED',
  RESPONDING: 'RESPONDING',
  ON_SCENE: 'ON_SCENE',
  PATIENT_LOADED: 'PATIENT_LOADED',
  AT_HOSPITAL: 'AT_HOSPITAL',
  RETURNING: 'RETURNING',
  UNAVAILABLE: 'UNAVAILABLE'
};

export const IncidentStatuses = {
  PENDING: 'PENDING',
  DISPATCHED: 'DISPATCHED',
  RESPONDING: 'RESPONDING',
  ON_SCENE: 'ON_SCENE',
  PATIENT_LOADED: 'PATIENT_LOADED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

const TRANSITIONS = {
  AVAILABLE:      ['ALARMED', 'UNAVAILABLE'],
  ALARMED:        ['RESPONDING', 'AVAILABLE'],
  RESPONDING:     ['ON_SCENE', 'AVAILABLE'],
  ON_SCENE:       ['PATIENT_LOADED', 'AVAILABLE'],
  PATIENT_LOADED: ['AT_HOSPITAL'],
  AT_HOSPITAL:    ['RETURNING', 'AVAILABLE'],
  RETURNING:      ['AVAILABLE'],
  UNAVAILABLE:    ['AVAILABLE']
};

export function canTransitionUnitStatus(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function deriveIncidentStatus(unitStatus, currentIncidentStatus) {
  const map = {
    RESPONDING:     'RESPONDING',
    ON_SCENE:       'ON_SCENE',
    PATIENT_LOADED: 'PATIENT_LOADED',
    AT_HOSPITAL:    'COMPLETED',
    AVAILABLE:      currentIncidentStatus === 'DISPATCHED' ? 'CANCELLED' : 'COMPLETED'
  };
  return map[unitStatus] ?? currentIncidentStatus;
}

export const STATUS_LABELS = {
  AVAILABLE:      'Frei',
  ALARMED:        'Alarmiert',
  RESPONDING:     'Auf Anfahrt',
  ON_SCENE:       'Vor Ort',
  PATIENT_LOADED: 'Patient aufgenommen',
  AT_HOSPITAL:    'Klinik',
  RETURNING:      'Rückfahrt',
  UNAVAILABLE:    'Nicht verfügbar'
};
