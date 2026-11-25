import { createConnection, createServer } from 'node:net';

const server = createServer(client => {
  const upstream = createConnection({ host: 'kali', port: 6080 });
  client.on('error', error => {
    console.error('Kali desktop client connection failed:', error.message);
    upstream.destroy();
  });
  upstream.on('error', error => {
    console.error('Kali desktop upstream connection failed:', error.message);
    client.destroy();
  });
  client.pipe(upstream);
  upstream.pipe(client);
});

server.on('error', error => {
  console.error('Kali desktop proxy failed:', error.message);
  process.exitCode = 1;
});
server.listen(6080, '0.0.0.0');
