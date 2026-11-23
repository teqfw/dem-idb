// @ts-check
/**
 * @namespace TeqFw_Dem_IDb_Adapter
 * @description IndexedDB model projection, schema history and DEM repository execution.
 */
export default class Adapter {
    /**
     * @param {object} deps
     * @param {any} deps.errors
     * @param {any} deps.normalize
     * @param {any} deps.selection
     * @param {any} deps.evaluate
     * @param {any} deps.batch
     * @param {any} deps.demCanonical
     * @param {any} deps.fingerprint
     */
    constructor({errors, normalize, selection, evaluate, batch, demCanonical, fingerprint}) {
        /**
         * @param {any} code
         * @param {any} message
         * @returns {any}
         */
        const fail = function (code, message) { throw errors.create({code, message}); };
        /**
         * @param {any} error
         * @returns {any}
         */
        const mapped = function (error) {
            if (error?.name === 'DemRepositoryError') return error;
            return errors.create({code: error?.name === 'ConstraintError' ? 'CONFLICT' : 'STORAGE', message: 'IndexedDB operation failed: ' + String(error?.message ?? error)});
        };
        /**
         * @param {any} arg
         * @param {string[]} fields
         * @returns {void}
         */
        const shape = function (arg, fields) {
            if (!arg || typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).length !== fields.length || fields.some(k => !Object.hasOwn(arg, k))) fail('INVALID_INPUT', 'Invalid operation parameters.');
        };
        /**
         * @param {any} value
         * @returns {string}
         */
        const canonical = function (value) {
            return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
        };
        /**
         * @param {unknown} path
         * @returns {boolean}
         */
        const isCanonicalPath = function (path) {
            return typeof path === 'string' && /^\/[a-z][a-z0-9]*(?:\/[a-z][a-z0-9]*)*$/.test(path);
        };

        /**
         * Inspect the selected IndexedDB database without creating or modifying it.
         * @param {any} input
         * @returns {Promise<any>}
         */
        this.inspectStorage = async function (input = {}) {
            if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['name', 'indexedDB', 'expectedModel'].includes(key)))
                fail('INVALID_INPUT', 'Invalid storage inspection parameters.');
            const {name, indexedDB = globalThis.indexedDB, expectedModel} = input;
            if (typeof name !== 'string' || !name) fail('INVALID_INPUT', 'A nonempty database name is required.');
            /** @type {any} */
            let expected;
            if (expectedModel !== undefined) {
                try {
                    expected = JSON.parse(JSON.stringify(expectedModel));
                    validateModel(expected);
                } catch (error) {
                    if (/** @type {any} */ (error)?.name === 'DemRepositoryError') throw error;
                    fail('INVALID_INPUT', 'The expected model is not a valid Effective DEM.');
                }
            }
            if (!indexedDB || typeof indexedDB.databases !== 'function' || typeof indexedDB.open !== 'function')
                fail('UNSUPPORTED', 'Storage inspection requires IDBFactory.databases() and open().');

            const deadlineMs = 10000;
            let phase = 'inventory';
            let settled = false;
            /** @type {IDBDatabase|undefined} */
            let database;
            /** @type {IDBTransaction|undefined} */
            let transaction;
            /** @type {ReturnType<typeof setTimeout>|undefined} */
            let timer;
            return new Promise((resolve, reject) => {
                /** @returns {void} */
                const close = () => { try { database?.close(); } catch {} database = undefined; };
                /** @param {any} error @param {any} [value] @returns {void} */
                const finish = (error, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    close();
                    if (error) reject(error); else resolve(value);
                };
                /** @param {string} message @returns {any} */
                const storageFailure = message => errors.create({code: 'STORAGE', message: `Storage inspection ${phase} failed: ${message}`});
                /** @param {string} message @returns {void} */
                const abort = message => {
                    try { transaction?.abort(); } catch {}
                    finish(storageFailure(message));
                };
                timer = setTimeout(() => abort('operation deadline exceeded.'), deadlineMs);

                /** @type {any[]|undefined} */
                let inventory;
                try {
                    const request = indexedDB.databases();
                    Promise.resolve(request).then(entries => {
                        if (settled) return;
                        if (!Array.isArray(entries)) { finish(storageFailure('database inventory was malformed.')); return; }
                        inventory = entries.filter(entry => entry?.name === name);
                        if (!inventory.length) { finish(null, {kind: 'absent'}); return; }
                        const entry = inventory[0];
                        if (inventory.length !== 1 || !Number.isSafeInteger(entry?.version) || entry.version < 1) {
                            finish(storageFailure('database inventory was ambiguous or lacked a valid version.'));
                            return;
                        }
                        phase = 'open';
                        let request;
                        try { request = indexedDB.open(name); }
                        catch (error) { finish(storageFailure(String(/** @type {any} */ (error)?.message ?? error))); return; }
                        request.onupgradeneeded = () => {
                            try { request.transaction?.abort(); } catch {}
                            finish(storageFailure('database changed after inventory and an implicit upgrade was prevented.'));
                        };
                        request.onblocked = () => finish(storageFailure('database open was blocked.'));
                        request.onerror = () => finish(storageFailure(String(request.error?.message ?? 'database open failed.')));
                        request.onsuccess = () => {
                            const db = request.result;
                            if (settled) { try { db.close(); } catch {} return; }
                            database = db;
                            if (db.version !== entry.version) { finish(storageFailure('database version changed after inventory.')); return; }
                            phase = 'read';
                            db.onversionchange = () => abort('database version changed during observation.');
                            db.onclose = () => { if (!settled) abort('database connection closed during observation.'); };
                            observe(db);
                        };
                    }, error => finish(storageFailure(String(error?.message ?? error))));
                } catch (error) { finish(storageFailure(String(/** @type {any} */ (error)?.message ?? error))); }

                /** @param {IDBDatabase} db */
                const observe = db => {
                    try {
                        const names = Array.from(db.objectStoreNames);
                        const schemaName = '/dem/schema', sequenceName = '/dem/sequence';
                        if (names.some(name => name.startsWith('dem:/') || name === 'dem_schema' || name === 'dem_sequence')) {
                            finish(errors.create({code: 'UNSUPPORTED', message: 'Storage inspection found an obsolete DEM-IDB layout.'}));
                            return;
                        }
                        if (!names.includes(schemaName) || !names.includes(sequenceName)) {
                            finish(errors.create({code: 'UNSUPPORTED', message: 'Storage is not a recognized DEM-IDB database.'}));
                            return;
                        }
                        transaction = db.transaction(names, 'readonly');
                        const readTransaction = transaction;
                        let historyRequest, sequenceRequest, sequenceKeysRequest;
                        const storeDefinitions = Object.create(null);
                        try {
                            const schemaStore = readTransaction.objectStore(schemaName);
                            const sequenceStore = readTransaction.objectStore(sequenceName);
                            validateMetaStore(schemaStore, 'schema');
                            validateMetaStore(sequenceStore, 'sequence');
                            historyRequest = schemaStore.getAll();
                            sequenceRequest = sequenceStore.getAll();
                            sequenceKeysRequest = sequenceStore.getAllKeys();
                            for (const name of names) if (name !== schemaName && name !== sequenceName) {
                                const store = readTransaction.objectStore(name);
                                storeDefinitions[name] = {
                                    keyPath: store.keyPath,
                                    autoIncrement: store.autoIncrement,
                                    indexes: Array.from(store.indexNames, indexName => {
                                        const index = store.index(indexName);
                                        return {name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry};
                                    }),
                                };
                            }
                        } catch (error) { abort(String(/** @type {any} */ (error)?.message ?? error)); return; }
                        readTransaction.onabort = () => finish(storageFailure(String(readTransaction.error?.message ?? 'read transaction aborted.')));
                        readTransaction.onerror = () => {};
                        readTransaction.oncomplete = () => {
                            try {
                                const {schemas, snapshots} = validateHistory(historyRequest.result, db.version, names);
                                const model = schemas.at(-1).model;
                                validatePhysicalLayout(snapshots, model, names, storeDefinitions, sequenceKeysRequest.result, sequenceRequest.result);
                                const logicalCanonical = demCanonical.exec(model);
                                const logicalFingerprint = fingerprint.exec({value: logicalCanonical});
                                const matchesExpected = expected === undefined ? null : sameModel(model, expected);
                                finish(null, {kind: 'existing', version: db.version, model, fingerprint: logicalFingerprint, schemas, matchesExpected});
                            } catch (error) {
                                if (/** @type {any} */ (error)?.name === 'DemRepositoryError') finish(error);
                                else finish(storageFailure(String(/** @type {any} */ (error)?.message ?? error)));
                            }
                        };
                    } catch (error) { finish(storageFailure(String(/** @type {any} */ (error)?.message ?? error))); }
                };
            });
        };

        /** @param {any} left @param {any} right @returns {boolean} */
        const sameModel = (left, right) => canonical(left) === canonical(right);

        /** @param {any} model */
        const validateModel = model => {
            /** @param {string} message @returns {void} */
            const invalid = message => { throw new TypeError(message); };
            if (!jsonValue(model) || !plain(model) || !plain(model.entities) || !Object.keys(model.entities).length || !Object.hasOwn(model, 'packages')) invalid('entities');
            if (!Array.isArray(model.packages) || model.packages.some(/** @type {(path: any) => boolean} */ (path => typeof path !== 'string' || !/^\/(?:[a-z][a-z0-9]*\/)*$/.test(path))) || new Set(model.packages).size !== model.packages.length) invalid('packages');
            const paths = /** @type {string[]} */ (Object.keys(model.entities));
            if (paths.some(path => !isCanonicalPath(path) || path === '/dem' || path.startsWith('/dem/'))) invalid('entity path');
            const relationMembers = new Set();
            for (const [path, entity] of Object.entries(model.entities)) {
                if (!plain(entity) || !Array.isArray(entity.attributes) || !plain(entity.uniqueKeys) || !plain(entity.indexes) || !plain(entity.relations)) invalid('entity');
                if (entity.primaryKey !== null && (!Array.isArray(entity.primaryKey) || !entity.primaryKey.length)) invalid('primary key');
                const attributes = /** @type {any[]} */ (entity.attributes).map(/** @type {(attribute: any) => any} */ (attribute => attribute?.name));
                if (attributes.some(name => typeof name !== 'string' || !/^[a-z0-9_]+$/.test(name)) || new Set(attributes).size !== attributes.length) invalid('attributes');
                for (const attribute of entity.attributes) {
                    if (!plain(attribute) || typeof attribute.nullable !== 'boolean' || !plain(attribute.type) || typeof attribute.type.name !== 'string' || !attribute.type.name) invalid('type');
                    if (attribute.type.params !== undefined && !plain(attribute.type.params)) invalid('type parameters');
                    if (attribute.type.profile !== undefined && (!plain(attribute.type.profile) || !['uuid', 'int'].includes(attribute.type.profile.type))) invalid('type profile');
                    if (attribute.generation !== undefined && typeof attribute.generation !== 'boolean') invalid('generation');
                    if (attribute.generation && attribute.type.name !== 'identity') invalid('generation');
                }
                /** @param {any} names @returns {boolean} */
                const has = names => Array.isArray(names) && names.length > 0 && names.every(name => attributes.includes(name)) && new Set(names).size === names.length;
                if (Array.isArray(entity.primaryKey) && !has(entity.primaryKey)) invalid('primary key');
                for (const [keyName, key] of Object.entries(entity.uniqueKeys)) if (!keyName || !has(key)) invalid('unique key');
                for (const [indexName, index] of Object.entries(entity.indexes)) if (!indexName || !plain(index) || !has(index.attributes)) invalid('index');
                for (const [relationName, relation] of Object.entries(entity.relations)) {
                    if (!relationName || !plain(relation) || !has(relation.attributes) || !plain(relation.target) || !paths.includes(relation.target.path)) invalid('relation');
                    const target = model.entities[relation.target.path];
                    if (!Array.isArray(relation.target.attributes) || relation.target.attributes.length !== relation.attributes.length || relation.target.attributes.some(/** @type {(name: any) => boolean} */ (name => target.attributes.some(/** @type {(attribute: any) => boolean} */ (attribute => attribute.name === name))))) invalid('relation target');
                    for (const name of relation.attributes) relationMembers.add(path + '\0' + name);
                    for (const name of relation.target.attributes) relationMembers.add(relation.target.path + '\0' + name);
                }
            }
            for (const [path, entity] of Object.entries(model.entities)) for (const attribute of entity.attributes) {
                if (attribute.type.name === 'idb.CryptoKey' && (attribute.generation || [...(entity.primaryKey ?? []), ...Object.values(entity.uniqueKeys ?? {}).flat(), ...Object.values(entity.indexes ?? {}).flatMap(index => index.attributes ?? [])].includes(attribute.name) || relationMembers.has(path + '\0' + attribute.name))) invalid('CryptoKey projection');
            }
        };

        /** @param {any} value @param {any} [seen] @returns {boolean} */
        const jsonValue = (value, seen = new Set()) => {
            if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
            if (typeof value === 'number') return Number.isFinite(value);
            if (typeof value !== 'object' || seen.has(value)) return false;
            if (!Array.isArray(value) && !plain(value)) return false;
            seen.add(value);
            const values = Array.isArray(value) ? value : Object.values(value);
            const valid = values.every(item => jsonValue(item, seen));
            seen.delete(value);
            return valid;
        };

        /** @param {any} value @returns {boolean} */
        const plain = value => value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

        /** @param {any} store @param {string} kind */
        const validateMetaStore = (store, kind) => {
            if (store.keyPath !== (kind === 'schema' ? 'version' : null) || store.autoIncrement || store.indexNames.length)
                throw new TypeError(`invalid ${kind} store definition`);
        };

        /** @param {any} rows @param {any} currentVersion @param {any} names @returns {any} */
        const validateHistory = (rows, currentVersion, names) => {
            if (!Array.isArray(rows) || !rows.length) throw new TypeError('schema history is empty');
            const schemas = rows.map(row => {
                if (!plain(row) || !Number.isSafeInteger(row.version) || row.version < 1 || !Object.hasOwn(row, 'layout')) throw new TypeError('invalid schema snapshot');
                if (row.layout !== 2) throw errors.create({code: 'UNSUPPORTED', message: 'Storage inspection found an unsupported schema layout.'});
                validateModel(row.model);
                const coverage = row.nativeLookup;
                if (!plain(coverage) || Object.keys(coverage).some(path => !Object.hasOwn(row.model.entities, path)) || Object.entries(row.model.entities).some(([path]) => typeof coverage[path] !== 'boolean')) throw new TypeError('invalid native lookup metadata');
                return {version: row.version, model: row.model, nativeLookup: coverage};
            }).sort((a, b) => a.version - b.version);
            if (new Set(schemas.map(row => row.version)).size !== schemas.length || schemas[schemas.length - 1].version !== currentVersion) throw new TypeError('history range does not match database version');
            for (let i = 1; i < schemas.length; i++) {
                if (schemas[i].version !== schemas[i - 1].version + 1) throw new TypeError('schema history contains a gap');
                const previous = schemas[i - 1];
                for (const [path, covered] of Object.entries(schemas[i].nativeLookup)) {
                    if (!covered) continue;
                    const before = previous.model.entities[path];
                    const after = schemas[i].model.entities[path];
                    if (before && !(previous.nativeLookup[path] && canonical(before.attributes) === canonical(after.attributes))) throw new TypeError('native lookup coverage is inconsistent');
                    if (!before && covered && schemas.slice(0, i).some(row => Object.hasOwn(row.model.entities, path))) throw new TypeError('retained store regained native lookup coverage');
                }
            }
            const allEntities = new Set(schemas.flatMap(row => Object.keys(row.model.entities)));
            const expectedStores = new Set(['/dem/schema', '/dem/sequence', ...allEntities]);
            if (names.some(/** @type {(name: string) => boolean} */ (name => !expectedStores.has(name)))) throw errors.create({code: 'UNSUPPORTED', message: 'Storage contains an unexplained object store.'});
            if ([...expectedStores].some(name => !names.includes(name))) throw new TypeError('physical store set does not match recorded source history');
            return {snapshots: schemas, schemas: schemas.map(({version, model}) => ({version, model}))};
        };

        /** @param {any} snapshots @param {any} currentModel @param {any} names @param {any} storeDefinitions @param {any} counterKeys @param {any} counters @returns {void} */
        const validatePhysicalLayout = (snapshots, currentModel, names, storeDefinitions, counterKeys, counters) => {
            const sequenceStore = '/dem/sequence';
            const retained = new Set(snapshots.flatMap(/** @type {(row: any) => string[]} */ (row => Object.keys(row.model.entities))));
            for (const name of names.filter(/** @type {(name: string) => boolean} */ (name => name !== '/dem/schema' && name !== sequenceStore))) {
                const containing = [...snapshots].reverse().find(/** @type {(row: any) => boolean} */ (row => Object.hasOwn(row.model.entities, name)));
                const definition = storeDefinitions[name];
                if (!containing || !definition || definition.keyPath !== null || !definition.autoIncrement) throw new TypeError('invalid entity store definition');
                const entity = containing.model.entities[name];
                const indexEntries = /** @type {any[][]} */ ([
                    ...(entity.primaryKey?.length ? [['primary', entity.primaryKey]] : []),
                    ...Object.entries(entity.uniqueKeys ?? {}).map(([key, attributes]) => ['unique:' + key, attributes]),
                    ...Object.entries(entity.indexes ?? {}).map(([key, index]) => ['index:' + key, index.attributes]),
                ]);
                const expectedEntries = indexEntries.filter((entry) => /** @type {any[]} */ (entry[1]).every((/** @type {any} */ attribute) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attribute)));
                const expected = Object.fromEntries(expectedEntries);
                if (definition.indexes.length !== Object.keys(expected).length) throw new TypeError('entity indexes do not match source projection');
                for (const index of definition.indexes) {
                    const attributes = expected[index.name];
                    if (!attributes || canonical(index.keyPath) !== canonical(attributes) || index.unique || index.multiEntry) throw new TypeError('entity index does not match source projection');
                }
            }
            if (!Array.isArray(counters) || !Array.isArray(counterKeys) || counters.length !== counterKeys.length) throw new TypeError('invalid counters');
            for (let i = 0; i < counters.length; i++) {
                const key = counterKeys[i], value = counters[i];
                if (typeof key !== 'string' || !retained.has(key) || typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError('invalid sequence entry');
            }
            for (const entity of Object.values(currentModel.entities)) {
                for (const attribute of entity.attributes) if (attribute.generation && attribute.type.name !== 'identity') throw new TypeError('unsupported generation policy');
            }
        };
        /**
         * @param {object} deps
         * @param {any} deps.model
         * @param {string} deps.name
         * @param {any} [deps.indexedDB]
         * @param {boolean} [deps.enforceRelations]
         * @param {any} [deps.runtime]
         * @returns {Promise<any>}
         */
        this.open = async function ({model, name, indexedDB = globalThis.indexedDB, enforceRelations = true, runtime}) {
            if (!model?.entities || typeof name !== 'string' || !name) fail('INVALID_INPUT', 'A compiled DEM model and database name are required.');
            if (typeof enforceRelations !== 'boolean') fail('INVALID_INPUT', 'enforceRelations must be boolean.');
            const snapshot = /** @type {any} */ (JSON.parse(JSON.stringify(model)));
            const hasRelations=Object.values(snapshot.entities).some(entity=>Object.values(entity.relations ?? {}).length>0);
            if (!enforceRelations && hasRelations) fail('UNSUPPORTED','DEM relation actions cannot be disabled for a model with relations.');
            const identity = canonical(snapshot);
            const hasCryptoKey=Object.values(snapshot.entities).some(/** @type {(entity: any) => boolean} */ (entity => entity.attributes.some(/** @type {(a: any) => boolean} */ (a => a.type.name==='idb.CryptoKey'))));
            if (!indexedDB && hasCryptoKey) fail('UNSUPPORTED','IndexedDB is required for CryptoKey persistence.');
            if (!indexedDB) fail('INVALID_INPUT','An IndexedDB factory is required.');
            const hasExtensions=Object.values(snapshot.entities).some(/** @type {(entity: any) => boolean} */ (entity => entity.attributes.some(/** @type {(a: any) => boolean} */ (a => a.type.name.includes('.')))));
            if (hasExtensions && !runtime) fail('UNSUPPORTED','A model-scoped DEM Runtime is required for extension types.');
            if (runtime && canonical(runtime.model)!==identity) fail('INVALID_INPUT','The DEM Runtime is bound to a different Effective DEM.');
            const norm=runtime?.normalize ?? normalize;
            const selectFactory=runtime?.selection ?? selection;
            const selectExec=runtime?.select ?? evaluate;
            const batchExec=runtime?.batch ?? batch;
            if (hasCryptoKey) {
                if (typeof globalThis.CryptoKey!=='function' || typeof globalThis.structuredClone!=='function' || !indexedDB) fail('UNSUPPORTED','CryptoKey, structuredClone and IndexedDB are required.');
            }
            const paths = Object.keys(snapshot.entities);
            for (const [entityPath, entity] of Object.entries(snapshot.entities)) {
                const keys=[...(entity.primaryKey ?? []),...Object.values(entity.uniqueKeys ?? {}).flat()];
                const relationMembers=[...Object.values(entity.relations ?? {}).flatMap(relation=>relation.attributes),
                    ...Object.entries(snapshot.entities).flatMap(([sourcePath,source])=>Object.values(source.relations ?? {}).filter(relation=>relation.target.path===entityPath).flatMap(relation=>relation.target.attributes))];
                for (const attribute of entity.attributes) if (attribute.type.name==='idb.CryptoKey'
                    && (keys.includes(attribute.name) || relationMembers.includes(attribute.name)
                        || Object.values(entity.indexes ?? {}).some(index=>index.attributes.includes(attribute.name))))
                    fail('INVALID_INPUT','CryptoKey attributes cannot be keys, indexes or relations.');
            }
            if (paths.some(path => !isCanonicalPath(path))) {
                fail('INVALID_INPUT', 'The model contains a non-canonical effective entity path.');
            }
            if (paths.some(path => path === '/dem' || path.startsWith('/dem/'))) {
                fail('INVALID_INPUT', 'The /dem namespace is reserved for adapter state.');
            }
            const stores = Object.fromEntries(paths.map(path => [path, path]));
            const schemaStore = '/dem/schema';
            const sequenceStore = '/dem/sequence';
            /**
             * @param {any} db
             * @returns {void}
             */
            const rejectLegacyLayout = function (db) {
                const names = Array.from(db.objectStoreNames);
                if (names.some(name => name.startsWith('dem:/')) || names.includes('dem_schema') || names.includes('dem_sequence')) {
                    fail('UNSUPPORTED', 'The database uses an obsolete DEM-IDB physical layout. The host must migrate its data explicitly.');
                }
            };
            for (const entity of Object.values(snapshot.entities)) {
                for (const a of entity.attributes) if (a.generation && a.type.name !== 'identity') fail('UNSUPPORTED', 'Generation is supported only for identity attributes.');
            }
            /** @type {IDBDatabase|undefined} */
            let database;
            /** @type {Promise<void>|undefined} */
            let pending;
            let closed = false;
            /**
             * @param {any} version
             * @param {any} initialize
             * @returns {Promise<any>}
             */
            const connect = function (version, initialize) {
                return new Promise((resolve, reject) => {
                    const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
                    let rejected = false;
                    /** @type {any} */
                    let cause;
                    request.onblocked = () => { rejected = true; reject(errors.create({code:'STORAGE',message:'Database upgrade is blocked by another connection.'})); };
                    request.onerror = () => reject(cause ?? mapped(request.error));
                    request.onupgradeneeded = /** @type {(event: IDBVersionChangeEvent) => void} */ (event => {
                        const tx = request.transaction, db = request.result;
                        try {
                            if (rejected || !initialize) fail('UNSUPPORTED', 'Initialize the database explicitly with createSchema().');
                            rejectLegacyLayout(db);
                            if (!db.objectStoreNames.contains(schemaStore)) db.createObjectStore(schemaStore, {keyPath:'version'});
                            if (!db.objectStoreNames.contains(sequenceStore)) db.createObjectStore(sequenceStore);
                            const existed=new Set(Array.from(db.objectStoreNames));
                            for (const path of paths) {
                                const store = db.objectStoreNames.contains(stores[path]) ? tx.objectStore(stores[path]) : db.createObjectStore(stores[path], {autoIncrement:true});
                                if (store.keyPath !== null || !store.autoIncrement) fail('UNSUPPORTED', 'Incompatible entity store.');
                                const entity = snapshot.entities[path];
                                const indexes = Object.fromEntries([
                                    ...(entity.primaryKey?.length ? [['primary',entity.primaryKey]] : []),
                                    ...Object.entries(entity.uniqueKeys).map(([key,attrs]) => ['unique:' + key, attrs]),
                                    ...Object.entries(entity.indexes).map(([key,index]) => ['index:' + key, index.attributes]),
                                ]);
                                // Native indexes are optional lookup aids. Repository evaluation does not rely on key codecs.
                                for (const key of Array.from(store.indexNames)) store.deleteIndex(key);
                                for (const [key, attrs] of Object.entries(indexes)) {
                                    if (attrs.every((/** @type {any} */ attr) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attr))) store.createIndex(key, attrs, {unique:false});
                                }
                            }
                            const history=tx.objectStore(schemaStore);
                            const previous=history.get(event.oldVersion);
                            previous.onsuccess=()=>{
                                const before=previous.result;
                                const nativeLookup=Object.fromEntries(paths.map(path=>[path,!existed.has(stores[path]) || Boolean(before?.layout===2 && (before.nativeLookup?.[path] ?? event.oldVersion===1) && canonical(before.model.entities[path]?.attributes)===canonical(snapshot.entities[path].attributes))]));
                                history.put({version:db.version,layout:2,model:snapshot,nativeLookup});
                            };
                        } catch (error) { cause = mapped(error); tx.abort(); }
                    });
                    request.onsuccess = () => {
                        const db = request.result;
                        if (rejected) { db.close(); return; }
                        db.onversionchange = () => { db.close(); if (database === db) closed = true; };
                        resolve(db);
                    };
                });
            };
            /**
             * @param {any} db
             * @returns {Promise<any>}
             */
            const compatible = function (db) {
                return new Promise((resolve, reject) => {
                    rejectLegacyLayout(db);
                    if (!db.objectStoreNames.contains(schemaStore) || !db.objectStoreNames.contains(sequenceStore) || paths.some(p => !db.objectStoreNames.contains(stores[p]))) { resolve(false); return; }
                    const tx = db.transaction([schemaStore, ...paths.map(p => stores[p])], 'readonly');
                    const request = tx.objectStore(schemaStore).get(db.version);
                    const layout = paths.every(p => { const store = tx.objectStore(stores[p]); return store.keyPath === null && store.autoIncrement; });
                    tx.oncomplete = () => resolve(layout && request.result?.layout === 2 && canonical(request.result.model) === identity);
                    tx.onabort = () => reject(mapped(tx.error));
                });
            };
            /**
             * @returns {Promise<void>}
             */
            const initialize = async function () {
                if (database) database.close();
                const db = await connect(undefined, true);
                try {
                    if (await compatible(db)) { database = db; return; }
                    const version = db.version + 1;
                    db.close();
                    database = await connect(version, true);
                } catch (error) { db.close(); throw error; }
            };
            /**
             * @returns {Promise<any>}
             */
            const ensure = async function () {
                if (closed) fail('STORAGE', 'Provider is closed or invalidated by a schema change. Reconfigure the host provider.');
                if (pending) await pending;
                if (!database) {
                    pending = (async () => {
                        const db = await connect(undefined, false);
                        try { if (!await compatible(db)) fail('UNSUPPORTED', 'Stored schema differs from the model. Call createSchema() explicitly.'); database = db; }
                        catch (error) { db.close(); throw error; }
                    })();
                    try { await pending; } finally { pending = undefined; }
                }
                return database;
            };
            /**
             * @returns {Promise<any>}
             */
            const createSchema = async function () {
                if (closed) fail('STORAGE', 'Provider is closed.');
                if (pending) await pending;
                pending = initialize();
                try { await pending; const db = database; if (!db) throw errors.create({code:'STORAGE',message:'Database initialization did not complete.'}); return {database:db, stores:{...stores}, version:db.version}; }
                finally { pending = undefined; }
            };
            /**
             * @param {any} entity
             * @param {any} stored
             * @returns {any}
             */
            const logical = function (entity, stored) {
                // Additive defaults/nulls can be read without rewriting old data; no implicit type conversions.
                const input = Object.fromEntries(entity.attributes.filter(/** @type {(a: any) => boolean} */ (a => Object.hasOwn(stored,a.name))).map(/** @type {(a: any) => [string, any]} */ (a => [a.name,stored[a.name]])));
                try { return norm.record({entity, record:norm.record({entity, record:input, mode:'create'}), mode:'complete'}); }
                catch { fail('STORAGE', 'Stored record is incompatible with the selected model; migrate its values explicitly.'); }
            };
            /**
             * @param {any} path
             * @param {any} write
             * @param {any} execute
             * @param {any} [lookup]
             * @returns {Promise<any>}
             */
            /** @param {any} path @param {boolean} write @param {(context: any) => any} execute @param {any} [lookup] @returns {Promise<any>} */
            const run = async function (path, write, execute, lookup) {
                const db = await ensure();
                return new Promise((resolve, reject) => {
                    /** @type {IDBTransaction|undefined} */
                    /** @type {any} */
                    let tx;
                    /** @type {any} */
                    let result;
                    /** @type {any} */
                    let cause;
                    try {
                        const scoped = path===null || write ? paths : [path];
                        tx = db.transaction([schemaStore,sequenceStore, ...scoped.map(p => stores[p])], write ? 'readwrite' : 'readonly');
                        /**
                         * @param {any} error
                         * @returns {void}
                         */
                        const abort = error => { cause = mapped(error); tx.abort(); };
                        tx.onabort = () => reject(cause ?? mapped(tx.error));
                        tx.onerror = () => {};
                        tx.oncomplete = () => resolve(result);
                        const data = Object.create(null);
                        let remaining = scoped.length * 2 + 2;
                        let counter = path===null ? Object.create(null) : '0';
                        let valid = false;
                        /**
                         * @returns {void}
                         */
                        const ready = () => {
                            if (--remaining) return;
                            try {
                                if (!valid) fail('UNSUPPORTED', 'Stored model is incompatible.');
                                result = execute({tx, data, counter});
                            } catch (error) { abort(error); }
                        };
                        const meta = tx.objectStore(schemaStore).get(db.version);

                        const seq = path===null ? tx.objectStore(sequenceStore).openCursor() : tx.objectStore(sequenceStore).get(path);
                        seq.onsuccess = () => {
                            if (path===null && seq.result) {counter[seq.result.key]=seq.result.value;seq.result.continue();return;}
                            if (path!==null) counter=seq.result ?? '0';
                            ready();
                        };
                        /**
                         * @param {any} p
                         * @param {any} metadata
                         * @returns {void}
                         */
                        const load=function (p,metadata) {
                            /** @type {any[]|undefined} */
                            /** @type {any[]|undefined} */
                            let rows;
                            /** @type {any[]|undefined} */
                            let keys;
                            /** @returns {void} */
                            const collect=()=>{
                                if (rows && keys) data[p]=rows.map((record,i)=>({key:keys?.[i],record:logical(snapshot.entities[p],record)}));
                                ready();
                            };
                            const store=tx.objectStore(stores[p]);
                            /** @type {IDBObjectStore|IDBIndex} */
                            let source=store;
                            let range;
                            const coreLookup=lookup?.members.every(/** @type {(member: string) => boolean} */ (member=>{
                                const attribute=snapshot.entities[p].attributes.find(/** @type {(item: any) => boolean} */ (item=>item.name===member));
                                return attribute && !attribute.type.name.includes('.');
                            }));
                            if (!write && coreLookup && (metadata?.nativeLookup?.[p] ?? db.version===1)) {
                                const indexName=Array.from(store.indexNames).find((name)=>{
                                    const keyPath=store.index(name).keyPath;
                                    return canonical(Array.isArray(keyPath) ? keyPath : [keyPath])===canonical(lookup.members);
                                });
                                if (indexName!==undefined) {
                                    const index=store.index(indexName);
                                    const probe=Array.isArray(index.keyPath) ? lookup.values : lookup.values[0];
                                    try {indexedDB.cmp(probe,probe);source=index;range=probe;} catch {}
                                }
                            }
                            const values=source.getAll(range), ids=source.getAllKeys(range);
                            values.onsuccess=()=>{try {rows=values.result;collect();} catch(error) {abort(error);}};
                            ids.onsuccess=()=>{try {keys=ids.result;collect();} catch(error) {abort(error);}};
                        };
                        meta.onsuccess=()=>{
                            try {
                                valid=meta.result?.layout===2 && canonical(meta.result.model)===identity;
                                for (const p of scoped) load(p,meta.result);
                                ready();
                            } catch(error) {abort(error);}
                        };
                    } catch (error) { if (tx) { cause = mapped(error); tx.abort(); } else reject(mapped(error)); }
                });
            };
            /**
             * @param {any} params
             * @returns {Promise<any>}
             */
            const get = async function (params) {
                shape(params,['path']);
                const path = params.path;
                if (!isCanonicalPath(path)) fail('INVALID_INPUT','Expected a canonical entity path.');
                const entity = snapshot.entities[path];
                if (!entity) fail('NOT_FOUND','Entity not found.');
                await ensure();
                return {
                    create: async (/** @type {any} */ params) => (await execute({operations:[{path,method:'create',params}]})).results[0],
                    read: async (/** @type {any} */ params) => (await execute({operations:[{path,method:'read',params}]})).results[0],
                    update: async (/** @type {any} */ params) => (await execute({operations:[{path,method:'update',params}]})).results[0],
                    delete: async (/** @type {any} */ params) => (await execute({operations:[{path,method:'delete',params}]})).results[0],
                    list: async (/** @type {any} */ params) => (await execute({operations:[{path,method:'list',params}]})).results[0],
                };
            };
            /** @param {any} params @returns {Promise<any>} */
            const execute=async function (params) {
                shape(params,['operations']);
                const commands=batchExec.validate({model:snapshot,operations:params.operations});
                const write=commands.some(/** @type {(command: any) => boolean} */ (command=>['create','update','delete'].includes(command.method)));
                const single=commands.length===1 ? commands[0] : undefined;
                const scope=single && !write ? single.path : null;
                let lookup;
                if (single?.method==='read') lookup={members:Object.keys(single.params.key.values),values:Object.values(single.params.key.values)};
                if (single?.method==='list') {
                    const where=single.params.selection.where;
                    if (where?.operator==='eq' && where.args?.[0]?.kind==='attr' && where.args?.[1]?.kind==='value')
                        lookup={members:[where.args[0].name],values:[where.args[1].value]};
                }
                return run(scope,write,/** @type {(context: any) => any} */ (({tx,data,counter})=>{
                    const affected=scope===null || write ? paths : [scope];
                    const before=Object.fromEntries(affected.map(p=>[p,data[p].map((/** @type {any} */ row)=>({key:row.key,row}))]));
                    const result=batchExec.plan({model:snapshot,operations:commands,rows:data,enforceRelations,
                        generate: /** @type {(input: any) => any} */ (({path,attribute,rows})=>{
                            if (attribute.type.profile.type==='uuid') return globalThis.crypto.randomUUID();
                            let highest=BigInt(counter[path] ?? '0');
                            for (const entry of rows) if (BigInt(entry.record[attribute.name])>highest) highest=BigInt(entry.record[attribute.name]);
                            return (highest+1n).toString();
                        }),
                        created: /** @type {(input: any) => void} */ (({path,entity,record})=>{
                            const a=entity.attributes.find((/** @type {any} */ a)=>a.type.name==='identity' && a.type.profile.type==='int');
                            if (a && BigInt(record[a.name])>BigInt(counter[path] ?? '0')) counter[path]=record[a.name];
                        }),
                    });
                    if (write) for (const p of affected) {
                        const store=tx.objectStore(stores[p]), initial=new Map(before[p].map((/** @type {any} */ item)=>[item.key,item.row]));
                        const keys=new Set(data[p].filter((/** @type {any} */ row)=>row.key!==undefined).map((/** @type {any} */ row)=>row.key));
                        for (const key of initial.keys()) if (!keys.has(key)) store.delete(key);
                        for (const row of data[p]) {
                            if (row.key===undefined) store.add(row.record);
                            else if (initial.get(row.key)!==row) store.put(row.record,row.key);
                        }
                        tx.objectStore(sequenceStore).put(counter[p] ?? '0',p);
                    }
                    return result;
                }),lookup);
            };
            /** @returns {Promise<any>} */
            const getSchemaHistory=async function () {
                const db=await ensure();
                return new Promise((resolve,reject)=>{
                    const tx=db.transaction(schemaStore,'readonly'),request=tx.objectStore(schemaStore).getAll();
                    tx.oncomplete=()=>resolve({schemas:request.result.map((/** @type {any} */ row)=>({version:row.version,model:row.model}))});
                    tx.onabort=()=>reject(mapped(tx.error));
                });
            };
            return {createSchema, get, execute, getSchemaHistory, close: async function () { closed = true; if (pending) { try { await pending; } catch {} } database?.close(); }};
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({errors:'TeqFw_Dem_Repository_Error$',normalize:'TeqFw_Dem_Repository_Normalize$',selection:'TeqFw_Dem_Dto_Query_Selection__Factory$',evaluate:'TeqFw_Dem_Repository_Select$',batch:'TeqFw_Dem_Repository_Batch$',demCanonical:'TeqFw_Dem_Compile_A_Canonical$',fingerprint:'TeqFw_Dem_Compile_A_Fingerprint$'})});
