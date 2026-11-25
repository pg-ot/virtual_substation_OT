export function closeGuidance(points, pickupA = null) {
  const read = name => points[name]?.quality === 'GOOD' ? points[name].value : null;
  const position = read('position');
  const trip = read('trip');
  const latch = read('closeInhibited');

  if (position === 'CLOSED' && latch === true)
    return 'Close latch set · Reset requires an open breaker and clear protection; follow the authorized switching procedure';
  if (position !== 'OPEN') return '';
  if (pickupA !== null) {
    const current = read('current');
    if (current == null) return 'Close blocked · apply valid PRF01 current';
    if (current >= pickupA) return 'Close blocked · PRF01 current is at or above pickup';
    if (trip === true) return 'Close blocked · reset PRF01 trip first';
  }
  if (trip === true) return 'Close blocked · protection trip asserted';
  if (trip == null || latch == null) return 'Close blocked · permissive status unavailable';
  return latch ? 'Close blocked · reset the breaker latch first' : '';
}
