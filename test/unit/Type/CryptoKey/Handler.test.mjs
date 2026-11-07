import assert from 'node:assert/strict';
import {test} from 'node:test';
import {webcrypto} from 'node:crypto';
import Handler from '../../../../src/Type/CryptoKey/Handler.mjs';

const errors=/** @type {any} */ ({create:(/** @type {{code:string,message:string}} */ {code,message})=>Object.assign(new Error(message),{name:'DemRepositoryError',code})});

test('CryptoKey handler clones real keys and rejects lookalikes',async()=>{
    const handler=new Handler({errors});
    const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
    const cloned=handler.normalize(key,{});
    assert.notEqual(cloned,key);
    assert.equal(cloned.type,'secret');
    assert.equal(cloned.extractable,false);
    assert.equal(cloned.algorithm.name,'HMAC');
    assert.deepEqual(cloned.usages,['sign','verify']);
    const signature=await webcrypto.subtle.sign('HMAC',cloned,new TextEncoder().encode('ok'));
    assert.equal(await webcrypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode('ok')),true);
    assert.throws(()=>handler.normalize({type:'secret',algorithm:{name:'HMAC'},usages:['sign'],extractable:false},{}),{code:'INVALID_INPUT'});
});

test('CryptoKey handler distinguishes missing capabilities and clone failures',async()=>{
    const handler=new Handler({errors});
    const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
    const original=globalThis.structuredClone;
    try {
        globalThis.structuredClone=()=>{throw new DOMException('clone failed','DataCloneError');};
        assert.throws(()=>handler.normalize(key,{}),{code:'STORAGE'});
        /** @type {any} */ (globalThis).structuredClone=undefined;
        assert.throws(()=>handler.normalize(key,{}),{code:'UNSUPPORTED'});
    } finally { globalThis.structuredClone=original; }
});
