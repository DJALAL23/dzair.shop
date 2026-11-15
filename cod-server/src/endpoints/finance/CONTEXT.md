# The store's costs

The words this endpoint and `cod-shared/finance` use. The rules live in
`cod-shared/finance/model.ts`, `versions.ts` and `value.ts`; this file says
what the words mean.

## Cost

Money the store spends that is neither a product's cost (frozen on each
order line), nor a carrier's charge, nor the confirmation team's pay (Team →
Payroll): ads, packaging, calls, content, salaries of people outside the
team, rent and bills, apps and subscriptions. Entered by the merchant, in
dinars, dollars or euros.

## Charge

When a cost counts:

- **once**: on the day it was paid;
- **daily / weekly / monthly / yearly**: from its first day, spread over each
  day it runs. A whole calendar month of a monthly cost is exactly its
  amount; half a month is half of it;
- **per confirmed / shipped / delivered / returned order**: on each order
  first confirmed (`orders.confirmed_at`), handed to a carrier or a driver
  (an accepted shipment's `created_at`), delivered (`delivered_at`) or
  returned (`returned_at`) on a day it runs, by the store day of that event.
  A product's per-order cost counts only the orders holding the product,
  also after the product is deleted (`removed_product_lines` keeps which
  lines were of it), so a past month never changes.

## Version

A cost is a series of versions, one per day at most, that follow on. Each
has its **terms**: what it costs (amount, currency, charge) and what it is
for (the whole store or one product). A change of terms applies from a day,
today at the latest: from that day on the terms that changed take their new
values, the others stay what they were each day, and the days before keep
everything, so a past month never changes. With no day, the change applies
from the day the terms in force started: a correction. Its name and
category are corrected on every version. A one-time cost has one version
and no history.

## Revision

Every write of a cost gives all its versions one new revision. A change
names the revision it was made to; a cost changed since, by anyone, is not
changed (`COST_CHANGED`), so a change is never applied to a state its
author did not see, nor applied twice.

## Stopping and deleting

Stopping gives the cost a last day: it stays in the months it ran, each day
with the terms it had (a change after that day goes). Deleting removes every
version from every month: it is for a mistake.

## Exchange Rate

What one dollar or one euro costs the merchant in dinars, from a store day
on: what they really pay, which in Algeria is rarely the bank's rate. Each
day of a foreign cost takes the rate in force that day.

## Left Out

A foreign cost on a day with no rate is never valued at a guess: it is left
out of the dinars, and the summary names the currency, the first day missing
and the costs, so the merchant sets the rate from that day.

## Summary

What the costs come to over store days: in total, and as **ad spend** (the
`ads` category), **running costs** (other one-time and repeating costs) and
**per-order costs** (other per-order costs). Each version is rounded once, to
the dinar, so a cost's line, its group and the total always agree to the
dinar the merchant reads.
