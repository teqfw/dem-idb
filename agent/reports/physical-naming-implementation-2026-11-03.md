# DEM-IDB physical naming implementation report

- Date: 2026-11-03
- Scope: Format 2 IndexedDB physical naming, old-layout rejection, browser integration
- Status: implementation and verification complete
- Contract: accepted DEM Format 2 physical naming; cognitive contexts were not modified

## Implemented

- Application object stores now use the exact effective entity path, such as
  `/app/user`.
- Internal stores are `/dem/schema` and `/dem/sequence`; persisted layout metadata
  is revision 2.
- Effective model paths are validated in the adapter before any IndexedDB access.
  Application entities in `/dem` or its subtree fail as `INVALID_INPUT`.
- Databases containing `dem:/...`, `dem_schema` or `dem_sequence` are explicitly
  rejected as `UNSUPPORTED` before schema initialization. Their version, stores
  and records remain unchanged. No rename, copy, conversion or deletion is added;
  the host owns migration.
- CRUD/List, batches, sequences, indexes, transactions, compatibility checks and
  schema history use the current physical names.
- DEM browser-delivery assertions, the DEM-IDB browser suite, the public README
  and package skill now describe and verify the current contract.

## Verification

- DEM-IDB `npm run verify` with the local DEM checkout: passed (9 Node tests,
  TypeScript and the real Chromium browser suite).
- DEM `npm run verify`: passed (101 tests and TypeScript).
- DEM `npm run test:browser` with the local DEM-IDB source: passed (2 Chromium
  tests, including browser delivery and current physical-store assertions).
- `teqfw-platform .` in DEM-IDB and DEM: valid, zero violations.
- `teqfw-esm-validator . --profile base` in DEM-IDB: valid, zero violations.
- `git diff --check`: passed.

The local Chrome 156 executable required running the browser tests outside the
filesystem sandbox. The local DEM-IDB dependency used for DEM browser delivery was
temporary and restored after the test run.

## Handoff and limitations

Historical physical layouts are intentionally unsupported. Hosts must migrate
their data before using this adapter. Only Chromium was exercised for browser
behavior; Firefox, Safari and workers remain unverified. No Format 1 schema
support, historical migration framework, DEM-RDB change, package publication or
deployment was introduced.
