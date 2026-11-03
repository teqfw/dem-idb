# DEM-IDB Path Validation and DEM Browser CI Report

- Date: 2026-11-03
- Scope: canonical DEM Format 2 effective paths and reproducible DEM browser CI
- Status: implemented, pushed and verified by GitHub Actions
- Cognitive contexts: not modified

## Findings

DEM Format 2 canonical paths require every segment to match `[a-z][a-z0-9]*`.
DEM-IDB previously accepted the weaker `[a-z0-9_]+` segment grammar. DEM's
compiler applies the stricter rule in `src/Compile/A/Path.mjs`.

The failed DEM run
[41617586351](https://github.com/teqfw/dem/actions/runs/41617586351) showed the
browser delivery assertion failing with `Unexpected IndexedDB entity stores: []`.
`dem/package-lock.json` resolves `@teqfw/dem-idb@0.2.0`; the registry lists no
newer compatible release. That installed adapter prefixes entity stores with
`dem:`, while the browser test expects direct effective-path stores such as
`/models/browser/cart`. The test correctly reported no stores matching its
current contract.

## Changes

- DEM-IDB now uses one canonical-path predicate for model paths and repository
  lookups. It requires an absolute path with segments matching
  `[a-z][a-z0-9]*` and returns `INVALID_INPUT` for noncanonical model paths
  before any IndexedDB operation.
- `/dem` and its subtree remain reserved and rejected before IndexedDB access.
  Effective paths continue to be the exact object-store names.
- Real-browser negative cases cover `/1item`, `/app/my_item`, `/app//item`,
  `/app/../item` and `/app/item/`; a recording IndexedDB factory confirms zero
  `open()` attempts for each rejected model.
- DEM's browser-only CI job checks out DEM-IDB at commit
  `de4dd7d9f0b8d57713711608d36b74fe805ddae1`, packs it into an npm tarball and
  installs that artifact after `npm ci`. The normal package jobs and consumer
  dependency lockfile remain independent of this CI-only source artifact. No
  npm release or local path dependency was introduced.

## Verification

- DEM-IDB `npm run verify` with the current sibling DEM source: passed, including
  9 Node tests, typecheck and the real Chromium IndexedDB suite. All path
  validation cases and existing adapter browser scenarios passed.
- DEM `npm ci` followed by `npm run verify` with the locked published adapter:
  passed, 101 tests and typecheck.
- DEM `npm run test:browser` after installing the tarball built from the pinned
  DEM-IDB source: passed, 2 browser harness tests in Headless Chromium 156,
  including physical store-name assertions and CRUD delivery.
- `teqfw-platform .` and `teqfw-esm-validator . --profile base` passed in both
  repositories with zero violations.
- `git diff --check` passed; DEM `package.json` and `package-lock.json` are
  unchanged.
- Final GitHub Actions run
  [41624667138](https://github.com/teqfw/dem/actions/runs/41624667138) passed:
  package jobs on Node 22 and 24, and the browser job using the pinned
  DEM-IDB tarball.

## Commits

- DEM-IDB: `de4dd7d9f0b8d57713711608d36b74fe805ddae1` — Enforce canonical DEM
  entity paths.
- DEM: `7f48128a52fff29b1472331e98b22ba314486ac1` — Add CI-only compatible
  DEM-IDB artifact preparation.
- DEM: `dea4efeb138a24447288112a0b7b1a2f02c4c7e4` — Pin the exact DEM-IDB source
  commit after the first Actions run exposed a SHA typo.

All three commits are pushed to their respective `main` branches. Existing
historical physical layouts remain unsupported; hosts must handle their data
before using the current adapter.
