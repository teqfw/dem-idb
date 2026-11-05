// @ts-check
/** @namespace TeqFw_DemIdb_Type_CryptoKey_Handler */
export default class Handler {
    /** @param {{errors:any}} deps */
    constructor({errors}) {
        const unsupported = () => errors.create({code:'UNSUPPORTED',message:'Native CryptoKey and structuredClone are required.'});
        const clone = (value) => {
            if (typeof globalThis.CryptoKey !== 'function' || typeof globalThis.structuredClone !== 'function') throw unsupported();
            const getter=Object.getOwnPropertyDescriptor(globalThis.CryptoKey.prototype,'type')?.get;
            if (typeof getter !== 'function') throw unsupported();
            try { getter.call(value); } catch { throw errors.create({code:'INVALID_INPUT',message:'Expected a native CryptoKey.'}); }
            try { return globalThis.structuredClone(value); }
            catch { throw errors.create({code:'STORAGE',message:'Cannot structured-clone CryptoKey.'}); }
        };
        this.name='idb.CryptoKey';
        this.normalize=(value, _params) => clone(value);
        this.copy=(value, _params) => clone(value);
    }
}
export const __deps__=Object.freeze({default:Object.freeze({errors:'TeqFw_Dem_Repository_Error$'})});
