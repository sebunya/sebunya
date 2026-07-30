/**
 * PesaPal stub for the end-to-end harness.
 *
 * Implements only the three endpoints the client actually calls, with the same
 * shapes. It exists so the checkout journey can be exercised end to end without a
 * single external call — no provider credentials, no sandbox account, no network
 * dependency in the assertion path, and no possibility of a real transaction.
 *
 * It is a STUB, not a mock: it holds state, so a second submission for the same
 * merchant reference is visible as a second transaction. That is what makes the
 * "a retry must not open a second provider transaction" assertion meaningful — a
 * mock that simply returned a URL could not tell the two cases apart.
 *
 * Usage: node scripts/qa/pesapal-stub.mjs <port>
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.argv[2] || 4599);

/** Every submission received, in order. Never de-duplicated by the stub. */
const submissions = [];
/** orderTrackingId -> the status this stub will report. */
const statuses = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  // Inspection endpoints for the harness. Namespaced under /__stub so they cannot
  // collide with a provider path.
  if (url.pathname === '/__stub/submissions') {
    return json(res, 200, { count: submissions.length, submissions });
  }
  if (url.pathname === '/__stub/reset') {
    submissions.length = 0;
    statuses.clear();
    return json(res, 200, { ok: true });
  }
  // Lets the harness decide what the next status query reports, so the paid path
  // and the failed path are both reachable without waiting on anything.
  if (url.pathname === '/__stub/status' && req.method === 'POST') {
    const body = await readJson(req);
    statuses.set(body.orderTrackingId, body.status);
    return json(res, 200, { ok: true });
  }

  if (url.pathname.endsWith('/api/Auth/RequestToken')) {
    const body = await readJson(req);
    if (!body.consumer_key || !body.consumer_secret) {
      return json(res, 401, { error: 'invalid_credentials' });
    }
    return json(res, 200, {
      token: `stub-token-${randomUUID()}`,
      expiryDate: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  }

  if (url.pathname.endsWith('/api/Transactions/SubmitOrderRequest')) {
    const body = await readJson(req);
    const trackingId = randomUUID();
    submissions.push({
      merchantReference: body.id,
      amount: body.amount,
      currency: body.currency,
      orderTrackingId: trackingId,
      at: new Date().toISOString(),
    });
    statuses.set(trackingId, 'PENDING');
    return json(res, 200, {
      order_tracking_id: trackingId,
      merchant_reference: body.id,
      // A distinct host, so the harness can prove the customer was redirected to
      // the provider rather than to any storefront page.
      redirect_url: `http://127.0.0.1:${port}/stub-pay/${trackingId}`,
      status: '200',
    });
  }

  if (url.pathname.endsWith('/api/Transactions/GetTransactionStatus')) {
    const trackingId = url.searchParams.get('orderTrackingId') || '';
    const status = statuses.get(trackingId);
    if (!status) return json(res, 404, { error: 'not_found' });
    const submission = submissions.find((s) => s.orderTrackingId === trackingId);
    return json(res, 200, {
      payment_method: 'Visa',
      amount: submission?.amount ?? 0,
      created_date: new Date().toISOString(),
      confirmation_code: `STUB-${trackingId.slice(0, 8)}`,
      payment_status_description: status,
      description: status,
      message: 'stub',
      payment_account: '4111XXXXXXXX1111',
      call_back_url: '',
      status_code: status === 'COMPLETED' ? 1 : status === 'FAILED' ? 2 : 0,
      merchant_reference: submission?.merchantReference ?? '',
      currency: submission?.currency ?? 'UGX',
      status: '200',
    });
  }

  // A stub page standing in for the bank's hosted form.
  if (url.pathname.startsWith('/stub-pay/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><title>Stub payment page</title>');
  }

  return json(res, 404, { error: 'no_stub_route', path: url.pathname });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`PESAPAL_STUB_LISTENING ${port}\n`);
});
