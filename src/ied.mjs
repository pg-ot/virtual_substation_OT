export class Ied {
  #tripLatched = false;
  #mode = 'LOCAL';

  constructor(feeder) {
    this.feeder = feeder;
  }

  setMode(mode) {
    if (mode !== 'LOCAL' && mode !== 'REMOTE') throw new RangeError('Invalid control mode');
    this.#mode = mode;
  }

  evaluateProtection() {
    const { fault, position } = this.feeder.read();
    if (fault && position === 'CLOSED') {
      this.#tripLatched = true;
      this.feeder.operate(false);
    }
  }

  read() {
    return { ...this.feeder.read(), tripLatched: this.#tripLatched, mode: this.#mode };
  }

  command(origin, action) {
    if (origin !== this.#mode) return { accepted: false, reason: 'Control mode mismatch' };
    const { fault } = this.feeder.read();
    if (action === 'reset') {
      if (origin !== 'LOCAL' || fault) {
        return { accepted: false, reason: 'Reset requires local control and a cleared fault' };
      }
      this.#tripLatched = false;
    } else if (action === 'open' || action === 'close') {
      if (action === 'close' && (fault || this.#tripLatched)) {
        return { accepted: false, reason: 'Close blocked by protection' };
      }
      this.feeder.operate(action === 'close');
    } else {
      return { accepted: false, reason: 'Unknown command' };
    }
    return { accepted: true };
  }
}
