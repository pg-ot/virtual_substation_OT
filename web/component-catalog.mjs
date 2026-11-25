const breaker = ['position', '52-F01 position', 'BRF01LD0/XCBR1.Pos'];
const trip = ['trip', 'Protection trip', 'PRF01LD0/PTRC1.Tr'];
const current = ['current', 'Phase A current', 'PRF01LD0/MMXU1.A.phsA'];
const iec104 = [
  ['position', '52-F01 position', 'CA 1 · IOA 100 · Double point'],
  ['trip', 'Protection trip', 'CA 1 · IOA 101 · Single point'],
  ['current', 'Phase A current', 'CA 1 · IOA 102 · Short float'],
  ['operationFailure', 'Breaker operation failure', 'CA 1 · IOA 103 · Single point'],
  ['closeInhibited', 'Close-inhibit latch', 'CA 1 · IOA 104 · Single point'],
];
const dnp3 = [
  ['position', '52-F01 position', 'Index 0 · Double-bit input'],
  ['trip', 'Protection trip', 'Index 0 · Binary input'],
  ['current', 'Phase A current', 'Index 0 · Analog input'],
  ['operationFailure', 'Breaker operation failure', 'Index 1 · Binary input'],
  ['closeInhibited', 'Close-inhibit latch', 'Index 2 · Binary input'],
];

export const components = {
  plant: {
    name: 'SIMF01', label: 'Process simulator', interface: 'Process MMS',
    primary: 'fault', signals: [
      ['voltage', 'Source bus voltage', 'SIMF01LD0/GGIO1.AnIn1'],
      ['current', 'Feeder current', 'SIMF01LD0/GGIO1.AnIn2'],
      ['fault', 'Simulated feeder fault', 'SIMF01LD0/GGIO1.Ind3'],
      ['contactA', '52a auxiliary contact', 'SIMF01LD0/GGIO1.Ind1'],
      ['contactB', '52b auxiliary contact', 'SIMF01LD0/GGIO1.Ind2'],
    ],
  },
  'merging-unit': {
    name: 'MUF01', label: 'Merging unit', interface: 'IEC 61850 Sampled Values',
    primary: 'current', signals: [
      ['current', 'Feeder current input', 'SIMF01 process measurement'],
      ['voltage', 'Source voltage input', 'SIMF01 process measurement'],
      ['skippedSamples', 'Publisher samples skipped', 'Since MUF01 startup'],
      ['skipEvents', 'Publisher skip events', 'Since MUF01 startup'],
    ],
  },
  protection: {
    name: 'PR-F01', label: 'Protection IED', interface: 'IEC 61850 MMS',
    primary: 'trip', signals: [trip, current],
  },
  breaker: {
    name: 'BRF01', label: 'Breaker control IED', interface: 'IEC 61850 MMS',
    primary: 'position', signals: [breaker,
      ['operationFailure', 'Operation failure', 'BRF01LD0/GGIO1.Ind1']],
  },
  gateway: {
    name: 'GW-01', label: 'IEC 104 gateway', interface: 'MMS → IEC 60870-5-104',
    primary: 'position', signals: iec104,
  },
  'control-centre': {
    name: 'CC-01', label: 'IEC 104 control centre', interface: 'IEC 60870-5-104 master',
    primary: 'position', signals: iec104,
  },
  'gateway-dnp3': {
    name: 'GW-01', label: 'DNP3 gateway', interface: 'MMS → DNP3',
    primary: 'position', signals: dnp3,
  },
  'control-centre-dnp3': {
    name: 'CC-01', label: 'DNP3 control centre', interface: 'DNP3 master',
    primary: 'position', signals: dnp3,
  },
};
