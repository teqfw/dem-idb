# @teqfw/dem-idb

IndexedDB persistence for [TeqFW DEM](https://github.com/teqfw/dem). Compile the same JSON declarations with DEM and select this adapter in a browser or DEM-RDB in Node.js. Application code uses DEM's repository methods and logical values in both environments.

The adapter creates one object store per effective entity, native non-unique lookup indexes where possible, and versioned schema snapshots. It supports create/read/update/delete/list, primary and named unique keys (including composite keys), keyless entities, defaults, integer and UUID identity generation, and all DEM core logical value types. No additional production library or IndexedDB wrapper is required.

## Initialize a model

The browser host registers served ESM namespace roots for `TeqFw_Dem_` and `TeqFw_DemIdb_` in its TeqFW container before resolving components. Browser module delivery and composition belong to the host.

```js
const compiler = await container.get('TeqFw_Dem_Compile$');
const {model} = await compiler.exec({schemas: [{
    packageName: '@example/app',
    filename: 'dem-schema.json',
    document: {
        $format: 1,
        '/app/user': {attributes: [
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

Selections support DEM boolean trees, scalar comparisons, explicit null tests, type-aware exact ordering, Unicode scalar string order, deterministic tie-breakers and offset/limit. Omitted/null limit is unbounded; zero limit is empty. DEM does not support binary/JSON/vector comparisons or ordering, joins, projections, totals or arbitrary predicates. Such data can still be stored and read; listing requires an orderable primary/unique key if the entity includes non-orderable attributes.

Each operation uses a native transaction and reports a write result after commit. Data and constraints are evaluated in JavaScript over full store scans; native index order is never used as logical numeric or Unicode order. All write transactions include the shared sequence store and are conservatively serialized within this database. This favors correctness and broad types over throughput. Large datasets require a future query planner or more selective access; there is no silent result cap. Multiple calls do not share a transaction. External writes and storage tampering are outside adapter guarantees.

## Schema history and updates

`dem_schema` retains `{version, layout, model}` snapshots; `dem_sequence` retains integer allocation counters. Entity store names are `dem:` followed by the canonical entity path. Entity records use private out-of-line auto-generated IndexedDB keys, independent of logical identities. Logical keys, declared indexes and relations are retained in the model. Valid native key paths get non-unique lookup indexes; native key restrictions do not prevent logical values from being stored or queried.

`createSchema()` is idempotent for an unchanged model. A model change increments the database version and atomically updates stores, indexes and its snapshot in a version-change transaction. Removed entity stores and their data are retained. Old connections owned by this adapter close on `versionchange`; their providers must be replaced. Other connections may block upgrades, reported as `STORAGE`; a blocked attempt will not apply later after its promise has rejected. Do not run schema updates concurrently for the same database.

This is structural evolution, not automatic data migration. Added literal defaults and nullable values are applied when existing records are read. Removed attributes are omitted from logical results while raw stored values remain until a record is rewritten. Renames are new logical names; no rename or data conversion is inferred. Incompatible stored values fail as `STORAGE`. Newly declared keys and relations do not audit or rewrite existing data at schema-update time; subsequent writes check their applicable constraints. The host owns value migrations and backups. Initialization of incompatible pre-existing native stores fails without replacing them.

Browser quota, eviction, user clearing, unexpected closure, upgrade blocking and durability differ from RDBMS. Storage errors are reported as `STORAGE`. There is no automatic browser/server synchronization, replication or shared transaction. Tested in Chrome 156; Firefox, Safari and workers have not been verified.

## Development

Install dependencies before running checks. Until `@teqfw/dem` 0.2.x is published, install a local DEM archive or use a workspace. Node.js runs the test harness; Chrome supplies real IndexedDB. Set `CHROME_PATH` if needed.

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
