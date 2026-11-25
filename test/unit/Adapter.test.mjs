import {test} from 'node:test';
import assert from 'node:assert/strict';
import Adapter from '../../src/Adapter.mjs';

/** @type {{create: (input: {code: string; message: string}) => Error & {name: string; code: string}}} */
const errors = {create: ({code,message}) => Object.assign(new Error(message),{name:'DemRepositoryError',code})};
/** @type {any} */
const adapter = new Adapter({errors,normalize:{},selection:{},evaluate:{},batch:{},demCanonical:{exec:(/** @type {any} */ value)=>value},fingerprint:{exec:()=>''}});

test('rejects missing configuration before opening storage', async () => {
    await assert.rejects(adapter.open({model:null,name:'test',indexedDB:{}}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model:{entities:{}},name:'',indexedDB:{}}),{code:'INVALID_INPUT'});
});

test('rejects unsupported generation before opening storage', async () => {
    const model = {entities:{'/app/item':{attributes:[{name:'created',type:{name:'date'},generation:true}]}}};
    await assert.rejects(adapter.open({model,name:'test',indexedDB:{open:()=>assert.fail('must not open')}}),{code:'UNSUPPORTED'});
});

test('rejects non-integer identity profiles from a direct model before opening storage', async () => {
    const model={entities:{'/app/item':{
        attributes:[{name:'id',type:{name:'identity',profile:{type:'uuid'}},nullable:false,generation:true}],
        primaryKey:['id'],uniqueKeys:{},indexes:{},relations:{},
    }}};
    await assert.rejects(adapter.open({model,name:'test',indexedDB:{open:()=>assert.fail('Storage must not be opened.')}}),{code:'UNSUPPORTED'});
});

test('closed backend rejects schema initialization and repository access', async () => {
    const backend = await adapter.open({model:{entities:{'/app/item':{attributes:[]}}},name:'test',indexedDB:{}});
    await backend.close();
    await assert.rejects(backend.createSchema(),{code:'STORAGE'});
    await assert.rejects(backend.get({path:'/app/item'}),{code:'STORAGE'});
});
