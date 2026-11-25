import { Feeder } from './feeder.mjs';
import { Gateway } from './gateway.mjs';
import { Ied } from './ied.mjs';

export function createClassroom() {
  const feeder = new Feeder();
  const ied = new Ied(feeder);
  const gateway = new Gateway(ied);
  let timeMs = 0;
  gateway.sample(timeMs);

  return {
    time: () => timeMs,
    station: () => ied.read(),
    supervisory: () => gateway.read(),
    gatewayDiagnostics: () => gateway.diagnostics(),
    local: (action) => ied.command('LOCAL', action),
    remote: (action) => gateway.command(action),
    setLink: (available) => gateway.setLink(available),
    setMode: (mode) => ied.setMode(mode),
    setFault(active) {
      feeder.setFault(active);
      ied.evaluateProtection();
    },
    step() {
      timeMs += 100;
      gateway.sample(timeMs);
    },
  };
}
