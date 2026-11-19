---
doc: brief
schema: 1
dish: skyhop-launch
item: checkout-and-dispatch
role: scout
model: sonnet
created: 2026-11-01T18:00:00Z
question: Where does an order go from the shipping picker to a dispatch queue?
confidence: high
sources:
  - "git ls-files src/checkout"
  - "git ls-files services"
---

## Answer

Checkout renders shipping options from one picker component in `src/checkout`, and a paid order
is published as one event that the dispatch service's paid order consumer reads. The consumer
puts every order on the courier queue today, so a drone queue is a routing branch, not a rewrite.
The courier SMS notifier hangs off the courier queue only.

## Anchors

```text
$ git ls-files src/checkout
src/checkout/ShippingOptions.tsx
src/checkout/ShippingOptions.test.tsx
src/checkout/confirmation/email.mjml
src/checkout/publishPaidOrder.ts
```

```text
$ git ls-files services
services/dispatch/paidOrderConsumer.ts
services/dispatch/courierQueue.ts
services/notify/courierSms.ts
```

## Not verified

The mobile order status screen lives in a separate app folder this scout did not list.
