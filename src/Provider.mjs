// @ts-check
/**
 * @namespace TeqFw_Dem_IDb_Provider
 * @description Host-selected repository and atomic batch provider.
 */
export default class Provider {
    /**
     * @param {object} deps
     * @param {any} deps.adapter
     * @param {any} deps.configuration
     * @param {any} deps.errors
     */
    constructor({adapter,configuration,errors}) {
        let pending,closed=false;
        /** @returns {Promise<any>} */
        const backend=async function () {
            if (closed) throw errors.create({code:'STORAGE',message:'Provider is closed.'});
            if (!pending) pending=Promise.resolve().then(()=>configuration.get()).then(options=>adapter.open(options));
            return pending;
        };
        /** @param {any} params @returns {Promise<any>} */
        this.get=async function (params) {return (await backend()).get(params);};
        /** @param {any} params @returns {Promise<any>} */
        this.execute=async function (params) {return (await backend()).execute(params);};
        /** @returns {Promise<void>} */
        this.close=async function () {closed=true;if (pending) await (await pending).close();};
    }
}
export const __deps__=Object.freeze({default:Object.freeze({adapter:'TeqFw_Dem_IDb_Adapter$',configuration:'TeqFw_Dem_IDb_Api_Configuration$',errors:'TeqFw_Dem_Repository_Error$'})});
