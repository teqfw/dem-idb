---
name: teqfw-dem-idb
description: Integrate the TeqFW DEM IndexedDB adapter into a browser host.
---

# DEM IndexedDB adapter

Read the package README for the current API, schema-update behavior, capabilities and limitations. DEM compiles JSON declarations; this adapter consumes the effective model. Register the DEM and DEM-IDB browser namespace roots before resolution. Initialize with `Adapter.open({model,name})` followed by explicit `createSchema()`.

Host composition may map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemIdb_Provider$` and the configuration contract to a host component returning adapter options. Business components use DEM repositories. Close the backend/provider at host shutdown and replace providers invalidated by schema upgrades.

Relations are descriptive by default; `enforceRelations:true` enables same-database atomic integrity checks. Full scans implement selections and logical key checks. Keep these differences and browser storage lifecycle visible when comparing with RDB. Structural schema updates preserve stores and snapshots but do not infer data conversions or audit historical constraints. The host owns migrations, backup and synchronization. Verify real browser behavior before claiming support for additional runtimes.
