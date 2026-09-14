import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'init') process.stdout.write(JSON.stringify({ type: 'ready', sessionId: message.sessionId }) + '\n');
  if (message.type === 'prompt') process.exit(7);
});
