// @ts-check
/**
 * @namespace TeqFw_DemIdb_Provider
 * @description Resolve DEM repositories using host-supplied adapter configuration.
 */
export default class Provider {
    /**
     * @param {object} deps
     * @param {any} deps.adapter
     * @param {any} deps.errors
     * @param {any} deps.configuration
     */
    constructor({adapter, configuration, errors}) {
        let pending;
        let closed = false;
        /**
         * @param {any} params
         * @returns {Promise<any>}
         */
        this.get = async function (params) {
            if (closed) throw errors.create({code:'STORAGE',message:'Provider is closed.'});
            if (!pending) pending = Promise.resolve().then(() => configuration.get()).then(options => adapter.open(options));
            return (await pending).get(params);
        };
        /** @returns {Promise<void>} */
        this.close = async function () {
            closed = true;
            if (pending) await (await pending).close();
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({errors: 'TeqFw_Dem_Repository_Error$', adapter: 'TeqFw_DemIdb_Adapter$', configuration: 'TeqFw_DemIdb_Api_Configuration$'})});
