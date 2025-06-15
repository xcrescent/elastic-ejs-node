const moment = require('moment');
const ElasticsearchService = require('../services/elasticsearch_service');
const client = require('../config/elasticConfig');
// Get index from environment or use default
const DEFAULT_INDEX = process.env.ELASTICSEARCH_INDEX || 'ads';
class IndexController {

    async getIndex() {
        const index = await client.indices.get({ index: 'ads' });
        return index;
    }

    async getHomePage(req, res) {
        try {
            const index = req.query.index || DEFAULT_INDEX;

            const [mappingResult, statsResult] = await Promise.all([
                ElasticsearchService.getIndexMapping(index),
                ElasticsearchService.getIndexStats(index)
            ]);

            // Get fields from the mapping result
            let fields = [];
            if (mappingResult.success && mappingResult.data[index]) {
                fields = Object.keys(mappingResult.data[index].mappings.properties || {});
            }

            res.render('index', {
                mapping: mappingResult,
                stats: statsResult,
                fields: fields,
                moment: moment,
                currentIndex: index
            });
            console.log(mappingResult, statsResult, fields, index);
        } catch (error) {
            console.error('Error in index route:', error);
            res.render('index', {
                mapping: { success: false, error: error.message },
                stats: { success: false, error: error.message },
                fields: [],
                moment: moment,
                currentIndex: req.query.index || DEFAULT_INDEX
            });
        }
    }
}

module.exports = new IndexController();