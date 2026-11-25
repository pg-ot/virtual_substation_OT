export class Feeder {
  #closed = true;
  #fault = false;

  setFault(active) {
    this.#fault = active;
  }

  operate(closed) {
    this.#closed = closed;
  }

  read() {
    return {
      position: this.#closed ? 'CLOSED' : 'OPEN',
      busVoltageKv: 11,
      feederCurrentA: this.#closed ? (this.#fault ? 600 : 120) : 0,
      fault: this.#fault,
    };
  }
}
