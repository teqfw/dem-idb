import type {DemModel, DemRepository, DemBatchOperation, DemBatchResult} from '@teqfw/dem';

export interface IdbConfiguration {
    model: DemModel;
    name: string;
    indexedDB?: IDBFactory;
    enforceRelations?: boolean;
}
export interface IdbBackend {
    execute(params: {operations: DemBatchOperation[]}): Promise<DemBatchResult>;
    createSchema(): Promise<{database: IDBDatabase; stores: Record<string, string>; version: number}>;
    get(params: {path: string}): Promise<DemRepository>;
    getSchemaHistory(): Promise<{schemas: {version: number; model: DemModel}[]}>;
    close(): Promise<void>;
}
export interface IdbAdapter {
    open(configuration: IdbConfiguration): Promise<IdbBackend>;
}
export interface IdbConfigurationProvider {
    get(): Promise<IdbConfiguration>;
}
declare global {
    type TeqFw_DemIdb_Adapter = import('./src/Adapter.mjs').default;
    type TeqFw_DemIdb_Adapter__Class = typeof import('./src/Adapter.mjs').default;
    type TeqFw_DemIdb_Api_Configuration = import('./src/Api/Configuration.mjs').default;
    type TeqFw_DemIdb_Api_Configuration__Class = typeof import('./src/Api/Configuration.mjs').default;
    type TeqFw_DemIdb_Provider = import('./src/Provider.mjs').default;
    type TeqFw_DemIdb_Provider__Class = typeof import('./src/Provider.mjs').default;
}
export {};
