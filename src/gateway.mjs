export class Gateway {
  #available = true;
  #quality = 'UNKNOWN';
  #sample = null;

  constructor(ied) {
    this.ied = ied;
  }

  setLink(available) {
    this.#available = available;
    if (!available && this.#sample) this.#quality = 'STALE';
  }

  sample(timeMs) {
    if (!this.#available) return;
    this.#sample = { ...this.ied.read(), timeMs };
    this.#quality = 'LIVE';
  }

  read() {
    return { quality: this.#quality, sample: this.#sample && { ...this.#sample } };
  }

  diagnostics() {
    return { available: this.#available, ...this.read() };
  }

  command(action) {
    if (!this.#available || this.#quality !== 'LIVE') {
      return { accepted: false, reason: 'Supervision requires a fresh station sample' };
    }
    return this.ied.command('REMOTE', action);
  }
}
