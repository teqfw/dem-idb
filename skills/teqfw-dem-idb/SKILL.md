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
The adapter's structural snapshots are separate from DEM-owned history, which it
does not yet implement; models containing those history entities are rejected.

Host composition may map `TeqFw_Dem_Api_RepositoryProvider$` to `TeqFw_Dem_IDb_Provider$` and the configuration contract to a host component returning adapter options. Business components use DEM repositories. Close the backend/provider at host shutdown and replace providers invalidated by schema upgrades.

Relations are descriptive by default; `enforceRelations:true` enables same-database atomic integrity checks. Eligible Core key/equality reads use native indexes with coverage-safe fallback; extension-type lookups scan; other
selections and logical write checks scan records. Keep these differences and browser storage lifecycle visible when comparing with RDB. Structural schema updates preserve stores and snapshots but do not infer data conversions or audit historical constraints. The host owns migrations, backup and synchronization. Verify real browser behavior before claiming support for additional runtimes.


Selection evaluation is shared with RDB through DEM Repository/Select. The browser
suite runs the shared all-type workload against IndexedDB. Its observations cover
the exercised actions, not every possible value, operation or SQL engine.


Map the optional `TeqFw_Dem_Api_RepositoryBatch$` token to the same configured
Provider for atomic ordered CRUD/list command batches. Results publish after one
commit; any command failure rolls back. Use explicit dependent keys. Inspect
getSchemaHistory through the adapter backend and replace stale providers after
structural upgrades. All-core comparisons and keyless ordering follow DEM, including
byte ordering, numeric vector lexicographic order and canonical JSON representation
order. Async callbacks and schema commands are outside atomic data batches.


## Native CryptoKey integration

Follow the README's executable composition example: register
`TeqFw_Dem_IDb_Type_CryptoKey_Provider$` before finalizing the host Registry and
compiling; bind `TeqFw_Dem_IDb_Type_CryptoKey_Handler$` with DEM Runtime to that
model; pass `runtime` to `Adapter.open` or Provider configuration. Core-only models
need no binding. Extension models require a binding with the same canonical model
identity; a mismatch is `INVALID_INPUT`. The host owns Runtime and closes the shared
backend. Repository and Batch use handler-defined logical Equality; extension-type
lookups scan when native index narrowing would be unsafe.

With a configured browser container and registered namespace roots:

```js
const registry = await container.get('TeqFw_Dem_Registry$');
const provider = await container.get('TeqFw_Dem_IDb_Type_CryptoKey_Provider$');
registry.register(provider.getDefinitions());
registry.finalize();

const compiler = await container.get('TeqFw_Dem_Compile$');
const {model} = await compiler.exec({schemas: [{
    packageName: '@example/app', filename: 'keys.json',
    document: {$format: 2, $namespace: '/app/', credential: {
        attributes: [
            {name: 'id', type: {name: 'text'}},
            {name: 'key', type: {name: 'idb.CryptoKey'}},
        ],
        primaryKey: ['id'],
    }},
}]});
const handler = await container.get('TeqFw_Dem_IDb_Type_CryptoKey_Handler$');
const runtime = (await container.get('TeqFw_Dem_Repository_Runtime$'))
    .bind({model, registry, handlers: [handler]});
const adapter = await container.get('TeqFw_Dem_IDb_Adapter$');
const backend = await adapter.open({model, name: 'example-keys', runtime});
try {
    await backend.createSchema();
    const credentials = await backend.get({path: '/app/credential'});
    const key = await crypto.subtle.generateKey(
        {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
    await credentials.create({record: {id: 'signing-key', key}});
    const {record} = await credentials.read({
        key: {kind: 'primary', values: {id: 'signing-key'}},
    });
    // record.key is a native CryptoKey usable with Web Crypto.
} finally {
    await backend.close();
}
```

`idb.CryptoKey` validates native keys and copies and stores them with structured
clone. It has no Equality, Ordering, Literal, Default or Generation and cannot be a
primary/unique key, index, relation or comparison operand. Applications own algorithm,
usage and extractability policy. Missing capabilities or binding are `UNSUPPORTED`,
invalid input `INVALID_INPUT`, and clone/storage failures `STORAGE`. Omitted native
values survive updates, including CryptoKey-only replacements. Atomic batches return
results after commit and roll back effects and sequence updates on failure. Use DEM
repositories for application access. Verification covers real Chrome; Firefox,
Safari and workers remain unverified.
