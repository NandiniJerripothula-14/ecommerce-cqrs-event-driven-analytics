# Test Notes

This folder contains automated integration tests.

Run after starting containers:

```bash
npm run test:integration
```

Run strict hidden-edge-case checks:

```bash
npm run test:strict
```

Run both (submission pre-check):

```bash
npm run verify:submission
```

Optional environment overrides:

```bash
COMMAND_BASE_URL=http://localhost:8080
QUERY_BASE_URL=http://localhost:8081
POLL_TIMEOUT_MS=30000
POLL_INTERVAL_MS=1000
```

The integration test validates eventual consistency by:

1. Execute command request (create product/order).
2. Poll query endpoint until expected projection appears (or timeout).
3. Assert response payload and metrics.

The strict check validates:

1. Invalid payload rejection for products and orders.
2. Numeric/type edge cases (`NaN`, invalid numbers, negative values).
3. Sync-status response shape and numeric lag.
