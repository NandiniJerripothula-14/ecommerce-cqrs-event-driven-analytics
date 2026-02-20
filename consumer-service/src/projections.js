function toHourTimestamp(isoTimestamp) {
  const date = new Date(isoTimestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

async function applyOrderCreated(client, event) {
  const orderTotal = Number(event.total);
  const customerId = Number(event.customerId);
  const orderTimestamp = event.timestamp;

  const revenueByProduct = new Map();
  const quantityByProduct = new Map();

  for (const item of event.items) {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const revenue = Number(item.lineTotal ?? item.quantity * item.price);

    quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + quantity);
    revenueByProduct.set(productId, (revenueByProduct.get(productId) || 0) + revenue);
  }

  for (const [productId, quantity] of quantityByProduct.entries()) {
    const revenue = revenueByProduct.get(productId) || 0;

    await client.query(
      `
      INSERT INTO product_sales_view(product_id, total_quantity_sold, total_revenue, order_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (product_id)
      DO UPDATE SET
        total_quantity_sold = product_sales_view.total_quantity_sold + EXCLUDED.total_quantity_sold,
        total_revenue = product_sales_view.total_revenue + EXCLUDED.total_revenue,
        order_count = product_sales_view.order_count + 1
      `,
      [productId, quantity, revenue]
    );
  }

  const revenueByCategory = new Map();
  for (const item of event.items) {
    const category = String(item.category);
    const revenue = Number(item.lineTotal ?? item.quantity * item.price);
    if (!revenueByCategory.has(category)) {
      revenueByCategory.set(category, 0);
    }
    revenueByCategory.set(category, (revenueByCategory.get(category) || 0) + revenue);
  }

  for (const [categoryName, revenue] of revenueByCategory.entries()) {
    await client.query(
      `
      INSERT INTO category_metrics_view(category_name, total_revenue, total_orders)
      VALUES ($1, $2, 1)
      ON CONFLICT (category_name)
      DO UPDATE SET
        total_revenue = category_metrics_view.total_revenue + EXCLUDED.total_revenue,
        total_orders = category_metrics_view.total_orders + 1
      `,
      [categoryName, revenue]
    );
  }

  await client.query(
    `
    INSERT INTO customer_ltv_view(customer_id, total_spent, order_count, last_order_date)
    VALUES ($1, $2, 1, $3)
    ON CONFLICT (customer_id)
    DO UPDATE SET
      total_spent = customer_ltv_view.total_spent + EXCLUDED.total_spent,
      order_count = customer_ltv_view.order_count + 1,
      last_order_date = GREATEST(customer_ltv_view.last_order_date, EXCLUDED.last_order_date)
    `,
    [customerId, orderTotal, orderTimestamp]
  );

  await client.query(
    `
    INSERT INTO hourly_sales_view(hour_timestamp, total_orders, total_revenue)
    VALUES ($1, 1, $2)
    ON CONFLICT (hour_timestamp)
    DO UPDATE SET
      total_orders = hourly_sales_view.total_orders + 1,
      total_revenue = hourly_sales_view.total_revenue + EXCLUDED.total_revenue
    `,
    [toHourTimestamp(orderTimestamp), orderTotal]
  );
}

async function applyEvent(client, event) {
  if (event.eventType === 'OrderCreated') {
    await applyOrderCreated(client, event);
  }

  await client.query('UPDATE sync_status SET last_processed_event_timestamp = $1 WHERE id = 1', [event.timestamp || new Date()]);
}

module.exports = {
  applyEvent
};
