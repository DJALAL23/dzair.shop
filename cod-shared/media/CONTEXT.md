# Media

The files a store keeps to show — photos, logos, voice notes — and how they
get from the merchant or shopper to a host and from the host to a browser,
whichever host the store uses (ADR 0021).

## Language

### What is kept

**Media**:
One file the store keeps to show, recorded as one row in `media`.
_Avoid_: Asset, image object, upload

**Media Key**:
A file's identity, and the only thing stored where it is used: a path the
server chose under one of the store's folders — `products/`, `landing/`,
`reviews/`. Rich text holds it as `media:<key>`.
_Avoid_: R2 key, path, filename, URL

**Pending**:
A Media row whose Upload Ticket was issued but whose file the host has not yet
confirmed. Nothing may attach a pending key.

**Ready**:
A Media row whose file the host has confirmed: attachable and served.

### Where it lives

**Media Host**:
The service that holds a store's bytes: `imagekit` or `r2`. Chosen when the
store is created.
_Avoid_: Provider, storage, bucket, CDN

**Host Ref**:
The Media Host's own id for a file, when it has one (ImageKit's `fileId`).
_Avoid_: File id, external id

**Preparation**:
Turning a file as it arrives into its kept form — a photo re-encoded to WebP,
which drops EXIF and GPS; a voice note measured — before it is stored on the
host. It happens in the request that brings the file: nothing waits anywhere
first, so a store needs no storage besides its Media Host.
_Avoid_: Processing, optimization, staging

### How it is seen

**Media Delivery**:
How a browser fetches a store's keys: a kind (`imagekit`, `cloudflare`,
`direct`) and an origin. A key's URL is the origin, a slash, and the key.
_Avoid_: Media domain, CDN URL

**MediaImage**:
How the API returns any image: its key, its URL, and its width and height.

### How it arrives

**Upload Ticket**:
What the server hands a browser to upload one file of one type and size, for
ten minutes: `form` (signed multipart POST), `put` (signed PUT) or `relay`
(through the store's server).
_Avoid_: Presigned URL, upload token

**Release**:
A caller saying it no longer shows some keys. The files nothing else shows
are deleted from the host, then their rows.
_Avoid_: Delete image, cleanup

Nothing is released on a schedule. A file sent but never attached — a review
photo whose review was never sent — stays on the host until the merchant
deletes it there.
