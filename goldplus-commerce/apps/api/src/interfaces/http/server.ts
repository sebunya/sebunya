import '../../config/env';
import { serve } from '@hono/node-server';
import app from './app';

import { startOutboxTicker } from '../../infrastructure/scheduler/OutboxTicker';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

console.log(`Starting GoldPlus API Server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Server is running at http://localhost:${info.port}`);

  if (process.env.NODE_ENV !== 'test') {
    startOutboxTicker();
  }
});
