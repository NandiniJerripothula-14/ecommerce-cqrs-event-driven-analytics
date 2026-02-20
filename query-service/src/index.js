const express = require('express');
const { Pool } = require('pg');

const port = Number(process.env.PORT || 8081);
const readDatabaseUrl = process.env.READ_DATABASE_URL;

if (!readDatabaseUrl) {
  throw new Error('READ_DATABASE_URL is required');
}

const pool = new Pool({ connectionString: readDatabaseUrl });

const app = express();

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    return res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.get('/api/analytics/products/:productId/sales', async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) {
    return res.status(400).json({ error: 'Invalid productId' });
  }

  const result = await pool.query(
    'SELECT product_id, total_quantity_sold, total_revenue, order_count FROM product_sales_view WHERE product_id = $1',
    [productId]
  );

  if (result.rowCount === 0) {
    return res.status(200).json({
      productId,
      totalQuantitySold: 0,
      totalRevenue: 0,
      orderCount: 0
    });
  }

  const row = result.rows[0];
  return res.status(200).json({
    productId: row.product_id,
    totalQuantitySold: Number(row.total_quantity_sold),
    totalRevenue: Number(row.total_revenue),
    orderCount: Number(row.order_count)
  });
});

app.get('/api/analytics/categories/:category/revenue', async (req, res) => {
  const category = String(req.params.category);
  const result = await pool.query(
    'SELECT category_name, total_revenue, total_orders FROM category_metrics_view WHERE category_name = $1',
    [category]
  );

  if (result.rowCount === 0) {
    return res.status(200).json({
      category,
      totalRevenue: 0,
      totalOrders: 0
    });
  }

  const row = result.rows[0];
  return res.status(200).json({
    category: row.category_name,
    totalRevenue: Number(row.total_revenue),
    totalOrders: Number(row.total_orders)
  });
});

app.get('/api/analytics/customers/:customerId/lifetime-value', async (req, res) => {
  const customerId = Number(req.params.customerId);
  if (!Number.isInteger(customerId)) {
    return res.status(400).json({ error: 'Invalid customerId' });
  }

  const result = await pool.query(
    'SELECT customer_id, total_spent, order_count, last_order_date FROM customer_ltv_view WHERE customer_id = $1',
    [customerId]
  );

  if (result.rowCount === 0) {
    return res.status(200).json({
      customerId,
      totalSpent: 0,
      orderCount: 0,
      lastOrderDate: null
    });
  }

  const row = result.rows[0];
  return res.status(200).json({
    customerId: row.customer_id,
    totalSpent: Number(row.total_spent),
    orderCount: Number(row.order_count),
    lastOrderDate: row.last_order_date ? new Date(row.last_order_date).toISOString() : null
  });
});

app.get('/api/analytics/sync-status', async (_req, res) => {
  const result = await pool.query('SELECT last_processed_event_timestamp FROM sync_status WHERE id = 1');
  const timestamp = result.rows[0]?.last_processed_event_timestamp || null;

  const lagSeconds = timestamp
    ? Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000))
    : 0;

  return res.status(200).json({
    lastProcessedEventTimestamp: timestamp ? new Date(timestamp).toISOString() : null,
    lagSeconds
  });
});

app.listen(port, () => {
  console.log(`Query service listening on ${port}`);
});
