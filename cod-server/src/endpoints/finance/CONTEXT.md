# The store's costs

The words this endpoint and `cod-shared/finance` use. The rules live in
`cod-shared/finance/model.ts` and `value.ts`; this file says what the words
mean.

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
  A product's per-order cost counts only the orders holding the product.

## Version

A cost is a series of versions. A change of its money (amount, currency,
charge) from a day after its amount in force started ends that version the
day before and starts a new one, so a past month never changes. A change on
or before that day, or with no day, corrects it in place. What a cost is
(name, category, product) is corrected on every version. A one-time cost has
no history.

## Stopping and deleting

Stopping gives the last version a last day: the cost stays in the months it
ran. Deleting removes every version from every month: it is for a mistake.

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
**per-order costs** (other per-order costs). Each version is rounded once, so
a cost's line, its group and the total always agree.
