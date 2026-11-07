import assert from 'node:assert/strict';
import {test} from 'node:test';
import Provider from '../../../../src/Type/CryptoKey/Provider.mjs';

test('CryptoKey provider publishes one parameterless definition',()=>{
    const provider=new Provider();
    const [definition]=provider.getDefinitions();

    assert.equal(definition.name,'idb.CryptoKey');
    assert.deepEqual(definition.parameters,{});
    assert.deepEqual(definition.normalizeParams({}),{});
    assert.throws(()=>definition.normalizeParams({unknown:true}),/no parameters/i);
    assert.match(definition.valueDomain,/native Web Crypto CryptoKey/);
});
