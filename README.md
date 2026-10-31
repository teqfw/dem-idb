# @teqfw/dem-idb

A planned browser IndexedDB persistence adapter for models compiled by [@teqfw/dem](https://github.com/teqfw/dem).

This repository currently contains package and project-context foundations only. IndexedDB access, a repository provider, model projection, transactions, configuration and integration APIs are not implemented. The package is not yet usable as a DEM persistence provider.

DEM owns logical model composition and repository semantics. The host application will own integration and database lifecycle. Storage mapping, supported capabilities and browser compatibility remain to be designed and verified before implementation.

## Development

Run `npm run verify` to check the package foundations and type declarations. The package context is maintained separately in `ctx/`. No browser or persistence tests exist yet.

## License

Apache-2.0.
