import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3200);
const staticDir = fileURLToPath(new URL('../public', import.meta.url));

createApp({ staticDir }).listen(port, () => {
  console.log(`Petify läuft auf http://localhost:${port}  (Quiz: /, API-Doku: /docs.html)`);
});
