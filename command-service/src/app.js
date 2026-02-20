const crypto = require('crypto');
const express = require('express');
const { pool, healthcheck } = require('./db');

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'command-service',
    status: 'ok',
    endpoints: [
      'GET /health',
      'GET /api/products',
      'POST /api/products',
      'PUT /api/products/:id/price',
      'POST /api/orders'
    ]
  });
});

app.get('/health', async (_req, res) => {
  try {
    await healthcheck();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.get('/api/products', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, category, price, stock, created_at, updated_at FROM products ORDER BY id ASC'
    );

    return res.status(200).json({
      products: result.rows.map((row) => ({
        productId: row.id,
        name: row.name,
        category: row.category,
        price: Number(row.price),
        stock: row.stock,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, category, price, stock } = req.body;
  const normalizedPrice = Number(price);
  const normalizedStock = Number(stock);
  const validName = typeof name === 'string' && name.trim().length > 0;
  const validCategory = typeof category === 'string' && category.trim().length > 0;

  if (
    !validName ||
    !validCategory ||
    !Number.isFinite(normalizedPrice) ||
    normalizedPrice < 0 ||
    !Number.isInteger(normalizedStock) ||
    normalizedStock < 0
  ) {
    return res.status(400).json({ error: 'Invalid product payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insertProduct = await client.query(
      'INSERT INTO products(name, category, price, stock) VALUES ($1, $2, $3, $4) RETURNING id, name, category, price, stock, created_at',
      [name.trim(), category.trim(), normalizedPrice, normalizedStock]
    );

    const product = insertProduct.rows[0];
    const eventPayload = {
      eventId: crypto.randomUUID(),
      eventType: 'ProductCreated',
      productId: product.id,
      name: product.name,
      category: product.category,
      price: Number(product.price),
      stock: product.stock,
      timestamp: product.created_at
    };

    await client.query(
      'INSERT INTO outbox(id, topic, payload) VALUES ($1, $2, $3::jsonb)',
      [eventPayload.eventId, 'product.created', JSON.stringify(eventPayload)]
    );

    await client.query('COMMIT');
    return res.status(201).json({ productId: product.id });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/products/:id/price', async (req, res) => {
  const productId = Number(req.params.id);
  const newPrice = Number(req.body.price);

  if (!Number.isInteger(productId) || !Number.isFinite(newPrice) || newPrice < 0) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const productResult = await client.query(
      'UPDATE products SET price = $1, updated_at = NOW() WHERE id = $2 RETURNING id, category, price, updated_at',
      [newPrice, productId]
    );

    if (productResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productResult.rows[0];
    const eventPayload = {
      eventId: crypto.randomUUID(),
      eventType: 'PriceChanged',
      productId: product.id,
      category: product.category,
      price: Number(product.price),
      timestamp: product.updated_at
    };

    await client.query(
      'INSERT INTO outbox(id, topic, payload) VALUES ($1, $2, $3::jsonb)',
      [eventPayload.eventId, 'product.price.changed', JSON.stringify(eventPayload)]
    );

    await client.query('COMMIT');
    return res.status(200).json({ productId: product.id, price: Number(product.price) });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/orders', async (req, res) => {
  const { customerId, items } = req.body;

  if (!Number.isInteger(Number(customerId)) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }

  const normalizedItems = items.map((item) => ({
    productId: Number(item.productId),
    quantity: Number(item.quantity),
    price: Number(item.price)
  }));

  const hasInvalidItem = normalizedItems.some(
    (item) =>
      !Number.isInteger(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.price) ||
      item.price < 0
  );

  if (hasInvalidItem) {
    return res.status(400).json({ error: 'Invalid order items' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      INSERT INTO customers(id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
      `,
      [Number(customerId), `Customer ${Number(customerId)}`]
    );

    const itemsForEvent = [];
    let total = 0;

    for (const item of normalizedItems) {
      const productResult = await client.query(
        'SELECT id, name, category, stock FROM products WHERE id = $1 FOR UPDATE',
        [item.productId]
      );

      if (productResult.rowCount === 0) {
        throw new Error(`Product ${item.productId} not found`);
      }

      const product = productResult.rows[0];
      if (product.stock < item.quantity) {
        throw new Error(`Insufficient stock for product ${item.productId}`);
      }

      await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2', [item.quantity, item.productId]);

      const lineTotal = item.quantity * item.price;
      total += lineTotal;

      itemsForEvent.push({
        productId: item.productId,
        productName: product.name,
        category: product.category,
        quantity: item.quantity,
        price: item.price,
        lineTotal
      });
    }

    const orderResult = await client.query(
      'INSERT INTO orders(customer_id, total, status) VALUES ($1, $2, $3) RETURNING id, created_at',
      [Number(customerId), total, 'CREATED']
    );

    const order = orderResult.rows[0];

    for (const item of normalizedItems) {
      await client.query(
        'INSERT INTO order_items(order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [order.id, item.productId, item.quantity, item.price]
      );
    }

    const eventPayload = {
      eventId: crypto.randomUUID(),
      eventType: 'OrderCreated',
      orderId: order.id,
      customerId: Number(customerId),
      items: itemsForEvent,
      total,
      timestamp: order.created_at
    };

    await client.query('INSERT INTO outbox(id, topic, payload) VALUES ($1, $2, $3::jsonb)', [
      eventPayload.eventId,
      'order.created',
      JSON.stringify(eventPayload)
    ]);

    await client.query('COMMIT');
    return res.status(201).json({ orderId: order.id });
  } catch (error) {
    await client.query('ROLLBACK');
    const code = error.message.includes('Insufficient stock') || error.message.includes('not found') ? 400 : 500;
    return res.status(code).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = app;
