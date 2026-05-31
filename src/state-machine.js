export const UnitStatuses = {
  AVAILABLE: 'available',
  ALARMED: 'alarmed',
  ENROUTE: 'enroute',
  ON_SCENE: 'on_scene',
  PATIENT_ON_BOARD: 'patient_on_board',
  ENROUTE_HOSPITAL: 'enroute_hospital',
  AT_HOSPITAL: 'at_hospital',
  OUT_OF_SERVICE: 'out_of_service'
};

export const IncidentStatuses = {
  PENDING: 'pending',
  DISPATCHED: 'dispatched',
  ACTIVE: 'active',
  TRANSPORTING: 'transporting',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const allowedTransitions = {
  [UnitStatuses.AVAILABLE]: [UnitStatuses.ALARMED, UnitStatuses.OUT_OF_SERVICE],
  [UnitStatuses.ALARMED]: [UnitStatuses.ENROUTE, UnitStatuses.AVAILABLE],
  [UnitStatuses.ENROUTE]: [UnitStatuses.ON_SCENE, UnitStatuses.AVAILABLE],
  [UnitStatuses.ON_SCENE]: [UnitStatuses.PATIENT_ON_BOARD, UnitStatuses.AVAILABLE],
  [UnitStatuses.PATIENT_ON_BOARD]: [UnitStatuses.ENROUTE_HOSPITAL, UnitStatuses.AVAILABLE],
  [UnitStatuses.ENROUTE_HOSPITAL]: [UnitStatuses.AT_HOSPITAL, UnitStatuses.AVAILABLE],
  [UnitStatuses.AT_HOSPITAL]: [UnitStatuses.AVAILABLE],
  [UnitStatuses.OUT_OF_SERVICE]: [UnitStatuses.AVAILABLE]
};

export function canTransitionUnitStatus(current, next) {
  return (allowedTransitions[current] || []).includes(next);
}

export function deriveIncidentStatus(unitStatus, currentIncidentStatus) {
  switch (unitStatus) {
    case UnitStatuses.ALARMED:
      return IncidentStatuses.DISPATCHED;
    case UnitStatuses.ENROUTE:
    case UnitStatuses.ON_SCENE:
      return IncidentStatuses.ACTIVE;
    case UnitStatuses.PATIENT_ON_BOARD:
    case UnitStatuses.ENROUTE_HOSPITAL:
    case UnitStatuses.AT_HOSPITAL:
      return IncidentStatuses.TRANSPORTING;
    case UnitStatuses.AVAILABLE:
      return currentIncidentStatus === IncidentStatuses.CANCELLED
        ? IncidentStatuses.CANCELLED
        : IncidentStatuses.COMPLETED;
    default:
      return currentIncidentStatus;
  }
}
