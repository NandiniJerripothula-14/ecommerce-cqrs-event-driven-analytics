# E-Commerce CQRS Event-Driven Analytics

High-throughput backend analytics system using **CQRS**, **event-driven architecture**, and the **transactional outbox pattern**.

## Architecture

- **Command Service** (`:8080`): Handles write operations (`POST /api/products`, `POST /api/orders`, `PUT /api/products/:id/price`).
- **Write DB** (`PostgreSQL`): Normalized transactional model (`products`, `orders`, `order_items`, `customers`, `outbox`).
- **Outbox Publisher** (inside command service): Polls unpublished outbox rows and publishes events to RabbitMQ.
- **Message Broker** (`RabbitMQ`): Durable exchange for asynchronous event delivery.
- **Consumer Service**: Idempotent projection processor that updates read models.
- **Read DB** (`PostgreSQL`): Denormalized analytics tables (materialized view style tables).
- **Query Service** (`:8081`): Read-only analytics API backed by read models.

## Event Flow

1. Client sends command to Command Service.
2. Command Service executes DB transaction:
   - updates write model
   - inserts event into `outbox`
3. Outbox publisher reads unpublished events and publishes to `ecommerce.events` exchange.
4. Consumer receives event, enforces idempotency (`processed_events`), and updates read models.
5. Query Service serves fast analytics from read model tables.

This design ensures **eventual consistency** and avoids dual-write inconsistencies.

## Requirements Coverage

- Docker Compose orchestration with health checks for all services
- `.env.example` at repository root
- `submission.json` at repository root
- Write model tables: `products`, `orders`, `order_items`
- Outbox table with `id`, `topic`, `payload`, `created_at`, `published_at`
- Command endpoints for product and order creation
- Outbox `OrderCreated` event on successful order transaction
- Read model views/tables:
  - `product_sales_view`
  - `category_metrics_view`
  - `customer_ltv_view`
  - `hourly_sales_view`
- Query analytics endpoints + sync status endpoint

## Quick Start

```bash
docker-compose up --build
```

Wait for healthy containers, then test:

### 1) Create Product

```bash
curl -X POST http://localhost:8080/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Laptop","category":"electronics","price":1200,"stock":10}'
```

### 2) Create Order

```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":101,"items":[{"productId":1,"quantity":2,"price":1200}]}'
```

### 3) Query Analytics

```bash
curl http://localhost:8081/api/analytics/products/1/sales
curl http://localhost:8081/api/analytics/categories/electronics/revenue
curl http://localhost:8081/api/analytics/customers/101/lifetime-value
curl http://localhost:8081/api/analytics/sync-status
```

### 4) Run Automated Integration Test

```bash
npm run test:integration
```

## Service Endpoints

### Command Service (`http://localhost:8080`)

- `GET /health`
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/:id/price`
- `POST /api/orders`

### Query Service (`http://localhost:8081`)

- `GET /health`
- `GET /api/analytics/products/{productId}/sales`
- `GET /api/analytics/categories/{category}/revenue`
- `GET /api/analytics/customers/{customerId}/lifetime-value`
- `GET /api/analytics/sync-status`

## Data Model

### Write DB

- `products(id, name, category, price, stock, created_at, updated_at)`
- `customers(id, name, created_at)`
- `orders(id, customer_id, total, status, created_at)`
- `order_items(id, order_id, product_id, quantity, price)`
- `outbox(id UUID, topic, payload JSONB, created_at, published_at)`

### Read DB

- `product_sales_view(product_id, total_quantity_sold, total_revenue, order_count)`
- `category_metrics_view(category_name, total_revenue, total_orders)`
- `customer_ltv_view(customer_id, total_spent, order_count, last_order_date)`
- `hourly_sales_view(hour_timestamp, total_orders, total_revenue)`
- `processed_events(event_id, processed_at)`
- `sync_status(id, last_processed_event_timestamp)`

## Notes

- Consumer logic is idempotent via `processed_events` PK conflict handling.
- `sync-status` reports current eventual consistency lag.
- Compose service names are used for inter-service networking (`db`, `read-db`, `broker`).
