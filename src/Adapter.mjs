// @ts-check
/**
 * @namespace TeqFw_DemIdb_Adapter
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
     */
    constructor({errors, normalize, selection, evaluate, batch}) {
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
         * @param {any} fields
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
         * @param {object} deps
         * @param {any} deps.model
         * @param {string} deps.name
         * @param {any} [deps.indexedDB]
         * @param {boolean} [deps.enforceRelations]
         * @returns {Promise<any>}
         */
        this.open = async function ({model, name, indexedDB = globalThis.indexedDB, enforceRelations = false}) {
            if (!model?.entities || typeof name !== 'string' || !name || !indexedDB) fail('INVALID_INPUT', 'A compiled DEM model, database name and IndexedDB factory are required.');
            if (typeof enforceRelations !== 'boolean') fail('INVALID_INPUT', 'enforceRelations must be boolean.');
            const snapshot = JSON.parse(JSON.stringify(model));
            const identity = canonical(snapshot);
            const paths = Object.keys(snapshot.entities);
            if (paths.some(path => typeof path !== 'string' || !/^\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(path))) {
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
            let database;
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
                    let cause;
                    request.onblocked = () => { rejected = true; reject(errors.create({code:'STORAGE',message:'Database upgrade is blocked by another connection.'})); };
                    request.onerror = () => reject(cause ?? mapped(request.error));
                    request.onupgradeneeded = event => {
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
                                    if (attrs.every(attr => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attr))) store.createIndex(key, attrs, {unique:false});
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
                    };
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
                try { await pending; return {database, stores:{...stores}, version:database.version}; }
                finally { pending = undefined; }
            };
            /**
             * @param {any} entity
             * @param {any} stored
             * @returns {any}
             */
            const logical = function (entity, stored) {
                // Additive defaults/nulls can be read without rewriting old data; no implicit type conversions.
                const input = Object.fromEntries(entity.attributes.filter(a => Object.hasOwn(stored,a.name)).map(a => [a.name,stored[a.name]]));
                try { return normalize.record({entity, record:normalize.record({entity, record:input, mode:'create'}), mode:'complete'}); }
                catch { fail('STORAGE', 'Stored record is incompatible with the selected model; migrate its values explicitly.'); }
            };
            /**
             * @param {any} row
             * @param {any} members
             * @returns {string}
             */
            const tuple = function (row, members) { return canonical(members.map(k => row[k])); };
            /**
             * @param {any} data
             * @param {any} path
             * @returns {void}
             */
            const validate = function (data, path) {
                const entity = snapshot.entities[path];
                for (const members of [entity.primaryKey, ...Object.values(entity.uniqueKeys)].filter(Boolean)) {
                    const seen = new Set();
                    for (const entry of data[path]) {
                        if (members.some(k => entry.record[k] === null)) continue;
                        const value = tuple(entry.record, members);
                        if (seen.has(value)) fail('CONFLICT', 'Logical key must be unique.');
                        seen.add(value);
                    }
                }
                if (enforceRelations) for (const p of paths) for (const relation of Object.values(snapshot.entities[p].relations)) {
                    for (const {record} of data[p]) {
                        if (relation.attributes.some(k => record[k] === null)) continue;
                        if (!data[relation.target.path].some(target => tuple(target.record,relation.target.attributes) === tuple(record,relation.attributes))) fail('RELATION', 'Relation target is missing or still referenced.');
                    }
                }
            };
            /**
             * @param {any} path
             * @param {any} write
             * @param {any} execute
             * @param {any} [lookup]
             * @returns {Promise<any>}
             */
            const run = async function (path, write, execute, lookup) {
                const db = await ensure();
                return new Promise((resolve, reject) => {
                    let tx, result, cause;
                    try {
                        const scoped = path===null || enforceRelations && write ? paths : [path];
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
                            let rows, keys;
                            /** @returns {void} */
                            const collect=()=>{
                                if (rows && keys) data[p]=rows.map((record,i)=>({key:keys[i],record:logical(snapshot.entities[p],record)}));
                                ready();
                            };
                            const store=tx.objectStore(stores[p]);
                            let source=store,range;
                            if (!write && lookup && (metadata?.nativeLookup?.[p] ?? db.version===1)) {
                                const indexName=Array.from(store.indexNames).find(name=>{
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
                if (typeof path !== 'string' || !/^\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(path)) fail('INVALID_INPUT','Expected a canonical entity path.');
                const entity = snapshot.entities[path];
                if (!entity) fail('NOT_FOUND','Entity not found.');
                await ensure();
                /**
                 * @param {any} rows
                 * @param {any} key
                 * @returns {number}
                 */
                const find = (rows,key) => rows.findIndex(entry => Object.keys(key.values).every(k => canonical(entry.record[k]) === canonical(key.values[k])));
                /**
                 * @param {any} value
                 * @returns {any}
                 */
                const record = value => normalize.record({entity,record:value,mode:'complete'});
                return {
                    create: async function (params) {
                        shape(params,['record']);
                        const value = normalize.record({entity,record:params.record,mode:'create'});
                        return run(path,true,({tx,data,counter}) => {
                            for (const a of entity.attributes.filter(a => a.type.name === 'identity')) {
                                if (a.type.profile.type === 'int') {
                                    let highest = BigInt(counter);
                                    for (const entry of data[path]) if (BigInt(entry.record[a.name]) > highest) highest = BigInt(entry.record[a.name]);
                                    if (!Object.hasOwn(value,a.name)) Object.defineProperty(value,a.name,{value:(highest+1n).toString(),enumerable:true,writable:true,configurable:true});
                                    if (BigInt(value[a.name]) > highest) highest = BigInt(value[a.name]);
                                    tx.objectStore(sequenceStore).put(highest.toString(),path);
                                } else if (!Object.hasOwn(value,a.name)) Object.defineProperty(value,a.name,{value:globalThis.crypto.randomUUID(),enumerable:true,writable:true,configurable:true});
                            }
                            const complete = record(value);
                            data[path].push({record:complete});
                            validate(data,path);
                            tx.objectStore(stores[path]).add(complete);
                            return {record:complete};
                        });
                    },
                    read: async function (params) {
                        shape(params,['key']); const key = normalize.key({entity,key:params.key});
                        return run(path,false,({data}) => { const i = find(data[path],key); return {record:i < 0 ? null : data[path][i].record}; },{members:Object.keys(key.values),values:Object.values(key.values)});
                    },
                    update: async function (params) {
                        shape(params,['key','changes']); const key = normalize.key({entity,key:params.key});
                        const changes = normalize.record({entity,record:params.changes,mode:'update'});
                        return run(path,true,({tx,data}) => {
                            const i = find(data[path],key); if (i < 0) return {record:null};
                            const next = record({...data[path][i].record,...changes}); data[path][i].record = next;
                            validate(data,path); tx.objectStore(stores[path]).put(next,data[path][i].key); return {record:next};
                        });
                    },
                    delete: async function (params) {
                        shape(params,['key']); const key = normalize.key({entity,key:params.key});
                        return run(path,true,({tx,data}) => {
                            const i = find(data[path],key); if (i < 0) return {deleted:false};
                            const [entry] = data[path].splice(i,1); validate(data,path); tx.objectStore(stores[path]).delete(entry.key); return {deleted:true};
                        });
                    },
                    list: async function (params) {
                        shape(params,['selection']);
                        const query=selection.create({entity,selection:params.selection});
                        const lookup=query.where?.operator==='eq' ? {members:[query.where.args[0].name],values:[query.where.args[1].value]} : undefined;
                        return run(path,false,({data})=>evaluate.exec({entity,records:data[path].map(entry=>entry.record),selection:query}),lookup);
                    },
                };
            };
            /** @param {any} params @returns {Promise<any>} */
            const execute=async function (params) {
                shape(params,['operations']);
                const commands=batch.validate({model:snapshot,operations:params.operations});
                const write=commands.some(command=>['create','update','delete'].includes(command.method));
                return run(null,write,({tx,data,counter})=>{
                    const before=Object.fromEntries(paths.map(p=>[p,data[p].slice()]));
                    const result=batch.plan({model:snapshot,operations:commands,rows:data,enforceRelations,
                        generate:({path,attribute,rows})=>{
                            if (attribute.type.profile.type==='uuid') return globalThis.crypto.randomUUID();
                            let highest=BigInt(counter[path] ?? '0');
                            for (const entry of rows) if (BigInt(entry.record[attribute.name])>highest) highest=BigInt(entry.record[attribute.name]);
                            return (highest+1n).toString();
                        },
                        created:({path,entity,record})=>{
                            const a=entity.attributes.find(a=>a.type.name==='identity' && a.type.profile.type==='int');
                            if (a && BigInt(record[a.name])>BigInt(counter[path] ?? '0')) counter[path]=record[a.name];
                        },
                    });
                    if (write) for (const p of paths) {
                        const store=tx.objectStore(stores[p]), initial=new Map(before[p].map(row=>[row.key,row.record]));
                        const keys=new Set(data[p].filter(row=>row.key!==undefined).map(row=>row.key));
                        for (const key of initial.keys()) if (!keys.has(key)) store.delete(key);
                        for (const row of data[p]) {
                            if (row.key===undefined) store.add(row.record);
                            else if (canonical(initial.get(row.key))!==canonical(row.record)) store.put(row.record,row.key);
                        }
                        tx.objectStore(sequenceStore).put(counter[p] ?? '0',p);
                    }
                    return result;
                });
            };
            /** @returns {Promise<any>} */
            const getSchemaHistory=async function () {
                const db=await ensure();
                return new Promise((resolve,reject)=>{
                    const tx=db.transaction(schemaStore,'readonly'),request=tx.objectStore(schemaStore).getAll();
                    tx.oncomplete=()=>resolve({schemas:request.result.map(row=>({version:row.version,model:row.model}))});
                    tx.onabort=()=>reject(mapped(tx.error));
                });
            };
            return {createSchema, get, execute, getSchemaHistory, close: async function () { closed = true; if (pending) { try { await pending; } catch {} } database?.close(); }};
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({errors:'TeqFw_Dem_Repository_Error$',normalize:'TeqFw_Dem_Repository_Normalize$',selection:'TeqFw_Dem_Dto_Query_Selection__Factory$',evaluate:'TeqFw_Dem_Repository_Select$',batch:'TeqFw_Dem_Repository_Batch$'})});
