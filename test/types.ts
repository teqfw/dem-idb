import type {IdbAdapter, IdbConfiguration, IdbBackend} from '../types.js';
import Adapter from '../src/Adapter.mjs';
declare const deps: ConstructorParameters<typeof Adapter>[0];
declare const configuration: IdbConfiguration;
const adapter: IdbAdapter = new Adapter(deps);
const backend: Promise<IdbBackend> = adapter.open(configuration);
void backend;
