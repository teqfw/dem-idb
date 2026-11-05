// @ts-check
/** @namespace TeqFw_DemIdb_Type_CryptoKey_Provider */
export default class Provider {
    constructor() {
        this.getDefinitions = function () { return [{
            name:'idb.CryptoKey', parameters:{},
            normalizeParams:(params) => { if (Object.keys(params).length) throw new TypeError('idb.CryptoKey has no parameters.'); return {}; },
            valueDomain:'A genuine native Web Crypto CryptoKey.',
            preservation:'Preserve native key capabilities and metadata through structured clone.',
            valueHandling:'Validate native CryptoKey values and copy them using structured clone.',
        }]; };
    }
}
