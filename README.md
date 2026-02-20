# E-Commerce CQRS Event-Driven Analytics

High-throughput backend analytics system using **CQRS**, **event-driven architecture**, and the **transactional outbox pattern**.

## Architecture Diagram

```text
[Client]
  |
  | Commands (POST/PUT)
  v
[Command Service :8080] ---> [Write DB: products/orders/order_items/outbox]
  |                                   |
  | outbox poller                     | outbox rows
  v                                   v
[RabbitMQ exchange: ecommerce.events] ---> [Consumer Service]
                              |
                              v
                       [Read DB projections/views]
                              |
                              | Queries (GET)
                              v
                        [Query Service :8081]
```

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

## Eventual Consistency & Reliability

- The write model is committed first, and events are captured in `outbox` atomically.
- The outbox publisher asynchronously delivers events to RabbitMQ.
- The read model can lag briefly; `GET /api/analytics/sync-status` shows last processed event time and lag seconds.
- Consumer is idempotent via `processed_events(event_id)` and uses retries with a DLQ fallback.
- Messages that fail processing more than `MAX_RETRIES` are moved to DLQ (`analytics.readmodel.dlq`).

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

PowerShell equivalent:

```powershell
docker compose up --build -d
```

Wait for healthy containers, then test:

### 1) Create Product

```bash
curl -X POST http://localhost:8080/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Laptop","category":"electronics","price":1200,"stock":10}'
```

Expected response (`201`):

```json
{
  "productId": 1
}
```

### 2) Create Order

```bash
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId":101,"items":[{"productId":1,"quantity":2,"price":1200}]}'
```

Expected response (`201`):

```json
{
  "orderId": 1
}
```

### 3) Query Analytics

```bash
curl http://localhost:8081/api/analytics/products/1/sales
curl http://localhost:8081/api/analytics/categories/electronics/revenue
curl http://localhost:8081/api/analytics/customers/101/lifetime-value
curl http://localhost:8081/api/analytics/sync-status
```

Sample responses (`200`):

```json
{
  "productId": 1,
  "totalQuantitySold": 2,
  "totalRevenue": 2400,
  "orderCount": 1
}
```

```json
{
  "category": "electronics",
  "totalRevenue": 2400,
  "totalOrders": 1
}
```

```json
{
  "customerId": 101,
  "totalSpent": 2400,
  "orderCount": 1,
  "lastOrderDate": "2026-02-20T00:00:00.000Z"
}
```

```json
{
  "lastProcessedEventTimestamp": "2026-02-20T00:00:00.000Z",
  "lagSeconds": 2
}
```

### 4) Run Automated Integration Test

```bash
npm run test:integration
```

### 5) Run Strict Edge-Case Checks

```bash
npm run test:strict
```

### 6) Submission Pre-Check (Recommended)

```bash
npm run verify:submission
```

### 7) Inspect DLQ (Operational Check)

```bash
docker compose exec broker rabbitmqctl list_queues name messages | grep dlq
```

PowerShell:

```powershell
docker compose exec broker rabbitmqctl list_queues name messages
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

## Environment Variables

| Variable | Service | Purpose | Example |
| --- | --- | --- | --- |
| `DATABASE_URL` | command-service | Write DB connection | `postgresql://user:password@db:5432/write_db` |
| `READ_DATABASE_URL` | query-service, consumer-service | Read DB connection | `postgresql://user:password@read-db:5432/read_db` |
| `BROKER_URL` | command-service, consumer-service | RabbitMQ connection | `amqp://guest:guest@broker:5672/` |
| `EXCHANGE_NAME` | command-service, consumer-service | Event exchange name | `ecommerce.events` |
| `QUEUE_NAME` | consumer-service | Consumer queue | `analytics.readmodel` |
| `PORT` | command/query service | HTTP listen port | `8080`, `8081` |
| `OUTBOX_POLL_INTERVAL_MS` | command-service | Outbox publish polling frequency | `2000` |
| `OUTBOX_BATCH_SIZE` | command-service | Outbox publish batch size | `50` |

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

## Submission Checklist

- `docker-compose up --build` starts all services and health checks pass.
- Root contains: `docker-compose.yml`, `.env.example`, `submission.json`, `README.md`.
- Write model tables and `outbox` table exist.
- Read model projection tables exist and are updated by consumer.
- Command and query endpoints behave as required.
- `npm run verify:submission` passes.
