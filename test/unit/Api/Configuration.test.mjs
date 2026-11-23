import {test} from 'node:test';
import assert from 'node:assert/strict';
import Configuration from '../../../src/Api/Configuration.mjs';

test('requires the host to select a configuration', async () => {
    const errors = {create: (/** @type {{code: string; message: string}} */ {code, message}) => Object.assign(new Error(message), {code})};
    const configuration = new Configuration({errors});
    await assert.rejects(configuration.get(), {code: 'UNSUPPORTED'});
});
