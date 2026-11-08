# Wilayas Context

Algeria's administrative geography as read-only reference data: the 69 wilayas and 1541 communes of law 26-06 (2026) that every address, delivery fee and parcel ultimately points at. The list lives once, in `cod-shared/places`; D1's `wilayas` and `communes` rows exist for foreign keys and a test holds them to it.

## Language

### Geography

**Wilaya**:
One of Algeria's 69 provinces, numbered as the decrees number them (1–48 from 1984, 49–58 from law 19-12 in 2019, 59–69 from law 26-06 and decree 26-206 in 2026). The number is the primary key across orders, shipping rules, driver pay grids and carrier lookups — an integer everywhere, never a UUID. The range is `LAST_WILAYA_ID`, never a literal.
_Avoid_: State, region, department

**Commune**:
A municipality within a wilaya, addressed by a text ID such as `c-16-001`. The ID names a place, not a wilaya: a commune keeps its ID when a law moves it (Besbes is `c-07-007` and has been in Ouled Djellal, 51, since 2019). Never read a wilaya out of an ID.
_Avoid_: City, district, town

**Bilingual Names**:
Every record carries a French name (`name`) and an Arabic name (`nameAr`); search matches either script. The French spelling is the law's where a law lists the commune.
_Avoid_: Translations, localized labels

**Spelling**:
One of the ways a carrier, a law or an older list writes a commune (Aït Yenni / Beni Yenni; Bains Romains for El Hammamet). `cod-shared/places` keeps every one known, and `communeNamed(wilayaNumber, name)` is the one rule that reads a carrier's commune as ours: an exact spelling — accents, case and punctuation aside — of a commune filed under that wilaya number on any map. A spelling not known matches nothing.
_Avoid_: Fuzzy match, alias guess

**Older Map**:
The 1984 or 2019 wilaya a commune was under before a law moved it. Carriers still file communes on them (all three live lists were on the 2019 map in November 2026), so a commune is also matched under those numbers — never under an unrelated wilaya.
_Avoid_: Legacy wilaya, old ID

### Reference Data Rules

**Read-Only Reference**:
No create, update, or delete endpoints exist anywhere in this module. The list changes only by a new migration generated from `cod-shared/places` (as 0078 did for 2026).
_Avoid_: Catalog management, admin editing

**Open Access**:
Any authenticated user may read the geography — no RBAC scope beyond login is required.
_Avoid_: Public API, restricted reference

**Official Ordering**:
Wilayas always list in official-number order; communes list alphabetically by Latin name.
_Avoid_: Sorted results, custom ordering

## Boundaries

Terms owned by neighboring contexts — use them, don't redefine them here:

- **Prices per wilaya or commune**: Shipping Profiles context — geography carries no pricing whatsoever
- **Customer addresses**: Customers / Orders contexts consume these IDs, they don't produce them
- **Driver coverage grids**: Drivers context references wilaya IDs only
- **Map of Places, Carrier Place, Station Codes**: Delivery context — where each carrier delivers, in its own terms

## Edge Cases

**Tolerant ID parsing**: Path parameters like `16abc` parse as `16` and are accepted — route validation deliberately mirrors the handler's `parseInt` semantics so clients are never surprised by a stricter layer.

**No postal codes**: A commune carries none. The column migration 0000 seeded held the statistics office's code under the 1984 wilaya, not a postal code; 0078 dropped it.

**No pagination**: Both listings always return complete results — there is no limit or offset to reason about.
