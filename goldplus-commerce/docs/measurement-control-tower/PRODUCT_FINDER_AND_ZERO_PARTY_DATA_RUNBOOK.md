# Product Finder & Zero-Party Data Runbook

## Purpose
The Product Finder captures zero-party data to personalize recommendations.

## Measurement Mechanism
Interactions are dispatched to the generic measurement queue. They are explicitly NOT sent to the purchase measurement queue.

## Safe Semantics
WhatsApp intent clicks and Add-to-Cart events are recorded as intent signals. They do NOT contain `paymentReference` or `orderId` data to prevent purchase pollution.
