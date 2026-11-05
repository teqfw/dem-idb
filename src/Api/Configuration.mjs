// @ts-check
/**
 * @namespace TeqFw_Dem_IDb_Api_Configuration
 * @description Host-supplied IndexedDB adapter configuration.
 */
export default class Configuration {
    /**
     * @param {object} deps
     * @param {any} deps.errors
     */
    constructor({errors}) {
        /** @returns {Promise<any>} */
        this.get = async function () {
            throw errors.create({code: 'UNSUPPORTED', message: 'No IndexedDB configuration selected by the host.'});
        };
    }
}
export const __deps__ = Object.freeze({default: Object.freeze({errors: 'TeqFw_Dem_Repository_Error$'})});
