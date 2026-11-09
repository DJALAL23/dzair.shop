# Order Screening — Context

What happens to an order a shopper submits, before it becomes an order. It is
the inside of **Order Protection**, an App and a Checkout Check
(`cod-shared/apps/CONTEXT.md`): the merchant writes rules, and each submission
is screened against them.

## Language

**Order Attempt**:
One storefront submission that reached screening. It may become an Order, or a
Spam Order.
_Avoid_: Request, try

**Screening**:
Deciding what happens to an Order Attempt.
_Avoid_: Fraud check, scoring

**Order Rule**:
One If / Then the merchant keeps: its Conditions, all of which must hold, and
what to do with the attempt.
_Avoid_: Filter, policy

**Condition**:
One named check in a rule, from a closed catalogue.
_Avoid_: Field, criterion

**Rule Mode**:
Trial records what the rule would have done and changes nothing. Active acts.
Off does nothing.
_Avoid_: Status, state

**Signal**:
A fact about an attempt that Conditions read. A Condition whose Signal is
missing does not hold, whatever its operator.
_Avoid_: Fingerprint

**Verdict**:
The one result of Screening: accept, flag, or spam.
_Avoid_: Decision, score

**Rule Match**:
A rule whose Conditions all held on an attempt.
_Avoid_: Hit

**Spam Order**:
An attempt kept out of the store's orders until a person rescues it. It is not
an Order: no customer, no stock, no coupon use, no Business Event.
_Avoid_: Blocked order, quarantined order

**Rescue**:
A person turning a Spam Order into an Order.
_Avoid_: Restore, approve

**Block List**:
The numbers, addresses and devices the merchant blocked by hand.
_Avoid_: Blacklist

**Template**:
A ready set of rules, copied once into the store. After that they are ordinary
rules.
_Avoid_: Preset, profile
