export default function Preprocessor() {
    return function (id) {
        return id.address === 'TeqFw_Dem_Api_RepositoryProvider'
            ? {...id,address:'TeqFw_DemIdb_Provider'} : id;
    };
}
