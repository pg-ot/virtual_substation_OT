const maxAgeMs = 4500;
// SIMF01 contact timestamps and the yard state service use the same host clock.
const movementTimeoutMs = 950;

export function yardTelemetry(snapshot, now = Date.now(), indications) {
  const fresh = point => Number.isFinite(point?.observedAt) && Math.abs(now - point.observedAt) <= maxAgeMs;
  function readPoint(point, validValue) {
    if (point?.quality !== 'GOOD' || !fresh(point) || !validValue(point.value)) return null;
    return point.value;
  }
  const read = (name, validValue) => readPoint(snapshot?.points?.[name], validValue);
  const qualityOf = (point, readValue) => readValue !== null ? 'GOOD' :
    ['INVALID', 'STALE'].includes(point?.quality) ? point.quality :
    point?.quality === 'GOOD' ? (fresh(point) ? 'INVALID' : 'STALE') : 'UNAVAILABLE';

  const binary = value => typeof value === 'boolean';
  const contactA = read('contactA', binary);
  const contactB = read('contactB', binary);
  const fault = read('fault', binary);
  const voltage = read('voltage', Number.isFinite);
  const current = read('current', Number.isFinite);
  const relayCurrentPoint = indications?.protection?.current;
  const tripPoint = indications?.protection?.trip;
  const failurePoint = indications?.breaker?.operationFailure;
  const breakerPositionPoint = indications?.breaker?.position;
  const relayCurrent = readPoint(relayCurrentPoint, Number.isFinite);
  const relayTrip = readPoint(tripPoint, binary);
  const operationFailure = readPoint(failurePoint, binary);
  const breakerPosition = readPoint(breakerPositionPoint, value =>
    ['OPEN', 'CLOSED', 'INTERMEDIATE'].includes(value));
  const contactTime = snapshot?.points?.contactA?.sourceTimeMs;
  const matchingTime = Number.isFinite(contactTime) && contactTime > 0 &&
    contactTime === snapshot?.points?.contactB?.sourceTimeMs;
  const elapsed = matchingTime ? snapshot.points.contactA.observedAt - contactTime : 0;
  let position = 'UNKNOWN';
  if (contactA !== null && contactB !== null) {
    if (contactA && contactB) position = 'INVALID CONTACTS';
    else if (contactA) position = 'CLOSED';
    else if (contactB) position = 'OPEN';
    else position = elapsed >= movementTimeoutMs ? 'STALLED' : 'IN TRANSIT';
  }
  const readings = [contactA, contactB, fault, voltage, current];
  const quality = readings.every(value => value !== null) ? 'LIVE' :
    readings.some(value => value !== null) ? 'PARTIAL' : 'UNAVAILABLE';
  return { position, contactA, contactB, fault, voltage, current,
    relayCurrent, relayTrip, operationFailure, breakerPosition,
    relayCurrentQuality: qualityOf(relayCurrentPoint, relayCurrent),
    relayTripQuality: qualityOf(tripPoint, relayTrip),
    operationFailureQuality: qualityOf(failurePoint, operationFailure),
    breakerPositionQuality: qualityOf(breakerPositionPoint, breakerPosition),
    positionSourceTimeMs: matchingTime && contactA !== null && contactB !== null ? contactTime : null,
    energized: voltage === null ? null : voltage > 0, quality };
}
