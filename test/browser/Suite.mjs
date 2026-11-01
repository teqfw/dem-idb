import {run as runApplication} from './application/Browser.mjs';
import Container from '/di/dist/esm.js';
import {register} from '/dem/conformance/Repository.mjs';
import {schema as valueSchema,map as valueMap,exercise as valueExercise,atomicSchema,exerciseAtomic,extendedSchema,exerciseExtended,exerciseEvolution} from '/dem/conformance/Values.mjs';

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
container.addNamespaceRoot('TeqFw_DemIdb_', location.origin + '/src', '.mjs');
const compiler = await container.get('TeqFw_Dem_Compile$');
const adapter = await container.get('TeqFw_DemIdb_Adapter$');
const selection = await container.get('TeqFw_Dem_Dto_Query_Selection__Factory$');
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
const simple = {$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}};
const key = id => ({kind:'primary',values:{id}});

test('schema history, idempotence, additive defaults and persistence after reopen', async () => {
    const env = await open({schema:simple});
    let second;
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'before'}});
        assert.equal((await env.provider.createSchema()).version,1);
        await env.provider.close();
        const updated = structuredClone(simple);
        updated['/app/item'].attributes.push({name:'note',type:{name:'text'},default:'new'});
        second = await adapter.open({model:await compile(updated),name:env.name});
        const result = await second.createSchema();
        assert.equal(result.version,2);
        const tx = result.database.transaction('dem_schema','readonly');
        const history = await new Promise(resolve => { const req = tx.objectStore('dem_schema').getAll(); req.onsuccess = () => resolve(req.result); });
        assert.equal(history.length,2);
        assert.equal((await (await second.get({path:'/app/item'})).read({key:key('1')})).record.note,'new');
        await second.close();
        second = await adapter.open({model:await compile(updated),name:env.name});
        assert.equal((await (await second.get({path:'/app/item'})).list({selection:{}})).records.length,1);
    } finally { await second?.close(); await env.close(); }
});

test('all logical value types round-trip and decimals and integers compare exactly', async () => {
    const schema = {$format:1,'/app/data':{attributes:[
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
    const schema = {$format:1,'/app/parent':{attributes:[{name:'id',type:{name:'identity'}}]},'/app/child':{attributes:[{name:'owner',type:{name:'ref'}}],relations:{owner:{attributes:['owner'],target:{path:'/app/parent',attributes:['id']}}}}};
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
    const changed = structuredClone(simple); changed['/app/item'].attributes.push({name:'added',type:{name:'text'},nullable:true});
    const other = await adapter.open({model:await compile(changed),name:env.name});
    try { await assert.rejects(other.get({path:'/app/item'}),{code:'UNSUPPORTED'}); }
    finally { await other.close(); await env.close(); }
});

test('Unicode scalar ordering, null placement and zero limit', async () => {
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'},nullable:true}]}}});
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
    const schema = {$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true}]}};
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
    const schema = structuredClone(simple); schema['/app/item'].uniqueKeys = {name:['name']};
    const env = await open({schema});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'same'}});
        await assert.rejects(repo.create({record:{id:'1000',name:'same'}}),{code:'CONFLICT'});
        assert.equal((await repo.create({record:{name:'next'}})).record.id,'2');
    } finally { await env.close(); }
});

test('schema updates invalidate old providers and retain removed stores', async () => {
    const env = await open({schema:simple}); let newer;
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{name:'retained'}});
        const schema = {$format:1,'/app/other':{attributes:[{name:'label',type:{name:'text'}}]}};
        newer = await adapter.open({model:await compile(schema),name:env.name});
        const initialized = await newer.createSchema();
        assert.ok(initialized.database.objectStoreNames.contains('dem:/app/item'));
        await assert.rejects(repo.list({selection:{}}),{code:'STORAGE'});
        const tx = initialized.database.transaction('dem:/app/item');
        const old = await new Promise(resolve => { const req = tx.objectStore('dem:/app/item').getAll(); req.onsuccess = () => resolve(req.result); });
        assert.equal(old[0].name,'retained');
    } finally { await newer?.close(); await env.close(); }
});

test('incompatible native store aborts upgrade without changing history or data', async () => {
    const name = 'dem-idb-bad-layout-' + ++sequence;
    const raw = await new Promise((resolve,reject) => {
        const req = indexedDB.open(name,1);
        req.onupgradeneeded = () => req.result.createObjectStore('dem:/app/item',{keyPath:'id'}).add({id:1,name:'retained'});
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    raw.close();
    const backend = await adapter.open({model:await compile(simple),name});
    try {
        await assert.rejects(backend.createSchema(),{code:'UNSUPPORTED'});
        const db = await new Promise(resolve => { const req=indexedDB.open(name); req.onsuccess=()=>resolve(req.result); });
        assert.equal(db.version,1); assert.equal(db.objectStoreNames.contains('dem_schema'),false); db.close();
    } finally { await backend.close(); await remove(name); }
});

test('blocked upgrades reject and do not apply after the blocker closes', async () => {
    const env = await open({schema:simple}); let other;
    const blocker = await new Promise(resolve => { const req=indexedDB.open(env.name); req.onsuccess=()=>resolve(req.result); });
    try {
        const schema=structuredClone(simple); schema['/app/item'].attributes.push({name:'new_field',type:{name:'text'},nullable:true});
        other=await adapter.open({model:await compile(schema),name:env.name});
        await assert.rejects(other.createSchema(),{code:'STORAGE'});
        blocker.close();
        // A following open is queued after the rejected upgrade; its version must remain unchanged.
        const db=await new Promise(resolve=>{const req=indexedDB.open(env.name);req.onsuccess=()=>resolve(req.result);});
        assert.equal(db.version,1); db.close();
    } finally { blocker.close(); await other?.close(); await env.close(); }
});

test('self relations and nullable unique keys preserve repository semantics', async () => {
    const schema = {$format:1,'/app/node':{attributes:[{name:'id',type:{name:'identity'}},{name:'parent',type:{name:'ref'},nullable:true}],uniqueKeys:{parent:['parent']},relations:{parent:{attributes:['parent'],target:{path:'/app/node',attributes:['id']}}}}};
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
    c.addNamespaceRoot('TeqFw_DemIdb_',location.origin+'/src','.mjs');
    c.enableTestMode();
    c.register('TeqFw_DemIdb_Api_Configuration$',{get:async()=>({model:env.model,name:env.name})});
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
    schema['/app/item'].attributes.push({name:'flag',type:{name:'boolean'}},{name:'payload',type:{name:'json'}});
    schema['/app/item'].uniqueKeys={name:['name'],flag:['flag'],payload:['payload']};
    const env=await open({schema});
    const originalStore=IDBObjectStore.prototype.getAll,originalIndex=IDBIndex.prototype.getAll;
    let scans=0,indexReads=0;
    try {
        const repo=await env.provider.get({path:'/app/item'});
        const a=(await repo.create({record:{name:'Ada',flag:true,payload:{n:1}}})).record;
        await repo.create({record:{name:'B',flag:false,payload:{n:2}}});
        IDBObjectStore.prototype.getAll=function (...args) {if(this.name==='dem:/app/item') scans++;return originalStore.apply(this,args);};
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

test('lookup planning falls back when additive defaults are absent in old raw records',async()=>{
    const env=await open({schema:simple});let next;
    try {
        await (await env.provider.get({path:'/app/item'})).create({record:{name:'old'}});
        const schema=structuredClone(simple);
        schema['/app/item'].attributes.push({name:'category',type:{name:'text'},default:'default'});
        schema['/app/item'].indexes={category:{attributes:['category']}};
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
        const schema=structuredClone(simple);schema['/app/item'].indexes={name:{attributes:['name']}};
        next=await adapter.open({model:await compile(schema),name:env.name});await next.createSchema();
        const repo=await next.get({path:'/app/item'});
        IDBObjectStore.prototype.getAll=function (...args) {if(this.name==='dem:/app/item') scans++;return originalStore.apply(this,args);};
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
