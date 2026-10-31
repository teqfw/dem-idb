import {test} from 'node:test';
import assert from 'node:assert/strict';
import Configuration from '../../../src/Api/Configuration.mjs';

test('requires the host to select a configuration', async () => {
    const configuration = new Configuration({errors: {create: ({code, message}) => Object.assign(new Error(message), {code})}});
    await assert.rejects(configuration.get(), {code: 'UNSUPPORTED'});
});
