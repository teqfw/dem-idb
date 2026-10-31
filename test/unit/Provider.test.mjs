import {test} from 'node:test';
import assert from 'node:assert/strict';
import Provider from '../../src/Provider.mjs';

test('shares one configuration and adapter opening between concurrent resolutions', async () => {
    let configurations = 0;
    let openings = 0;
    const provider = new Provider({
        configuration: {get: async () => { configurations++; return {name: 'host'}; }},
        adapter: {open: async options => {
            openings++;
            assert.deepEqual(options, {name: 'host'});
            return {get: async params => params.path};
        }},
    });
    assert.deepEqual(await Promise.all([provider.get({path: '/a'}), provider.get({path: '/b'})]), ['/a', '/b']);
    assert.equal(configurations, 1);
    assert.equal(openings, 1);
});

test('propagates configuration failures without opening an adapter', async () => {
    const failure = new Error('missing configuration');
    const provider = new Provider({configuration: {get: async () => { throw failure; }}, adapter: {open: () => assert.fail('unexpected open')}});
    await assert.rejects(provider.get({path: '/a'}), error => error === failure);
});


test('closing a provider releases its backend and prevents reopening', async () => {
    let closes = 0;
    const provider = new Provider({
        errors: {create: ({code,message}) => Object.assign(new Error(message),{code})},
        configuration: {get: async () => ({})},
        adapter: {open: async () => ({get: async () => ({}), close: async () => { closes++; }})},
    });
    await provider.get({path:'/a'});
    await provider.close();
    assert.equal(closes,1);
    await assert.rejects(provider.get({path:'/a'}),{code:'STORAGE'});
});
