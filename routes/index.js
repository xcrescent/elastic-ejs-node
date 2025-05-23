const express = require('express');
const router = express.Router();
const moment = require('moment');
const ElasticsearchService = require('../services/elastic_search_service');
const { Client } = require('@elastic/elasticsearch');

// Create client for health check
const client = new Client({
  cloud: { id: process.env.ELASTICSEARCH_URL},
  auth: {
    username: process.env.ES_USERNAME,
    password: process.env.ES_PASSWORD
  }
});

// Get index from environment or use default
const DEFAULT_INDEX = process.env.ELASTICSEARCH_INDEX || 'ads';

// Routes
router.get('/', async (req, res) => {
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
});

router.get('/search', async (req, res) => {
  const { q, size = 50, page = 1, index = DEFAULT_INDEX } = req.query;
  const from = (page - 1) * parseInt(size);

  try {
    const result = await ElasticsearchService.searchDocuments(index, q, parseInt(size), from);

    res.render('search', {
      result: result,
      query: q || '',
      size: parseInt(size),
      page: parseInt(page),
      totalPages: result.success ? Math.ceil(result.total / parseInt(size)) : 0,
      moment: moment,
      currentIndex: index
    });
  } catch (error) {
    console.error('Error in search route:', error);
    res.render('search', {
      result: { success: false, error: error.message },
      query: q || '',
      size: parseInt(size),
      page: parseInt(page),
      totalPages: 0,
      moment: moment,
      currentIndex: index
    });
  }
});

router.get('/browse', async (req, res) => {
  const { size = 20, page = 1, index = DEFAULT_INDEX } = req.query;
  const from = (page - 1) * parseInt(size);

  try {
    const result = await ElasticsearchService.searchDocuments(index, '', parseInt(size), from);
    console.log(result);
    console.log(size)
    console.log(page)
    console.log(index)

    res.render('browse', {
      result: result,
      size: parseInt(size),
      page: parseInt(page),
      totalPages: result.success ? Math.ceil(result.total / parseInt(size)) : 0,
      moment: moment,
      currentIndex: index
    });
  } catch (error) {
    console.error('Error in browse route:', error);
    res.render('browse', {
      result: { success: false, error: error.message },
      size: parseInt(size),
      page: parseInt(page),
      totalPages: 0,
      moment: moment,
      currentIndex: index
    });
  }
});

router.get('/custom', async (req, res) => {
  const index = req.query.index || DEFAULT_INDEX;
  res.render('custom', {
    result: null,
    currentIndex: index
  });
});

router.post('/custom', async (req, res) => {
  const { query, index = DEFAULT_INDEX } = req.body;

  try {
    const result = await ElasticsearchService.customQuery(index, query);

    res.render('custom', {
      result: result,
      query: query,
      currentIndex: index
    });
  } catch (error) {
    console.error('Error in custom query route:', error);
    res.render('custom', {
      result: { success: false, error: error.message },
      query: query,
      currentIndex: index
    });
  }
});

router.get('/aggregate', async (req, res) => {
  const index = req.query.index || DEFAULT_INDEX;

  try {
    const mappingResult = await ElasticsearchService.getIndexMapping(index);

    // Get fields from the mapping result
    let fields = [];
    if (mappingResult.success && mappingResult.data[index]) {
      fields = Object.keys(mappingResult.data[index].mappings.properties || {});
    }

    res.render('aggregate', {
      result: null,
      fields: fields,
      currentIndex: index
    });
  } catch (error) {
    console.error('Error in aggregate route:', error);
    res.render('aggregate', {
      result: { success: false, error: error.message },
      fields: [],
      currentIndex: index
    });
  }
});

router.post('/aggregate', async (req, res) => {
  const { field, size = 10, index = DEFAULT_INDEX } = req.body;

  try {
    const result = await ElasticsearchService.aggregateData(index, field, parseInt(size));

    const mappingResult = await ElasticsearchService.getIndexMapping(index);

    // Get fields from the mapping result
    let fields = [];
    if (mappingResult.success && mappingResult.data[index]) {
      fields = Object.keys(mappingResult.data[index].mappings.properties || {});
    }

    res.render('aggregate', {
      result: result,
      fields: fields,
      selectedField: field,
      selectedSize: parseInt(size),
      currentIndex: index
    });
  } catch (error) {
    console.error('Error in aggregate post route:', error);
    res.render('aggregate', {
      result: { success: false, error: error.message },
      fields: [],
      selectedField: field,
      selectedSize: parseInt(size),
      currentIndex: index
    });
  }
});

router.get('/api/health', async (req, res) => {
  try {
    const health = await client.cluster.health();
    // Handle different response structures
    const healthData = health.body || health;

    res.json({ status: 'ok', elasticsearch: healthData });
  } catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;