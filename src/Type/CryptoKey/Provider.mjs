// @ts-check
/**
 * @namespace TeqFw_Dem_IDb_Type_CryptoKey_Provider
 * @description Supplies the DEM type definition for native IndexedDB CryptoKey values.
 */
export default class Provider {
    /** No dependencies are required. */
    constructor() {
        /** @returns {Array<Record<string,any>>} */
        this.getDefinitions = function () { return [{
            name:'idb.CryptoKey', parameters:{},
            normalizeParams:(/** @type {Record<string,any>} */ params) => { if (Object.keys(params).length) throw new TypeError('idb.CryptoKey has no parameters.'); return {}; },
            valueDomain:'A genuine native Web Crypto CryptoKey.',
            preservation:'Preserve native key capabilities and metadata through structured clone.',
            valueHandling:'Validate native CryptoKey values and copy them using structured clone.',
        }]; };
    }
}
