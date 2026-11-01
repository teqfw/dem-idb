// @ts-check
import Container from '/di/dist/esm.js';
import {source} from '/dem/conformance/application/Schema.mjs';

/** Host-owned configuration, initialized before application resolution. */
export class Configuration {
    constructor() {
        let options;
        this.set = value => { options = value; };
        this.get = async () => { if (!options) throw new Error('Host is not configured.'); return options; };
    }
}
/** Select the provider implementation and host configuration through DI. */
export function Preprocessor() {
    return id => id.address === 'TeqFw_Dem_Api_RepositoryProvider'
        ? {...id, address: 'TeqFw_DemIdb_Provider'}
        : id.address === 'TeqFw_DemIdb_Api_Configuration'
            ? {...id, address: 'Host_Browser', exportName: 'Configuration'} : id;
}

/** Execute the unchanged application through browser-only host composition. */
export async function run() {
    const name = 'dem-application-' + crypto.randomUUID();
    const applicationUrl = location.origin + '/dem/conformance/application/Workflow.mjs';
    const container = new Container({namespaces: [
        {prefix: 'TeqFw_Dem_', target: location.origin + '/dem/src', defaultExt: '.mjs'},
        {prefix: 'TeqFw_DemIdb_', target: location.origin + '/src', defaultExt: '.mjs'},
        {prefix: 'Demo_', target: location.origin + '/dem/conformance/application', defaultExt: '.mjs'},
        {prefix: 'Host_', target: location.origin + '/test/browser/application', defaultExt: '.mjs'},
    ], preprocessors: ['Host_Browser__Preprocessor$']});
    let backend, provider;
    try {
        const compiler = await container.get('TeqFw_Dem_Compile$');
        const {model, fingerprint} = await compiler.exec({schemas: [source]});
        const configuration = await container.get('Host_Browser__Configuration$');
        configuration.set({model, name, enforceRelations: true});
        const adapter = await container.get('TeqFw_DemIdb_Adapter$');
        backend = await adapter.open(await configuration.get());
        await backend.createSchema();
        provider = await container.get('TeqFw_Dem_Api_RepositoryProvider$');
        const application = await container.get('Demo_Workflow$');
        const transcript = await application.exec({model});
        const response = await fetch(applicationUrl);
        if (!response.ok) throw new Error('Cannot inspect shared application source.');
        const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        const applicationHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return {model, fingerprint, transcript, applicationHash};
    } finally {
        try { try { await provider?.close(); } finally { await backend?.close(); } }
        finally {
            await new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(name);
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Application database cleanup is blocked.'));
            });
        }
    }
}
