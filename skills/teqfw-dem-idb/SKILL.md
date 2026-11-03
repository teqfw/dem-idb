---
name: teqfw-dem-idb
description: Integrate the TeqFW DEM IndexedDB adapter into a browser host.
---

# DEM IndexedDB adapter

Read the package README for the current API, schema-update behavior, capabilities and limitations. DEM compiles JSON declarations; this adapter consumes the effective model. Register the DEM and DEM-IDB browser namespace roots before resolution. Initialize with `Adapter.open({model,name})` followed by explicit `createSchema()`.

DEM schema descriptors use Format 2. Legacy Format 1 schema descriptors are
intentionally rejected without a compatibility mode; host maps remain Format 1.

Each application IndexedDB object store uses its exact effective entity path. The
adapter reserves `/dem/schema` and `/dem/sequence`, and rejects application
entities in `/dem` before database access. Historical layouts such as `dem:/...`,
`dem_schema` and `dem_sequence` are deliberately unsupported and rejected without
modifying the database; the host owns any required migration.

Host composition may map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemIdb_Provider$` and the configuration contract to a host component returning adapter options. Business components use DEM repositories. Close the backend/provider at host shutdown and replace providers invalidated by schema upgrades.

Relations are descriptive by default; `enforceRelations:true` enables same-database atomic integrity checks. Eligible key/equality reads use native indexes with coverage-safe fallback; other
selections and logical write checks scan records. Keep these differences and browser storage lifecycle visible when comparing with RDB. Structural schema updates preserve stores and snapshots but do not infer data conversions or audit historical constraints. The host owns migrations, backup and synchronization. Verify real browser behavior before claiming support for additional runtimes.


Selection evaluation is shared with RDB through DEM Repository/Select. The browser
suite exports the shared all-type workload transcript for DEM-RDB's comparison
runner. This proves its covered actions, not every possible value or operation.


Map the optional `TeqFw_Dem_Api_RepositoryBatch$` token to the same configured
Provider for atomic ordered CRUD/list command batches. Results publish after one
commit; any command failure rolls back. Use explicit dependent keys. Inspect
getSchemaHistory through the adapter backend and replace stale providers after
structural upgrades. All-core comparisons and keyless ordering follow DEM, including
byte ordering, numeric vector lexicographic order and canonical JSON representation
order. Async callbacks and schema commands are outside atomic data batches.
