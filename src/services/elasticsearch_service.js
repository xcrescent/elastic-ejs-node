// services/elasticsearch_service.js
const connectionManager = require('./connection_manager');

class ElasticsearchService {

    static getClient(connectionId) {
        const connection = connectionManager.getConnection(connectionId);
        if (!connection) {
            throw new Error('Elasticsearch connection not found');
        }
        return connection.client;
    }

    static async listAllIndices(connectionId) {
        try {
            const client = this.getClient(connectionId);
            const response = await client.cat.indices({
                format: 'json',
                h: 'index,docs.count,store.size,status,health'
            });

            const indices = Array.isArray(response.body) ? response.body : response;
            return { success: true, data: indices };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getIndexMapping(connectionId, index) {
        try {
            const client = this.getClient(connectionId);
            const response = await client.indices.getMapping({ index });

            const result = {};
            const responseData = response.body || response;

            for (const idx in responseData) {
                if (responseData[idx].mappings) {
                    result[idx] = {
                        mappings: {
                            properties: responseData[idx].mappings.properties || {}
                        }
                    };
                }
            }

            return { success: true, data: result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getIndexStats(connectionId, index) {
        try {
            const client = this.getClient(connectionId);
            const response = await client.indices.stats({ index });
            const data = response.body || response;
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async searchDocuments(connectionId, index, query, size = 50, from = 0) {
        try {
            const client = this.getClient(connectionId);

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
            return { success: false, error: error.message };
        }
    }

    static async customQuery(connectionId, index, queryBody) {
        try {
            const client = this.getClient(connectionId);
            const parsedQuery = typeof queryBody === 'string' ? JSON.parse(queryBody) : queryBody;

            const response = await client.search({
                index,
                body: parsedQuery
            });

            const hits = response.hits || (response.body ? response.body.hits : null);
            const aggregations = response.aggregations || (response.body ? response.body.aggregations : null);

            if (!hits && !aggregations) {
                throw new Error('Unexpected response format from Elasticsearch');
            }

            return {
                success: true,
                data: hits ? hits.hits : [],
                total: hits ? hits.total.value : 0,
                aggregations: aggregations
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                query: typeof queryBody === 'string' ? queryBody : JSON.stringify(queryBody)
            };
        }
    }

    static async aggregateData(connectionId, index, field, size = 10) {
        try {
            const client = this.getClient(connectionId);

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
            return { success: false, error: error.message };
        }
    }

    static async createIndex(connectionId, indexName, mapping = {}) {
        try {
            const client = this.getClient(connectionId);
            const response = await client.indices.create({
                index: indexName,
                body: {
                    mappings: mapping
                }
            });

            return { success: true, data: response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // static async deleteIndex(connectionId, indexName) {
    //     try {
    //         const client = this.getClient(connectionId);
    //         const response = await client.indices.delete({
    //             index: indexName
    //         });

    //         return { success: true, data: response };
    //     } catch (error) {
    //         return { success: false, error: error.message };
    //     }
    // }
}

module.exports = ElasticsearchService;