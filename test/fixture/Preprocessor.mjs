export default function Preprocessor() {
    return function (/** @type {{address: string}} */ id) {
        return ['TeqFw_Dem_Api_RepositoryProvider','TeqFw_Dem_Api_RepositoryBatch'].includes(id.address)
            ? {...id,address:'TeqFw_Dem_IDb_Provider'} : id;
    };
}
