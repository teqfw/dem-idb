import type {DemModel, DemRepository, DemBatchOperation, DemBatchResult} from '@teqfw/dem';

export interface IdbConfiguration {
    model: DemModel;
    name: string;
    indexedDB?: IDBFactory;
    enforceRelations?: true;
    /** DEM Runtime binding for models containing extension types. */
    runtime?: {model: DemModel; normalize: unknown; selection: unknown; select: unknown; batch: unknown};
}
export interface IdbBackend {
    execute(params: {operations: DemBatchOperation[]}): Promise<DemBatchResult>;
    createSchema(): Promise<{database: IDBDatabase; stores: Record<string, string>; version: number}>;
    get(params: {path: string}): Promise<DemRepository>;
    getSchemaHistory(): Promise<{schemas: {version: number; model: DemModel}[]}>;
    close(): Promise<void>;
}
export type IdbStorageInspection =
    | {kind: 'absent'}
    | {
        kind: 'existing';
        version: number;
        model: DemModel;
        fingerprint: string;
        schemas: {version: number; model: DemModel}[];
        matchesExpected: boolean | null;
    };
export interface IdbAdapter {
    open(configuration: IdbConfiguration): Promise<IdbBackend>;
    inspectStorage(input: {
        name: string;
        indexedDB?: IDBFactory;
        expectedModel?: DemModel;
    }): Promise<IdbStorageInspection>;
}
export interface IdbConfigurationProvider {
    get(): Promise<IdbConfiguration>;
}
declare global {
    type TeqFw_Dem_IDb_Adapter = import('./src/Adapter.mjs').default;
    type TeqFw_Dem_IDb_Adapter__Class = typeof import('./src/Adapter.mjs').default;
    type TeqFw_Dem_IDb_Api_Configuration = import('./src/Api/Configuration.mjs').default;
    type TeqFw_Dem_IDb_Api_Configuration__Class = typeof import('./src/Api/Configuration.mjs').default;
    type TeqFw_Dem_IDb_Provider = import('./src/Provider.mjs').default;
    type TeqFw_Dem_IDb_Provider__Class = typeof import('./src/Provider.mjs').default;
    type TeqFw_Dem_IDb_Type_CryptoKey_Handler = import('./src/Type/CryptoKey/Handler.mjs').default;
    type TeqFw_Dem_IDb_Type_CryptoKey_Handler__Class = typeof import('./src/Type/CryptoKey/Handler.mjs').default;
    type TeqFw_Dem_IDb_Type_CryptoKey_Provider = import('./src/Type/CryptoKey/Provider.mjs').default;
    type TeqFw_Dem_IDb_Type_CryptoKey_Provider__Class = typeof import('./src/Type/CryptoKey/Provider.mjs').default;
}
export {};
