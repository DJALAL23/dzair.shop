# Events Context

What happened in the store's business, written down once and handed to
everyone who asked to hear about it: the merchant's own systems, their team's
chats and inboxes, the store's customers, and built-in integrations such as
Meta conversions.

## Language

### The record

**Business Event**:
One fact about the store's business that the catalogue names — an order
confirmed, a parcel delivered — recorded together with the change it
describes, and never changed afterwards.
_Avoid_: Event (alone), domain event, notification, webhook event (that is a
carrier's delivery in the Webhook Inbox), Shipment Event (that is one status a
carrier or the merchant reported for a parcel)

**Event Type**:
The catalogue's name for a kind of Business Event, written `subject.what`
(`order.confirmed`, `shipment.delivered`), with a version for the shape of its
data.
_Avoid_: Action (that is the Activity Log's word), topic, kind

**Event Catalogue**:
Every Event Type the store publishes, with the shape of each version's data. A
published version is a promise to every consumer: it is only ever added to,
never changed.
_Avoid_: Event list, schema registry

**Event Log**:
The store's Business Events in the order they were recorded, each with its
Sequence.
_Avoid_: Activity Log (the staff audit trail), event stream, outbox

**Sequence**:
A Business Event's position in the Event Log: later events always have higher
numbers.
_Avoid_: Offset, cursor (a cursor is how a reader pages through it)

**Occurred At**:
When the fact happened in the world — the time a carrier says a parcel was
delivered, or the moment a staff member confirmed an order.
_Avoid_: Timestamp (alone), created at

**Recorded At**:
When the store learned the fact and wrote the Business Event. Never earlier
than Occurred At.
_Avoid_: Received at, sent at

**Subject**:
The thing a Business Event is about: an order or a shipment, named by its id.
_Avoid_: Entity, aggregate, target

### Who and through what

**Actor**:
Who caused a Business Event: a staff member, an AI agent acting for a staff
member, a shopper, a carrier, or the system itself.
_Avoid_: User (only staff are users), current user

**Actor Kind**:
Which of those five an Actor is: `staff`, `agent`, `shopper`, `carrier`,
`system`.
_Avoid_: Role (staff roles are admin and staff)

**Origin**:
The surface a Business Event came through: the dashboard, the API (a staff
member's API key), an AI agent, the storefront, a carrier's webhook, a carrier
sync, or a schedule.
_Avoid_: Source (a Shipment Event's source), channel (a Consumer's medium)

### Hearing about it

**Consumer**:
Something that receives the store's Business Events: one of the merchant's
webhook endpoints, a Telegram chat, an email address, the order's customer
over WhatsApp or SMS, or a built-in integration such as Meta conversions.
_Avoid_: Subscriber, listener, integration, hook

**Consumer Kind**:
How a Consumer is reached — webhook, Telegram, email, WhatsApp, SMS, Meta
conversions. Each kind has its own settings and its own way of sending.
_Avoid_: Provider (that names a carrier), channel type

**Channel**:
A Consumer Kind that sends a message to a person: Telegram, email, WhatsApp,
SMS.
_Avoid_: Medium, transport

**Recipient**:
Who a Channel's message is for: the merchant's team, or the customer of the
order the Business Event is about.
_Avoid_: Target, addressee

**Subscription**:
The Event Types a Consumer asked for, named exactly or by subject
(`order.*`). A Consumer only receives Business Events recorded while it
exists, unless they are replayed to it.
_Avoid_: Filter, topic list

**Signing Secret**:
The key a webhook Consumer uses to prove a Delivery came from this store. It
can be rotated; the previous one keeps verifying for a while.
_Avoid_: Token, API key, webhook secret (that is the carrier's secret on
inbound webhooks)

### Getting it there

**Delivery**:
One Business Event on its way to one Consumer, from the moment it is due
until it is delivered, skipped, or given up on.
_Avoid_: Dispatch (a Shipments word to avoid), message, send

**Attempt**:
One try at a Delivery, with what the Consumer answered.
_Avoid_: Retry (the first Attempt is not a retry), call

**Dead Delivery**:
A Delivery given up on after its Attempts ran out. It stays visible and can be
replayed.
_Avoid_: Failed (an Attempt fails; a Delivery dies), dropped

**Skipped Delivery**:
A Delivery its Consumer declined on purpose — Meta conversions for an event
the merchant's tracking mode does not send, a customer who opted out.
_Avoid_: Ignored, filtered

**Replay**:
Delivering past Business Events again, to one Consumer, on the merchant's
word.
_Avoid_: Resend, redeliver, backfill

## Rules

**Recorded with the change, or not at all**: a Business Event exists exactly
when the change it describes was committed; a change that did not happen has
no Business Event, and one that did is never without it.

**Every way in records the same event**: confirming an order from the
dashboard, through an AI agent, or by any future surface records the same
Business Event with a different Actor and Origin.

**At least once, never in a promised order**: a Consumer may receive a
Business Event more than once and must recognise it by its id; it orders
events by Sequence or Occurred At, never by arrival.

**The event keeps what was true**: a Business Event carries the facts as they
were when it was recorded; a later edit or deletion of its Subject never
changes it.
