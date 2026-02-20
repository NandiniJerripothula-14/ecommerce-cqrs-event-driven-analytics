const assert = require('assert');

const COMMAND_BASE_URL = process.env.COMMAND_BASE_URL || 'http://localhost:8080';
const QUERY_BASE_URL = process.env.QUERY_BASE_URL || 'http://localhost:8081';
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 30000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1000);

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

async function waitForHealth(baseUrl) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    try {
      const { response } = await requestJson(`${baseUrl}/health`);
      if (response.status === 200) {
        return;
      }
    } catch (_error) {
      // ignored until timeout
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Service not healthy within timeout: ${baseUrl}`);
}

async function pollUntil(checkFn, description) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const result = await checkFn();
    if (result.ok) {
      return result.value;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for: ${description}`);
}

async function run() {
  console.log('Checking service health...');
  await waitForHealth(COMMAND_BASE_URL);
  await waitForHealth(QUERY_BASE_URL);

  const unique = Date.now();
  const productName = `Test Product ${unique}`;
  const category = `category-${unique}`;
  const customerId = 1000 + (unique % 100000);

  console.log('Creating product...');
  const createProduct = await requestJson(`${COMMAND_BASE_URL}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: productName,
      category,
      price: 25,
      stock: 100
    })
  });

  assert.strictEqual(createProduct.response.status, 201, 'Expected POST /api/products to return 201');
  assert.ok(createProduct.body.productId, 'Expected productId in product creation response');
  const productId = Number(createProduct.body.productId);

  console.log('Creating orders...');
  const order1 = await requestJson(`${COMMAND_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId,
      items: [{ productId, quantity: 2, price: 25 }]
    })
  });

  const order2 = await requestJson(`${COMMAND_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId,
      items: [{ productId, quantity: 3, price: 25 }]
    })
  });

  assert.strictEqual(order1.response.status, 201, 'Expected first POST /api/orders to return 201');
  assert.strictEqual(order2.response.status, 201, 'Expected second POST /api/orders to return 201');
  assert.ok(order1.body.orderId, 'Expected orderId in first order response');
  assert.ok(order2.body.orderId, 'Expected orderId in second order response');

  const expectedQuantity = 5;
  const expectedRevenue = 125;
  const expectedOrderCount = 2;

  console.log('Polling projections...');
  const productSales = await pollUntil(async () => {
    const result = await requestJson(`${QUERY_BASE_URL}/api/analytics/products/${productId}/sales`);
    if (result.response.status !== 200) {
      return { ok: false };
    }

    const body = result.body;
    const matches =
      Number(body.totalQuantitySold) === expectedQuantity &&
      Number(body.totalRevenue) === expectedRevenue &&
      Number(body.orderCount) === expectedOrderCount;

    return { ok: matches, value: body };
  }, 'product sales projection');

  const categoryRevenue = await pollUntil(async () => {
    const result = await requestJson(`${QUERY_BASE_URL}/api/analytics/categories/${encodeURIComponent(category)}/revenue`);
    if (result.response.status !== 200) {
      return { ok: false };
    }

    const body = result.body;
    const matches = Number(body.totalRevenue) === expectedRevenue && Number(body.totalOrders) === expectedOrderCount;
    return { ok: matches, value: body };
  }, 'category projection');

  const customerLtv = await pollUntil(async () => {
    const result = await requestJson(`${QUERY_BASE_URL}/api/analytics/customers/${customerId}/lifetime-value`);
    if (result.response.status !== 200) {
      return { ok: false };
    }

    const body = result.body;
    const matches = Number(body.totalSpent) === expectedRevenue && Number(body.orderCount) === expectedOrderCount && !!body.lastOrderDate;
    return { ok: matches, value: body };
  }, 'customer LTV projection');

  const syncStatus = await requestJson(`${QUERY_BASE_URL}/api/analytics/sync-status`);
  assert.strictEqual(syncStatus.response.status, 200, 'Expected sync-status endpoint to return 200');
  assert.ok(Object.prototype.hasOwnProperty.call(syncStatus.body, 'lastProcessedEventTimestamp'), 'sync-status must include lastProcessedEventTimestamp');
  assert.ok(Object.prototype.hasOwnProperty.call(syncStatus.body, 'lagSeconds'), 'sync-status must include lagSeconds');

  console.log('Assertions passed.');
  console.log('Product sales:', productSales);
  console.log('Category metrics:', categoryRevenue);
  console.log('Customer LTV:', customerLtv);
  console.log('Sync status:', syncStatus.body);
}

run()
  .then(() => {
    console.log('Integration test passed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Integration test failed:', error.message);
    process.exit(1);
  });
