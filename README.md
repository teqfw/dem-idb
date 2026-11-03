# @teqfw/dem-idb

IndexedDB persistence for [TeqFW DEM](https://github.com/teqfw/dem). Compile the same JSON declarations with DEM and select this adapter in a browser or DEM-RDB in Node.js. Application code uses DEM's repository methods and logical values in both environments.

DEM schema descriptors use Format 2. Format 1 schema descriptors are rejected by
design, with no legacy compatibility mode; this is an intentional breaking
contract. Host maps are separate and continue to use Format 1.

The adapter creates one object store per effective entity, native non-unique lookup indexes where possible, and versioned schema snapshots. It supports create/read/update/delete/list, primary and named unique keys (including composite keys), keyless entities, defaults, integer and UUID identity generation, and all DEM core logical value types. No additional production library or IndexedDB wrapper is required.

## Initialize a model

The browser host registers served ESM namespace roots for `TeqFw_Dem_` and `TeqFw_DemIdb_` in its TeqFW container before resolving components. Browser module delivery and composition belong to the host.

```js
const compiler = await container.get('TeqFw_Dem_Compile$');
const {model} = await compiler.exec({schemas: [{
    packageName: '@example/app',
    filename: 'dem-schema.json',
    document: {
        $format: 2,
        $namespace: '/app/',
        user: {attributes: [
            {name: 'id', type: {name: 'identity'}, generation: true},
            {name: 'name', type: {name: 'text'}},
        ]},
    },
}]});
const adapter = await container.get('TeqFw_DemIdb_Adapter$');
const backend = await adapter.open({model, name: 'example-app'});
await backend.createSchema(); // Explicit creation or model update; retains records.
const users = await backend.get({path: '/app/user'});
const {record} = await users.create({record: {name: 'Ada'}});
const key = {kind: 'primary', values: {id: record.id}};
await users.read({key});
await users.update({key, changes: {name: 'Ada Lovelace'}});
const {records} = await users.list({selection: {limit: 20}});
await users.delete({key});
await backend.close();
```

`open({model, name, indexedDB?, enforceRelations?})` configures a provider without creating a database. `indexedDB` defaults to the browser global. `get({path})` opens an existing compatible database; initialization is explicit. Methods return the DEM result envelopes and shared `DemRepositoryError` codes. `createSchema()` returns `{database, stores, version}` for host administration; direct writes through that raw connection bypass adapter checks.

For DI substitution, map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_DemIdb_Provider$` using a host preprocessor. Map `TeqFw_DemIdb_Api_Configuration$` to a host component whose asynchronous `get()` returns the adapter options. Initialize the schema separately through the adapter first. The provider opens lazily, caches its backend, and exposes `close()` for host shutdown. The default configuration fails with `UNSUPPORTED`.

## Compatibility and capabilities

Records use DEM normalization: exact integers, decimals and int identities are strings; dates/datetimes and UUIDs are canonical strings; binary is base64; JSON and vectors are detached JSON values. Generated integer identities use exact `BigInt` allocation and persistent counters; explicit identities advance the counter. UUID generation uses browser `crypto.randomUUID()`. Other generation policies reject as `UNSUPPORTED` before database access.

Primary/unique keys are checked in write transactions, allowing repeated nullable unique tuples. Relations are descriptive by default: missing targets are accepted. Set `enforceRelations: true` to check outgoing and incoming relations atomically within this database, with restrictive target updates/deletes. This mode requires that all existing related data is already consistent. It does not implement cascades or cross-database transactions. The adapter passes DEM's current repository conformance suite in this mode; the default mode intentionally provides partial semantic compatibility.

Selections support DEM boolean trees, all-core comparisons, explicit null tests,
exact ordering, deterministic tie-breakers and offset/limit. Binary compares decoded
bytes; dense/bit vectors compare numeric elements, sparse vectors conceptual values
with absent zero; JSON compares canonical serialization by Unicode scalar sequence.
This is deterministic representation order, not JSON numeric ordering or vector
similarity. Keyless structured records can be listed. Joins, projections, totals
and arbitrary predicates remain outside the DEM selection API.

Each operation uses a native transaction and reports a write result after commit. Writes validate data and constraints over full store scans; eligible key reads and single-attribute equality selections use native indexes; selection semantics are supplied by the shared DEM Repository/Select component; native index order is never used as logical numeric or Unicode order. All write transactions include the shared sequence store and are conservatively serialized within this database. This favors correctness and broad types over throughput. Other selection shapes and write validation still scan stores; there is no silent result cap. Multiple calls do not share a transaction. External writes and storage tampering are outside adapter guarantees.

## Schema history and updates

Each application object store is named exactly after its effective entity path (for example, `/app/user`). The reserved internal stores `/dem/schema` and `/dem/sequence` retain `{version, layout, model}` snapshots and integer allocation counters. Application models that place entities in `/dem` or its subtree are rejected before IndexedDB access. Entity records use private out-of-line auto-generated IndexedDB keys, independent of logical identities. Logical keys, declared indexes and relations are retained in the model. Valid native key paths get non-unique lookup indexes; native key restrictions do not prevent logical values from being stored or queried.

The adapter deliberately does not support historical physical layouts such as `dem:/...`, `dem_schema` or `dem_sequence`. It rejects such databases before an upgrade and leaves their stores and data unchanged. The host owns any required migration; this package does not rename, copy, convert or delete historical data.

`createSchema()` is idempotent for an unchanged model. A model change increments the database version and atomically updates stores, indexes and its snapshot in a version-change transaction. Removed entity stores and their data are retained. Old connections owned by this adapter close on `versionchange`; their providers must be replaced. Other connections may block upgrades, reported as `STORAGE`; a blocked attempt will not apply later after its promise has rejected. Do not run schema updates concurrently for the same database.

This is structural evolution, not automatic data migration. Added literal defaults and nullable values are applied when existing records are read. Removed attributes are omitted from logical results while raw stored values remain until a record is rewritten. Renames are new logical names; no rename or data conversion is inferred. Incompatible stored values fail as `STORAGE`. Newly declared keys and relations do not audit or rewrite existing data at schema-update time; subsequent writes check their applicable constraints. The host owns value migrations and backups. Initialization of incompatible pre-existing native stores fails without replacing them.

Browser quota, eviction, user clearing, unexpected closure, upgrade blocking and durability differ from RDBMS. Storage errors are reported as `STORAGE`. There is no automatic browser/server synchronization, replication or shared transaction. Tested in Chrome 156; Firefox, Safari and workers have not been verified.

## Development

Install dependencies before running checks. This release uses `@teqfw/dem` 0.3.x. Node.js runs the test harness; Chrome supplies real IndexedDB. Set `CHROME_PATH` if needed.

```sh
npm run verify
npm pack --dry-run
teqfw-platform .
teqfw-esm-validator . --profile base
```

`verify` runs Node unit checks, TypeScript checks and the browser suite. The browser suite runs the published DEM conformance cases against actual IndexedDB plus type, schema-history, concurrency, upgrade, rollback and DI integration scenarios. No persistence mock is used as browser conformance evidence.

The cognitive context is an independent private checkout at `ctx/`, excluded from npm. The package-owned consumer skill ships in `skills/teqfw-dem-idb/`.

## License

Apache-2.0.


The browser suite also runs `@teqfw/dem/conformance/values`, the shared all-type
workload. DEM-RDB's `test:compare` runner compares its complete observation
transcript with real SQL engines. Set `TEQFW_DEM_IDB_ROOT` to this checkout when
running that gate from DEM-RDB. Both adapters must use the same DEM version.


Native lookup planning checks the actual index key path and whether the literal is
an IndexedDB key. Non-keyable values (such as booleans or JSON objects) fall back
to scanning. Schema snapshots retain native-lookup coverage: adding defaults or
changing attributes disables lookup narrowing for affected old records, preventing
misses when logical values are projected on read. Index-only schema changes retain
coverage. New stores start with complete coverage. Sorting and pagination always
use logical DEM semantics after candidate lookup.

## Atomic command batches and history

backend.execute({operations:[{path,method,params}]}) executes nonempty ordered
create/read/update/delete/list commands in one native data transaction. It returns
{results} in command order only after commit; any failure aborts all effects and
sequence updates. Keys for dependent commands must be explicit. No async callbacks,
schema commands or generated-result references are supported. The host can map
`TeqFw_Dem_Api_RepositoryBatch$` to the same `TeqFw_DemIdb_Provider$` instance used
for RepositoryProvider. Bulk operations use batches of ordinary commands.

backend.getSchemaHistory() returns {schemas:[{version,model}]} with complete applied
model snapshots. JSON/vector negative zero normalizes to zero; nested sparse inputs
are detached. Valid Unicode scalar strings including NUL are preserved; lone UTF16
surrogates fail DEM validation.

## Unchanged application verification

`test/browser/application/Browser.mjs` is a minimal Composition Root for DEM's
published task-triage Workflow. It compiles the shared Schema source, registers
namespace/preprocessor mappings, initializes real IDB and resolves Demo_Workflow$.
All application operations remain in the same DEM module used by the SQLite root.
The root closes providers/connections and deletes its isolated database in finally.

```sh
DEM_BROWSER_SCENARIO=application npm run test:browser
# Optionally retain the envelope with DEM_COMPARE_OUTPUT=/tmp/application-idb.json.
```

The normal browser suite also executes this workflow. DEM-RDB's test:application
compares application source hashes, models/fingerprints and complete results; its
README owns the cross-package setup/commands. Both packages must resolve the current
DEM application exports. This test uses native ESM delivery and real Chrome, without
DI test substitutions or repository mocks. Browser setup APIs remain confined to
this root, while Workflow injects only the portable provider and Selection contracts.
