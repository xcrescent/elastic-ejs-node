const express = require('express');
const router = express.Router();
const moment = require('moment');
const ElasticsearchService = require('../services/elastic_search_service');
const RideLocationHistoryFetcher = require('../services/RideLocationHistoryFetcher');
const { Client } = require('@elastic/elasticsearch');
const esConfig ={
  cloud: { id: process.env.ELASTIC_CLOUD_ID},
  auth: {
    username: process.env.ELASTIC_USERNAME,
    password: process.env.ELASTIC_PASSWORD
  }
};
// Create client for health check
const client = new Client(esConfig);
const fetcher = new RideLocationHistoryFetcher(esConfig);

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

// Routes
router.get('/ride-log-history', (req, res) => {
  res.render('rideLogHistory', {
    title: 'Ride Location Dashboard',
    moment: moment
  });
});

router.post('/api/search', async (req, res) => {
  try {
    const { driverId, timeRange, customStart, customEnd, recordLimit } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: 'Driver ID is required' });
    }

    let result;
    const options = { size: parseInt(recordLimit) || 500 };

    switch (timeRange) {
      case 'last24h':
        result = await fetcher.getRecentRideLocationHistory(driverId, 24, options);
        break;
      case 'last7d':
        result = await fetcher.getRecentRideLocationHistory(driverId, 168, options);
        break;
      case 'custom':
        if (!customStart || !customEnd) {
          return res.status(400).json({ error: 'Custom date range requires both start and end dates' });
        }
        result = await fetcher.getRideLocationHistoryByTimeRange(driverId, customStart, customEnd, options);
        break;
      default:
        result = await fetcher.getRecentRideLocationHistory(driverId, 24, options);
    }

    res.json(result);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
});

router.get('/api/driver/:driverId/recent', async (req, res) => {
  try {
    const { driverId } = req.params;
    const hours = parseInt(req.query.hours) || 24;
    const size = parseInt(req.query.size) || 100;

    const result = await fetcher.getRecentRideLocationHistory(driverId, hours, { size });
    res.json(result);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
});
module.exports = router;