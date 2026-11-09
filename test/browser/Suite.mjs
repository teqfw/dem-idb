import {run as runApplication} from './application/Browser.mjs';
import Container from '/di/dist/esm.js';

const cases = [];
const test = (name, body) => cases.push({name, body});
const canon = value => JSON.stringify(value, (_k,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const assert = {
    equal: (a,b) => { if (a !== b) throw new Error(`Expected ${canon(b)}, received ${canon(a)}`); },
    deepEqual: (a,b) => { if (canon(a) !== canon(b)) throw new Error(`Expected ${canon(b)}, received ${canon(a)}`); },
    match: (a,b) => { if (!b.test(a)) throw new Error(`Pattern mismatch: ${a}`); },
    ok: value => { if (!value) throw new Error('Expected truthy value'); },
    rejects: async (promise, expected) => {
        try { await promise; } catch (error) {
            if (typeof expected === 'function' ? expected(error) : Object.entries(expected).every(([k,v]) => error[k] === v)) return;
            throw error;
        }
        throw new Error('Expected rejection');
    },
};
const container = new Container();
container.addNamespaceRoot('TeqFw_Dem_', location.origin + '/dem/src', '.mjs');
container.addNamespaceRoot('TeqFw_Dem_IDb_', location.origin + '/src', '.mjs');
(await container.get('TeqFw_Dem_Registry$')).finalize();
const compiler = await container.get('TeqFw_Dem_Compile$');
const adapter = await container.get('TeqFw_Dem_IDb_Adapter$');
const selection = await container.get('TeqFw_Dem_Dto_Query_Selection__Factory$');
const {register}=await container.get('TeqFw_Dem_Conformance_Repository$');
const {schema:valueSchema,map:valueMap,exercise:valueExercise}=await container.get('TeqFw_Dem_Conformance_Values$');
const {schema:atomicSchema,exercise:exerciseAtomic}=await container.get('TeqFw_Dem_Conformance_Atomic$');
const {schema:extendedSchema,exercise:exerciseExtended}=await container.get('TeqFw_Dem_Conformance_Extended$');
const {exercise:exerciseEvolution}=await container.get('TeqFw_Dem_Conformance_Evolution$');
let sequence = 0;
const compile = async schema => (await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}]})).model;
const remove = name => new Promise((resolve,reject) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = resolve; req.onerror = () => reject(req.error); });
const open = async ({schema, enforceRelations = true}) => {
    const model = await compile(schema), name = 'dem-idb-test-' + ++sequence;
    const provider = await adapter.open({model,name,enforceRelations});
    const initialized = await provider.createSchema();
    return {provider,model,name,initialized,selection,close:async () => { await provider.close(); await remove(name); }};
};
register({test,assert,open});
const simple = {$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}};
const key = id => ({kind:'primary',values:{id}});

test('fresh database uses effective entity paths and reserved internal stores', async () => {
    const env=await open({schema:simple});
    try {
        const names=Array.from(env.initialized.database.objectStoreNames).sort();
        assert.deepEqual(names,['/app/item','/dem/schema','/dem/sequence']);
        assert.deepEqual(env.initialized.stores,{'/app/item':'/app/item'});
    } finally {await env.close();}
});

test('reserved application namespace is rejected before IndexedDB access', async () => {
    let opens=0;
    const database={open(){opens++;throw new Error('IndexedDB must not be accessed.');}};
    await assert.rejects(adapter.open({model:{entities:{'/dem/private':{attributes:[]}}},name:'dem-idb-reserved-'+ ++sequence,indexedDB:database}),{code:'INVALID_INPUT'});
    assert.equal(opens,0);
});

test('noncanonical effective entity paths are rejected before IndexedDB access', async () => {
    let operations=0;
    const database={open(){operations++;throw new Error('IndexedDB must not be accessed.');}};
    for (const path of ['/1item','/app/my_item','/app//item','/app/../item','/app/item/']) {
        await assert.rejects(adapter.open({model:{entities:{[path]:{attributes:[]}}},name:'dem-idb-invalid-path-'+ ++sequence,indexedDB:database}),{code:'INVALID_INPUT'});
    }
    assert.equal(operations,0);
});

test('obsolete physical layouts are rejected without changing the database', async () => {
    const name='dem-idb-legacy-'+ ++sequence;
    const legacy=await new Promise((resolve,reject)=>{
        const req=indexedDB.open(name,1);
        req.onupgradeneeded=()=>{
            const db=req.result;
            const history=db.createObjectStore('dem_schema',{keyPath:'version'});
            history.put({version:1,layout:1,model:{entities:{}}});
            db.createObjectStore('dem_sequence');
            const entity=db.createObjectStore('dem:/app/item',{autoIncrement:true});
            entity.add({id:'kept',name:'historical'});
        };
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error);
    });
    legacy.close();
    let provider;
    try {
        provider=await adapter.open({model:await compile(simple),name});
        await assert.rejects(provider.createSchema(),{code:'UNSUPPORTED'});
        await assert.rejects(provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
        const db=await new Promise((resolve,reject)=>{
            const req=indexedDB.open(name);
            req.onsuccess=()=>resolve(req.result);
            req.onerror=()=>reject(req.error);
        });
        try {
            assert.equal(db.version,1);
            assert.deepEqual(Array.from(db.objectStoreNames).sort(),['dem:/app/item','dem_schema','dem_sequence']);
            const tx=db.transaction('dem:/app/item','readonly'), rows=tx.objectStore('dem:/app/item').getAll();
            await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
            assert.deepEqual(rows.result,[{id:'kept',name:'historical'}]);
        } finally {db.close();}
    } finally {await provider?.close(); await remove(name);}
});

test('schema history, idempotence, additive defaults and persistence after reopen', async () => {
    const env = await open({schema:simple});
    let second;
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'before'}});
        assert.equal((await env.provider.createSchema()).version,1);
        await env.provider.close();
        const updated = structuredClone(simple);
        updated.item.attributes.push({name:'note',type:{name:'text'},default:'new'});
        second = await adapter.open({model:await compile(updated),name:env.name});
        const result = await second.createSchema();
        assert.equal(result.version,2);
        const history = await second.getSchemaHistory();
        assert.equal(history.schemas.length,2);
        assert.equal((await (await second.get({path:'/app/item'})).read({key:key('1')})).record.note,'new');
        await second.close();
        second = await adapter.open({model:await compile(updated),name:env.name});
        assert.equal((await (await second.get({path:'/app/item'})).list({selection:{}})).records.length,1);
    } finally { await second?.close(); await env.close(); }
});

test('all logical value types round-trip and decimals and integers compare exactly', async () => {
    const schema = {$format:2,$namespace:'/app/',data:{attributes:[
        {name:'id',type:{name:'identity'},generation:true},
        {name:'wide',type:{name:'integer',params:{bits:64}}},
        {name:'amount',type:{name:'decimal',params:{precision:24,scale:4}}},
        {name:'flag',type:{name:'boolean'}},
        {name:'blob',type:{name:'binary'}},
        {name:'data',type:{name:'json'}},
        {name:'vector',type:{name:'vector',params:{dimensions:2,element:'float'}}},
        {name:'day',type:{name:'date'}},
        {name:'time',type:{name:'datetime'}},
        {name:'choice',type:{name:'enum',params:{values:['a','b']}}},
        {name:'uuid',type:{name:'uuid'}},
    ]}};
    const env = await open({schema});
    try {
        const repo = await env.provider.get({path:'/app/data'});
        const input = {wide:'9007199254740993',amount:'9007199254740993.0001',flag:true,blob:'AQID',data:{nested:['x']},vector:[1,2],day:'2026-10-31',time:'2026-10-31T12:00:00',choice:'a',uuid:'abcdef12-3456-7890-abcd-ef1234567890'};
        const {record} = await repo.create({record:input});
        assert.deepEqual((await repo.read({key:key(record.id)})).record,record);
        input.data.nested[0] = 'mutated';
        assert.equal((await repo.read({key:key(record.id)})).record.data.nested[0],'x');
        await repo.create({record:{...input,amount:'9007199254740993.0002',wide:'9007199254740992'}});
        const ordered = await repo.list({selection:{orderBy:[{attribute:'wide',direction:'asc',nulls:'last'}]}});
        assert.equal(ordered.records[0].wide,'9007199254740992');
        const filtered = await repo.list({selection:{where:{kind:'call',operator:'gt',args:[{kind:'attr',name:'amount'},{kind:'value',value:'9007199254740993.0001'}]}}});
        assert.equal(filtered.records.length,1);
    } finally { await env.close(); }
});

test('concurrent providers allocate distinct ids; sequence survives deletion', async () => {
    const env = await open({schema:simple});
    const other = await adapter.open({model:env.model,name:env.name});
    try {
        const a = await env.provider.get({path:'/app/item'}), b = await other.get({path:'/app/item'});
        const records = await Promise.all(Array.from({length:20},(_,i) => (i%2 ? a : b).create({record:{name:String(i)}})));
        assert.equal(new Set(records.map(x => x.record.id)).size,20);
        await a.create({record:{id:'99999999999999999999999',name:'explicit'}});
        await a.delete({key:key('99999999999999999999999')});
        assert.equal((await b.create({record:{name:'next'}})).record.id,'100000000000000000000000');
    } finally { await other.close(); await env.close(); }
});

test('relations are descriptive by default, optional enforcement is available', async () => {
    const schema = {$format:2,$namespace:'/app/',parent:{attributes:[{name:'id',type:{name:'identity'}}]},child:{attributes:[{name:'owner',type:{name:'ref'}}],relations:{owner:{attributes:['owner'],target:{path:'/app/parent',attributes:['id']}}}}};
    const env = await open({schema,enforceRelations:false});
    try { assert.deepEqual(await (await env.provider.get({path:'/app/child'})).create({record:{owner:'999'}}),{record:{owner:'999'}}); }
    finally { await env.close(); }
});

test('missing database is not implicitly initialized and incompatible model is rejected', async () => {
    const name = 'dem-idb-missing-' + ++sequence;
    const backend = await adapter.open({model:await compile(simple),name});
    try { await assert.rejects(backend.get({path:'/app/item'}),{code:'UNSUPPORTED'}); }
    finally { await backend.close(); await remove(name); }
    const env = await open({schema:simple});
    const changed = structuredClone(simple); changed.item.attributes.push({name:'added',type:{name:'text'},nullable:true});
    const other = await adapter.open({model:await compile(changed),name:env.name});
    try { await assert.rejects(other.get({path:'/app/item'}),{code:'UNSUPPORTED'}); }
    finally { await other.close(); await env.close(); }
});

test('Unicode scalar ordering, null placement and zero limit', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'},nullable:true}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        for (const name of ['\u{10000}','\ue000','a','A',null]) await repo.create({record:{name}});
        const result = await repo.list({selection:{orderBy:[{attribute:'name',direction:'asc',nulls:'first'}]}});
        assert.deepEqual(result.records.map(x => x.name),[null,'A','a','\ue000','\u{10000}']);
        assert.deepEqual(await repo.list({selection:{limit:0}}),{records:[]});
    } finally { await env.close(); }
});


test('UUID identities and references use the same logical values', async () => {
    const name = 'dem-idb-uuid-' + ++sequence;
    const schema = {$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true}]}};
    const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],map:{packageName:'test',filename:'map.json',document:{$format:1,identityProfiles:{'/app/item':{id:{type:'uuid'}}}}}});
    const provider = await adapter.open({model,name});
    try {
        await provider.createSchema(); const repo = await provider.get({path:'/app/item'});
        const {record} = await repo.create({record:{}});
        assert.match(record.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.deepEqual(await repo.read({key:key(record.id)}),{record});
    } finally { await provider.close(); await remove(name); }
});

test('failed unique writes roll back generated sequence changes', async () => {
    const schema = structuredClone(simple); schema.item.uniqueKeys = {name:['name']};
    const env = await open({schema});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'same'}});
        await assert.rejects(env.provider.execute({operations:[
            {path:'/app/item',method:'create',params:{record:{name:'next'}}},
            {path:'/app/item',method:'create',params:{record:{name:'next'}}},
        ]}),{code:'CONFLICT'});
        assert.deepEqual((await repo.list({selection:{}})).records,[{id:'1',name:'same'}]);
        assert.equal((await repo.create({record:{name:'next'}})).record.id,'2');
    } finally { await env.close(); }
});

test('schema updates invalidate old providers and preserve current entity data', async () => {
    const env = await open({schema:simple}); let newer;
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'current'}});
        const schema = structuredClone(simple);
        schema.other={attributes:[{name:'label',type:{name:'text'}}]};
        newer = await adapter.open({model:await compile(schema),name:env.name});
        await newer.createSchema();
        await assert.rejects(repo.list({selection:{}}),{code:'STORAGE'});
        assert.deepEqual(await (await newer.get({path:'/app/item'})).list({selection:{}}),{records:[{id:'1',name:'current'}]});
        assert.deepEqual(await (await newer.get({path:'/app/other'})).list({selection:{}}),{records:[]});
    } finally { await newer?.close(); await env.close(); }
});

test('provider rejects a different current model without modifying stored data', async () => {
    const env=await open({schema:simple}); let backend, reopened;
    try {
        await (await env.provider.get({path:'/app/item'})).create({record:{name:'current'}});
        await env.provider.close();
        const changed=structuredClone(simple); changed.item.attributes.push({name:'new_field',type:{name:'text'},nullable:true});
        backend=await adapter.open({model:await compile(changed),name:env.name});
        await assert.rejects(backend.get({path:'/app/item'}),{code:'UNSUPPORTED'});
        await backend.close(); backend=undefined;
        reopened=await adapter.open({model:env.model,name:env.name});
        assert.deepEqual(await (await reopened.get({path:'/app/item'})).list({selection:{}}),{records:[{id:'1',name:'current'}]});
    } finally { await backend?.close(); await reopened?.close(); await env.close(); }
});

test('blocked upgrades reject and do not apply after the blocker closes', async () => {
    const env = await open({schema:simple}); let other, upgradeFinished;
    const trackedIndexedDB = {open(name, version) {
        const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
        if (version !== undefined) upgradeFinished = new Promise(resolve => request.addEventListener('error', resolve, {once:true}));
        return request;
    }};
    const blocker = await new Promise(resolve => { const req=indexedDB.open(env.name); req.onsuccess=()=>resolve(req.result); });
    try {
        const schema=structuredClone(simple); schema.item.attributes.push({name:'new_field',type:{name:'text'},nullable:true});
        other=await adapter.open({model:await compile(schema),name:env.name,indexedDB:trackedIndexedDB});
        await assert.rejects(other.createSchema(),{code:'STORAGE'});
        blocker.close();
        // Wait for the blocked upgrade request to abort before opening the database again.
        await upgradeFinished;
        const db=await new Promise(resolve=>{const req=indexedDB.open(env.name);req.onsuccess=()=>resolve(req.result);});
        assert.equal(db.version,1); db.close();
    } finally { blocker.close(); await other?.close(); await env.close(); }
});

test('self relations and nullable unique keys preserve repository semantics', async () => {
    const schema = {$format:2,$namespace:'/app/',node:{attributes:[{name:'id',type:{name:'identity'}},{name:'parent',type:{name:'ref'},nullable:true}],uniqueKeys:{parent:['parent']},relations:{parent:{attributes:['parent'],target:{path:'/app/node',attributes:['id']}}}}};
    const env=await open({schema});
    try {
        const repo=await env.provider.get({path:'/app/node'});
        await repo.create({record:{id:'1',parent:'1'}});
        await repo.create({record:{id:'2',parent:null}});await repo.create({record:{id:'3',parent:null}});
        await assert.rejects(repo.update({key:key('2'),changes:{parent:'1'}}),{code:'CONFLICT'});
        assert.deepEqual(await repo.delete({key:key('1')}),{deleted:true});
    } finally { await env.close(); }
});

test('browser host substitutes the DEM provider through actual DI preprocessing', async () => {
    const env=await open({schema:simple});
    const c=new Container({preprocessors:['Test_Preprocessor$']});
    c.addNamespaceRoot('Test_',location.origin+'/test/fixture','.mjs');
    c.addNamespaceRoot('TeqFw_Dem_',location.origin+'/dem/src','.mjs');
    c.addNamespaceRoot('TeqFw_Dem_IDb_',location.origin+'/src','.mjs');
    c.enableTestMode();
    c.register('TeqFw_Dem_IDb_Api_Configuration$',{get:async()=>({model:env.model,name:env.name})});
    let provider;
    try {
        provider=await c.get('TeqFw_Dem_Api_RepositoryProvider$');
        const atomic=await c.get('TeqFw_Dem_Api_RepositoryBatch$');assert.equal(atomic,provider);
        assert.equal((await atomic.execute({operations:[{path:'/app/item',method:'create',params:{record:{name:'batch DI'}}}]})).results[0].record.name,'batch DI');
        const repo=await provider.get({path:'/app/item'});
        assert.equal((await repo.create({record:{name:'DI'}})).record.name,'DI');
    } finally { await provider?.close(); await env.close(); }
});

test('native key and equality lookup avoid full scans, with non-keyable JSON/boolean fallback',async()=>{
    const schema=structuredClone(simple);
    schema.item.attributes.push({name:'flag',type:{name:'boolean'}},{name:'payload',type:{name:'json'}});
    schema.item.uniqueKeys={name:['name'],flag:['flag'],payload:['payload']};
    const env=await open({schema});
    const originalStore=IDBObjectStore.prototype.getAll,originalIndex=IDBIndex.prototype.getAll;
    let scans=0,indexReads=0;
    try {
        const repo=await env.provider.get({path:'/app/item'});
        const a=(await repo.create({record:{name:'Ada',flag:true,payload:{n:1}}})).record;
        await repo.create({record:{name:'B',flag:false,payload:{n:2}}});
        IDBObjectStore.prototype.getAll=function (...args) {if(this.name===env.initialized.stores['/app/item']) scans++;return originalStore.apply(this,args);};
        IDBIndex.prototype.getAll=function (...args) {indexReads++;return originalIndex.apply(this,args);};
        assert.deepEqual(await repo.read({key:key(a.id)}),{record:a});
        assert.deepEqual(await repo.read({key:{kind:'unique',name:'name',values:{name:'Ada'}}}),{record:a});
        const where={kind:'call',operator:'eq',args:[{kind:'attr',name:'name'},{kind:'value',value:'Ada'}]};
        assert.deepEqual(await repo.list({selection:{where}}),{records:[a]});
        assert.equal(scans,0);assert.equal(indexReads,3);
        assert.equal((await repo.read({key:{kind:'unique',name:'flag',values:{flag:false}}})).record.name,'B');
        assert.equal((await repo.read({key:{kind:'unique',name:'payload',values:{payload:{n:2}}}})).record.name,'B');
        assert.equal(scans,2);
    } finally {IDBObjectStore.prototype.getAll=originalStore;IDBIndex.prototype.getAll=originalIndex;await env.close();}
});

test('extension Equality lookups scan while core lookups retain native index narrowing',async()=>{
    const c=new Container();
    c.addNamespaceRoot('TeqFw_Dem_',location.origin+'/dem/src','.mjs');
    c.addNamespaceRoot('TeqFw_Dem_IDb_',location.origin+'/src','.mjs');
    const registry=await c.get('TeqFw_Dem_Registry$');
    registry.register([{
        name:'example.CaseFolded',parameters:{},normalizeParams:params=>params,
        valueDomain:'String values.',preservation:'String values.',valueHandling:'Normalize and copy strings.',equality:'Case-insensitive string equality.',
    }]);
    registry.finalize();
    const model=(await (await c.get('TeqFw_Dem_Compile$')).exec({schemas:[{packageName:'test',filename:'extension.json',document:{$format:2,$namespace:'/extension/',item:{
        attributes:[{name:'id',type:{name:'text'}},{name:'folded',type:{name:'example.CaseFolded'}},{name:'label',type:{name:'text'}}],
        primaryKey:['id'],uniqueKeys:{by_folded:['folded'],by_label:['label']},
    }}}]})).model;
    const handler={name:'example.CaseFolded',normalize:value=>value,copy:value=>value,equals:(left,right)=>left.toLowerCase()===right.toLowerCase()};
    const runtime=(await c.get('TeqFw_Dem_Repository_Runtime$')).bind({model,registry,handlers:[handler]});
    const name='dem-idb-extension-equality-'+ ++sequence;
    const provider=await (await c.get('TeqFw_Dem_IDb_Adapter$')).open({model,name,runtime});
    let scans=0,indexReads=0;
    const originalStore=IDBObjectStore.prototype.getAll,originalIndex=IDBIndex.prototype.getAll;
    try {
        await provider.createSchema();
        const repo=await provider.get({path:'/extension/item'});
        await repo.create({record:{id:'1',folded:'ABC',label:'core'}});
        IDBObjectStore.prototype.getAll=function (...args) {if(this.name==='/extension/item') scans++;return originalStore.apply(this,args);};
        IDBIndex.prototype.getAll=function (...args) {indexReads++;return originalIndex.apply(this,args);};
        assert.equal((await repo.read({key:{kind:'unique',name:'by_folded',values:{folded:'abc'}}})).record.id,'1');
        const foldedWhere={kind:'call',operator:'eq',args:[{kind:'attr',name:'folded'},{kind:'value',value:'abc'}]};
        assert.equal((await repo.list({selection:{where:foldedWhere}})).records[0].id,'1');
        assert.equal(scans,2);assert.equal(indexReads,0);
        assert.equal((await repo.read({key:{kind:'unique',name:'by_label',values:{label:'core'}}})).record.id,'1');
        const labelWhere={kind:'call',operator:'eq',args:[{kind:'attr',name:'label'},{kind:'value',value:'core'}]};
        assert.equal((await repo.list({selection:{where:labelWhere}})).records[0].id,'1');
        assert.equal(scans,2);assert.equal(indexReads,2);
    } finally {
        IDBObjectStore.prototype.getAll=originalStore;IDBIndex.prototype.getAll=originalIndex;
        await provider.close();await remove(name);
    }
});

test('lookup planning falls back when additive defaults are absent in old raw records',async()=>{
    const env=await open({schema:simple});let next;
    try {
        await (await env.provider.get({path:'/app/item'})).create({record:{name:'old'}});
        const schema=structuredClone(simple);
        schema.item.attributes.push({name:'category',type:{name:'text'},default:'default'});
        schema.item.indexes={category:{attributes:['category']}};
        next=await adapter.open({model:await compile(schema),name:env.name});
        await next.createSchema();
        const repo=await next.get({path:'/app/item'});
        const where={kind:'call',operator:'eq',args:[{kind:'attr',name:'category'},{kind:'value',value:'default'}]};
        const records=(await repo.list({selection:{where}})).records;
        assert.equal(records.length,1);assert.equal(records[0].name,'old');
    } finally {await next?.close();await env.close();}
});

test('index-only schema changes retain safe native lookup coverage',async()=>{
    const env=await open({schema:simple});let next;
    const originalStore=IDBObjectStore.prototype.getAll;
    let scans=0;
    try {
        await (await env.provider.get({path:'/app/item'})).create({record:{name:'old'}});
        const schema=structuredClone(simple);schema.item.indexes={name:{attributes:['name']}};
        next=await adapter.open({model:await compile(schema),name:env.name});await next.createSchema();
        const repo=await next.get({path:'/app/item'});
        IDBObjectStore.prototype.getAll=function (...args) {if(this.name===env.initialized.stores['/app/item']) scans++;return originalStore.apply(this,args);};
        const where={kind:'call',operator:'eq',args:[{kind:'attr',name:'name'},{kind:'value',value:'old'}]};
        assert.equal((await repo.list({selection:{where}})).records.length,1);assert.equal(scans,0);
    } finally {IDBObjectStore.prototype.getAll=originalStore;await next?.close();await env.close();}
});

let valueTranscript,atomicTranscript,extendedTranscript,evolutionTranscript;
test('shared multi-engine value workload',async()=>{
    const {model}=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:valueSchema}],map:{packageName:'test',filename:'map.json',document:valueMap}});
    const name='dem-idb-values-'+ ++sequence;
    const provider=await adapter.open({model,name});
    try {await provider.createSchema();valueTranscript=await valueExercise({provider,assert});}
    finally {await provider.close();await remove(name);}
});

test('shared atomic command workload commits or rolls back all commands',async()=>{
    const env=await open({schema:atomicSchema,enforceRelations:true});
    try {atomicTranscript=await exerciseAtomic({provider:env.provider,assert});}
    finally {await env.close();}
});

test('shared long-key and arbitrary scalar string workload',async()=>{
    const env=await open({schema:extendedSchema,enforceRelations:true});
    try {extendedTranscript=await exerciseExtended({provider:env.provider,assert});}
    finally {await env.close();}
});

test('shared structural evolution and history workload',async()=>{
    const name='dem-idb-evolution-'+ ++sequence;
    try {evolutionTranscript=await exerciseEvolution({assert,open:async schema=>adapter.open({model:await compile(schema),name,enforceRelations:true})});}
    finally {await remove(name);}
});

test('native CryptoKey survives IndexedDB and key-only replacement', async () => {
    const c=new Container();
    c.addNamespaceRoot('TeqFw_Dem_',location.origin+'/dem/src','.mjs');
    c.addNamespaceRoot('TeqFw_Dem_IDb_',location.origin+'/src','.mjs');
    const registry=await c.get('TeqFw_Dem_Registry$');
    registry.register([...(await (await c.get('TeqFw_Dem_IDb_Type_CryptoKey_Provider$')).getDefinitions())]);
    registry.finalize();
    const model=(await (await c.get('TeqFw_Dem_Compile$')).exec({schemas:[{packageName:'crypto-test',filename:'schema.json',document:{$format:2,$namespace:'/crypto/',item:{attributes:[{name:'id',type:{name:'text'}},{name:'label',type:{name:'text'}},{name:'key',type:{name:'idb.CryptoKey'}},{name:'optional',type:{name:'idb.CryptoKey'},nullable:true}],primaryKey:['id'],uniqueKeys:{by_label:['label']}}}}]})).model;
    const handler=await c.get('TeqFw_Dem_IDb_Type_CryptoKey_Handler$');
    const runtime=(await c.get('TeqFw_Dem_Repository_Runtime$')).bind({model,registry,handlers:[handler]});
    const name='dem-idb-cryptokey-'+ ++sequence;
    const key1=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
    const key2=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
    const payload=new TextEncoder().encode('native key persistence');
    const signature=async key=>crypto.subtle.sign('HMAC',key,payload);
    const check=async (key,sig)=>crypto.subtle.verify('HMAC',key,sig,payload);
    let backend=await adapter.open({model,name,runtime});
    try {
        await backend.createSchema();
        const repo=await backend.get({path:'/crypto/item'});
        await repo.create({record:{id:'one',label:'before',key:key1}});
        await repo.create({record:{id:'nullable',label:'nullable',key:key1,optional:null}});
        assert.equal((await repo.read({key:{kind:'primary',values:{id:'nullable'}}})).record.optional,null);
        await assert.rejects(repo.create({record:{id:'duplicate',label:'before',key:key1}}),{code:'CONFLICT'});
        await backend.close();
        backend=await adapter.open({model,name,runtime});
        let row=(await (await backend.get({path:'/crypto/item'})).read({key:{kind:'primary',values:{id:'one'}}})).record;
        assert.equal(row.key.extractable,false); assert.equal(row.key.algorithm.name,'HMAC'); assert.equal(row.key.type,'secret');
        assert.ok(row.key.usages.includes('sign')); assert.ok(await check(row.key,await signature(key1)));
        const repo2=await backend.get({path:'/crypto/item'});
        await repo2.update({key:{kind:'primary',values:{id:'one'}},changes:{label:'after'}});
        row=(await repo2.read({key:{kind:'primary',values:{id:'one'}}})).record;
        assert.ok(await check(row.key,await signature(key1)));
        await repo2.update({key:{kind:'primary',values:{id:'one'}},changes:{key:key2}});
        await backend.close();
        backend=await adapter.open({model,name,runtime});
        const repo3=await backend.get({path:'/crypto/item'});
        row=(await repo3.read({key:{kind:'primary',values:{id:'one'}}})).record;
        assert.ok(await check(row.key,await signature(key2)));
        assert.equal(await check(row.key,await signature(key1)),false);
        await assert.rejects((await backend.get({path:'/crypto/item'})).create({record:{id:'bad',label:'bad',key:{type:'secret',algorithm:{name:'HMAC'},usages:['sign'],extractable:false}}}),{code:'INVALID_INPUT'});
        await assert.rejects(adapter.open({model,name:'missing-runtime-'+sequence}),{code:'UNSUPPORTED'});
        const otherModel=(await (await c.get('TeqFw_Dem_Compile$')).exec({schemas:[{packageName:'crypto-test',filename:'other.json',document:{$format:2,$namespace:'/other/',item:{attributes:[{name:'id',type:{name:'text'}},{name:'key',type:{name:'idb.CryptoKey'}}],primaryKey:['id']}}}]})).model;
        const otherRuntime=(await c.get('TeqFw_Dem_Repository_Runtime$')).bind({model:otherModel,registry,handlers:[handler]});
        await assert.rejects(adapter.open({model,name:'mismatched-'+sequence,runtime:otherRuntime}),{code:'INVALID_INPUT'});
        await assert.rejects(repo3.list({selection:{where:{kind:'call',operator:'eq',args:[{kind:'attr',name:'key'},{kind:'value',type:{name:'idb.CryptoKey'},value:key1}]}}}),{code:'INVALID_INPUT'});
        await assert.rejects(repo3.list({selection:{orderBy:[{attribute:'key',direction:'asc',nulls:'last'}]}}),{code:'INVALID_INPUT'});
        const nativeClone=globalThis.structuredClone;
        try {
            globalThis.structuredClone=value=>{if (value instanceof CryptoKey) throw new DOMException('clone failure','DataCloneError'); return nativeClone(value);};
            await assert.rejects(repo3.create({record:{id:'clone-failure',label:'clone-failure',key:key1}}),{code:'STORAGE'});
        } finally { globalThis.structuredClone=nativeClone; }
        await assert.rejects(backend.execute({operations:[
            {path:'/crypto/item',method:'create',params:{record:{id:'rolled-back',label:'rollback',key:key1}}},
            {path:'/crypto/item',method:'create',params:{record:{id:'duplicate',label:'rollback',key:key1}}},
        ]}),{code:'CONFLICT'});
        assert.equal((await repo3.read({key:{kind:'primary',values:{id:'rolled-back'}}})).record,null);
        assert.equal((await repo3.read({key:{kind:'primary',values:{id:'duplicate'}}})).record,null);
    } finally { await backend.close(); await remove(name); }
});

let applicationObservation;
test('unchanged application module through browser composition', async () => {
    applicationObservation = await runApplication();
    assert.equal(applicationObservation.transcript.inputUnchanged, true);
});

const results = [];
for (const {name,body} of cases) {
    try { await body(); results.push({name,passed:true}); }
    catch (error) { results.push({name,passed:false,error:(error.stack ?? String(error)) + (error.diagnostics ? JSON.stringify(error.diagnostics) : '')}); }
}
await fetch('/result',{method:'POST',body:JSON.stringify({results,applicationObservation,browser:navigator.userAgent,valueTranscript,atomicTranscript,extendedTranscript,evolutionTranscript})});
