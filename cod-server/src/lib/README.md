# Core Library Utilities

Shared server-side utilities for auditing and external service integrations.

## Structure

```
lib/
├── activity.ts     # Centralized Audit Log System
├── capi.ts         # Meta Conversions API (CAPI) client
├── meta-conversions.ts # Which stage is an order's conversion, and whether it is sent
├── errors/         # Shared error classes (BusinessLogicError, ConflictError, NotFoundError, …)
└── README.md       # This file
```

## Utilities

### 1. Activity Log System (`activity.ts`)
The `logActivity` helper is the system's "Black Box" recorder. It captures all
significant business events for auditing.

- **Non-Blocking:** Built with a `try/catch` wrapper that silently swallows
  errors. Auditing failures never crash the primary operation.
- **Action Constants:** Uses a standardized dot-notation (`entity.action`)
  found in the `ACTIONS` export (e.g., `order.created`, `stock.adjusted`).
- **Rich Context:** Supports a `metadata` JSON blob for storing extra details
  (e.g., old vs. new status).

**Usage Example:**
```typescript
await logActivity(db, actor, ACTIONS.ORDER_CREATED, {
  type: "order",
  id: orderId,
  label: orderNumber,
});
```

### 2. Meta Conversions API (`capi.ts`)
Client for sending CAPI events (e.g., `Purchase` at delivery) to
`https://graph.facebook.com`, used by the Meta conversions Consumer
(`src/events/consumers/meta-capi.ts`). Which stage is the conversion, and
whether the store's tracking lets it be sent, is decided in
`meta-conversions.ts`, which the thank-you page's tracking answer reads too.

### 3. Shared errors (`errors/`)
`BusinessLogicError`, `ConflictError`, `NotFoundError` — mapped to consistent
HTTP responses by the global error handler in `src/middleware/error.ts`.