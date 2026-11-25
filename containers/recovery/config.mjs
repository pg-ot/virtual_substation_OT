export function parseConfig(bytes) {
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid recovery configuration JSON: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).sort().join(',') !== 'iec104Host,iec104Port,version' ||
      config.version !== 1 || config.iec104Host !== 'iec104-supervisory' ||
      !Number.isInteger(config.iec104Port) || config.iec104Port < 1 || config.iec104Port > 65535) {
    throw new Error('Invalid recovery configuration: expected version 1, the training gateway and a valid port');
  }
  return config;
}

export function configBytes(port) {
  return Buffer.from(JSON.stringify({ version: 1, iec104Host: 'iec104-supervisory', iec104Port: port }, null, 2) + '\n');
}
