import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('package metadata identifies the browser adapter foundation', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.name, '@teqfw/dem-idb');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.license, 'Apache-2.0');
    assert.equal(pkg.dependencies['@teqfw/dem'], '^0.2.0');
});
