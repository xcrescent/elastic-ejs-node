const {Client} = require("@elastic/elasticsearch");
const client = new Client({
    cloud: { id: process.env.ELASTIC_CLOUD_ID},
    auth: {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD
    }
});

// Elasticsearch service functions
class ElasticsearchService {
    static async getIndexMapping(index = 'ads') {
        try {

            const response = await client.indices.getMapping({ index });

            // Process the response structure correctly
            const result = {};
            // Handle different response structures in different ES versions
            if (response.body) {
                // Newer ES client versions
                for (const idx in response.body) {
                    if (response.body[idx].mappings && response.body[idx].mappings.properties) {
                        result[idx] = {
                            mappings: { properties: {} }
                        };

                        const properties = response.body[idx].mappings.properties;
                        for (const field in properties) {
                            if (properties[field].properties) {
                                result[idx].mappings.properties[field] = properties[field].properties;
                            } else {
                                result[idx].mappings.properties[field] = properties[field];
                            }
                        }
                    }
                }
            } else {
                // Older ES client versions
                for (const idx in response) {
                    if (response[idx].mappings && response[idx].mappings.properties) {
                        result[idx] = {
                            mappings: { properties: {} }
                        };

                        const properties = response[idx].mappings.properties;
                        for (const field in properties) {
                            if (properties[field].properties) {
                                result[idx].mappings.properties[field] = properties[field].properties;
                            } else {
                                result[idx].mappings.properties[field] = properties[field];
                            }
                        }
                    }
                }
            }

            return { success: true, data: result };
        } catch (error) {
            console.error(`Error getting mapping for index ${index}:`, error);
            return { success: false, error: error.message, context: 'getIndexMapping' };
        }
    }

    static async getIndexStats(index = 'ads') {
        try {
            const response = await client.indices.stats({ index });
            // Handle different response structures
            const data = response.body || response;

            return { success: true, data };
        } catch (error) {
            console.error(`Error getting stats for index ${index}:`, error);
            return { success: false, error: error.message, context: 'getIndexStats' };
        }
    }

    static async searchDocuments(index = 'ads', query, size = 50, from = 0) {
        try {
            const searchBody = query && query.trim() !== ''
                ? {
                    query: {
                        multi_match: {
                            query: query,
                            fields: ['*'],
                            fuzziness: 'AUTO'
                        }
                    }
                }
                : { query: { match_all: {} } };

            const response = await client.search({
                index,
                body: {
                    ...searchBody,
                    size: size,
                    from: from,
                }
            });

            // Handle different response structures
            const hits = response.hits || (response.body ? response.body.hits : null);

            if (!hits) {
                throw new Error('Unexpected response format from Elasticsearch');
            }

            if (hits.total.value === 0) {
                return { success: true, data: [], total: 0, message: 'No results found' };
            }

            if (hits.total.value > 10000) {
                return {
                    success: false,
                    error: 'Result set too large, please refine your query',
                    total: hits.total.value
                };
            }

            return {
                success: true,
                data: hits.hits,
                total: hits.total.value
            };
        } catch (error) {
            console.error(`Error searching documents in index ${index}:`, error);
            return { success: false, error: error.message, context: 'searchDocuments' };
        }
    }

    static async customQuery(index = 'ads', queryBody) {
        try {
            // Parse queryBody if it's a string, otherwise use as is
            const parsedQuery = typeof queryBody === 'string' ? JSON.parse(queryBody) : queryBody;

            const response = await client.search({
                index,
                body: parsedQuery
            });

            // Handle different response structures
            const hits = response.hits || (response.body ? response.body.hits : null);

            if (!hits) {
                throw new Error('Unexpected response format from Elasticsearch');
            }

            return {
                success: true,
                data: hits.hits,
                total: hits.total.value
            };
        } catch (error) {
            console.error(`Error executing custom query on index ${index}:`, error);
            return {
                success: false,
                error: error.message,
                context: 'customQuery',
                query: typeof queryBody === 'string' ? queryBody : JSON.stringify(queryBody)
            };
        }
    }

    static async aggregateData(index = 'ads', field, size = 10) {
        try {
            if (!field) {
                throw new Error('Field name is required for aggregation');
            }

            const response = await client.search({
                index,
                body: {
                    size: 0,
                    aggs: {
                        field_aggregation: {
                            terms: {
                                field: field,
                                size: size
                            }
                        }
                    }
                }
            });

            // Handle different response structures
            const aggregations = response.aggregations ||
                (response.body ? response.body.aggregations : null);

            if (!aggregations || !aggregations.field_aggregation) {
                throw new Error('Unexpected response format from Elasticsearch');
            }

            return {
                success: true,
                data: aggregations.field_aggregation.buckets
            };
        } catch (error) {
            console.error(`Error aggregating data on field ${field} in index ${index}:`, error);
            return { success: false, error: error.message, context: 'aggregateData' };
        }
    }
}

module.exports = ElasticsearchService;