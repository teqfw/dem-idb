# Release Notes

## 2.2.0 — 2026-11-23

- Enforce DEM-declared delete and referenced-key update actions atomically in IndexedDB, including ordered batches and cascade-updated results.
- Reject conflicting cascade plans without changing stored records; retain `restrict` as the omitted-action default.
- Expand real-browser coverage for relation actions, cascade conflicts, and enum case/nullability constraints.
- Require the published `@teqfw/dem` `^2.1.0` compiler for relation-action support.

## 2.1.0 — 2026-11-18

- Accept all DEM attribute names during storage inspection, including names that cannot be used in native index key paths.
- Validate expected model package paths and report unsupported storage layout revisions distinctly.
- Expand browser coverage of inspection races, damaged metadata and connection cleanup.
- Clarify browser Registry initialization in the integration example.

## 2.0.0 — 2026-11-18

- Require DEM ^2.0.0 and Format 2 schemas.
- Use effective paths for stores and reject historical physical layouts; support model-bound batches and native CryptoKey values.
- Add read-only `inspectStorage()` with source history and structural validation.

## 0.2.0 — 2026-11-02

- Align the runtime dependency with `@teqfw/dem` 0.3.x and verify real IndexedDB
  integration against the published compiler and repository contracts.
