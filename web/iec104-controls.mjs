export function remoteActionEnabled(action, state, pending = false) {
  if (pending || state?.service !== 'RUNNING' || state?.link !== 'TRANSFERRING') return false;
  const position = state.points?.position;
  if (position?.quality !== 'GOOD') return false;
  return (action === 'open' && position.value === 'CLOSED') ||
    (action === 'close' && position.value === 'OPEN');
}
