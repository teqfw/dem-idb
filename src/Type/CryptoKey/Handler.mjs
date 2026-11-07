// @ts-check
/**
 * @namespace TeqFw_Dem_IDb_Type_CryptoKey_Handler
 * @description DEM Runtime handler that preserves native CryptoKey values through structured cloning.
 */
export default class Handler {
    /**
     * @param {object} deps
     * @param {TeqFw_Dem_Repository_Error} deps.errors
     */
    constructor({errors}) {
        /** @returns {TeqFw_Dem_RepositoryError} */
        const unsupported = function () {return errors.create({code:'UNSUPPORTED',message:'Native CryptoKey and structuredClone are required.'});};
        /** @param {any} value @returns {any} */
        const clone = function (value) {
            if (typeof globalThis.CryptoKey !== 'function' || typeof globalThis.structuredClone !== 'function') throw unsupported();
            const getter=Object.getOwnPropertyDescriptor(globalThis.CryptoKey.prototype,'type')?.get;
            if (typeof getter !== 'function') throw unsupported();
            try { getter.call(value); } catch { throw errors.create({code:'INVALID_INPUT',message:'Expected a native CryptoKey.'}); }
            try { return globalThis.structuredClone(value); }
            catch { throw errors.create({code:'STORAGE',message:'Cannot structured-clone CryptoKey.'}); }
        };
        this.name='idb.CryptoKey';
        /** @param {any} value @param {Record<string,any>} _params @returns {any} */
        this.normalize=function (value, _params) {return clone(value);};
        /** @param {any} value @param {Record<string,any>} _params @returns {any} */
        this.copy=function (value, _params) {return clone(value);};
    }
}
export const __deps__=Object.freeze({default:Object.freeze({errors:'TeqFw_Dem_Repository_Error$'})});
