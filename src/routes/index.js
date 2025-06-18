// routes/index.js
const express = require('express');
const router = express.Router();
const moment = require('moment');
const ElasticsearchService = require('../services/elasticsearch_service');
const connectionManager = require('../services/connection_manager');
const fetcher = require('../services/RideLocationHistoryFetcher');

// Dashboard home
router.get('/', async (req, res) => {
  try {
    const connections = connectionManager.getAllConnections();
    const hasConnections = Object.keys(connections).length > 0;

    let dashboardData = {
      totalConnections: Object.keys(connections).length,
      connections: connections,
      indices: [],
      totalIndices: 0
    };

    if (hasConnections) {
      // Get indices from default connection
      const defaultConnectionId = connectionManager.defaultConnection;
      if (defaultConnectionId) {
        const indicesResult = await ElasticsearchService.listAllIndices(defaultConnectionId);
        if (indicesResult.success) {
          dashboardData.indices = indicesResult.data.slice(0, 10); // Show first 10
          dashboardData.totalIndices = indicesResult.data.length;
        }
      }
    }

    res.render('dashboard', {
      dashboardData,
      hasConnections,
      moment
    });
  } catch (error) {
    console.error('Error in dashboard route:', error);
    res.render('dashboard', {
      dashboardData: { totalConnections: 0, connections: {}, indices: [], totalIndices: 0 },
      hasConnections: false,
      moment,
      error: error.message
    });
  }
});

// Connection management
router.get('/connections', (req, res) => {
  const connections = connectionManager.getAllConnections();
  res.render('connections', { connections });
});

router.post('/connections', async (req, res) => {
  const { name, cloudId, username, password, url } = req.body;

  if (!name || !cloudId || !username || !password) {
    return res.render('connections', {
      connections: connectionManager.getAllConnections(),
      error: 'All fields are required'
    });
  }

  const connectionId = `conn_${Date.now()}`;
  const result = connectionManager.addConnection(connectionId, {
    name, cloudId, username, password, url
  });

  if (result.success) {
    // Test the connection
    const testResult = await connectionManager.testConnection(connectionId);
    if (!testResult.success) {
      connectionManager.removeConnection(connectionId);
      return res.render('connections', {
        connections: connectionManager.getAllConnections(),
        error: `Connection failed: ${testResult.error}`
      });
    }
  }

  res.render('connections', {
    connections: connectionManager.getAllConnections(),
    success: result.success ? 'Connection added successfully' : null,
    error: result.success ? null : result.error
  });
});

router.delete('/connections/:id', (req, res) => {
  const connectionId = req.params.id;
  const success = connectionManager.removeConnection(connectionId);
  res.json({ success });
});

// Index management
router.get('/indices', async (req, res) => {
  const connectionId = req.query.connection || connectionManager.defaultConnection;

  if (!connectionId) {
    return res.render('indices', {
      indices: [],
      connections: connectionManager.getAllConnections(),
      currentConnection: null,
      error: 'No Elasticsearch connection available'
    });
  }

  try {
    const result = await ElasticsearchService.listAllIndices(connectionId);
    res.render('indices', {
      indices: result.success ? result.data : [],
      connections: connectionManager.getAllConnections(),
      currentConnection: connectionId,
      error: result.success ? null : result.error
    });
  } catch (error) {
    res.render('indices', {
      indices: [],
      connections: connectionManager.getAllConnections(),
      currentConnection: connectionId,
      error: error.message
    });
  }
});

// Index details
router.get('/index/:name', async (req, res) => {
  const indexName = req.params.name;
  const connectionId = req.query.connection || connectionManager.defaultConnection;

  if (!connectionId) {
    return res.render('index-details', {
      indexName,
      mapping: { success: false, error: 'No connection available' },
      stats: { success: false, error: 'No connection available' },
      fields: [],
      connections: connectionManager.getAllConnections(),
      currentConnection: null,
      moment
    });
  }

  try {
    const [mappingResult, statsResult] = await Promise.all([
      ElasticsearchService.getIndexMapping(connectionId, indexName),
      ElasticsearchService.getIndexStats(connectionId, indexName)
    ]);

    let fields = [];
    if (mappingResult.success && mappingResult.data[indexName]) {
      fields = Object.keys(mappingResult.data[indexName].mappings.properties || {});
    }
    console.log('Fields:', fields);
    if (!statsResult.success) {
      statsResult.data = {}; // Ensure data is always an object
    }
    res.render('index-details', {
      indexName,
      mapping: mappingResult,
      stats: statsResult,
      fields,
      connections: connectionManager.getAllConnections(),
      currentConnection: connectionId,
      moment
    });
  } catch (error) {
    res.render('index-details', {
      indexName,
      mapping: { success: false, error: error.message },
      stats: { success: false, error: error.message },
      fields: [],
      connections: connectionManager.getAllConnections(),
      currentConnection: connectionId,
      moment
    });
  }
});

// Search
router.get('/search', async (req, res) => {
  const { q, size = 50, page = 1, index, connection } = req.query;
  const connectionId = connection || connectionManager.defaultConnection;
  const from = (page - 1) * parseInt(size);

  if (!connectionId || !index) {
    return res.render('search', {
      result: { success: false, error: 'Connection and index are required' },
      query: q || '',
      size: parseInt(size),
      page: parseInt(page),
      totalPages: 0,
      moment,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  }

  try {
    const result = await ElasticsearchService.searchDocuments(connectionId, index, q, parseInt(size), from);

    res.render('search', {
      result,
      query: q || '',
      size: parseInt(size),
      page: parseInt(page),
      totalPages: result.success ? Math.ceil(result.total / parseInt(size)) : 0,
      moment,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  } catch (error) {
    res.render('search', {
      result: { success: false, error: error.message },
      query: q || '',
      size: parseInt(size),
      page: parseInt(page),
      totalPages: 0,
      moment,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  }
});

// Custom queries
router.get('/custom', async (req, res) => {
  const { index, connection } = req.query;
  const connectionId = connection || connectionManager.defaultConnection;

  res.render('custom', {
    result: null,
    query: '',
    currentIndex: index,
    currentConnection: connectionId,
    connections: connectionManager.getAllConnections()
  });
});

router.post('/custom', async (req, res) => {
  const { query, index, connection } = req.body;
  const connectionId = connection || connectionManager.defaultConnection;

  try {
    const result = await ElasticsearchService.customQuery(connectionId, index, query);

    res.render('custom', {
      result,
      query,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  } catch (error) {
    res.render('custom', {
      result: { success: false, error: error.message },
      query,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  }
});

// Aggregations
router.get('/aggregate', async (req, res) => {
  const { index, connection } = req.query;
  const connectionId = connection || connectionManager.defaultConnection;

  if (!connectionId || !index) {
    return res.render('aggregate', {
      result: null,
      fields: [],
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections(),
      error: 'Connection and index are required'
    });
  }

  try {
    const mappingResult = await ElasticsearchService.getIndexMapping(connectionId, index);

    let fields = [];
    if (mappingResult.success && mappingResult.data[index]) {
      fields = Object.keys(mappingResult.data[index].mappings.properties || {});
    }

    res.render('aggregate', {
      result: null,
      fields,
      selectedField: req.query.field || '', // or any logic to set selectedField
      selectedSize: parseInt(req.query.size) || 10,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  } catch (error) {
    res.render('aggregate', {
      result: { success: false, error: error.message },
      fields: [],
      selectedField: req.query.field || '', // or any logic to set selectedField
      selectedSize: parseInt(req.query.size) || 10,
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  }
});

router.post('/aggregate', async (req, res) => {
  const { field, size = 10, index, connection } = req.body;
  const connectionId = connection || connectionManager.defaultConnection;

  try {
    const [result, mappingResult] = await Promise.all([
      ElasticsearchService.aggregateData(connectionId, index, field, parseInt(size)),
      ElasticsearchService.getIndexMapping(connectionId, index)
    ]);

    let fields = [];
    if (mappingResult.success && mappingResult.data[index]) {
      fields = Object.keys(mappingResult.data[index].mappings.properties || {});
    }

    res.render('aggregate', {
      result,
      fields,
      selectedField: field || '',
      selectedSize: parseInt(size),
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  } catch (error) {
    res.render('aggregate', {
      result: { success: false, error: error.message },
      fields: [],
      selectedField: field,
      selectedSize: parseInt(size),
      currentIndex: index,
      currentConnection: connectionId,
      connections: connectionManager.getAllConnections()
    });
  }
});

// API routes for AJAX operations
router.get('/api/indices/:connection', async (req, res) => {
  const connectionId = req.params.connection;
  try {
    const result = await ElasticsearchService.listAllIndices(connectionId);
    res.json(result);
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

router.post('/api/test-connection', async (req, res) => {
  const { cloudId, username, password } = req.body;

  const tempId = 'temp_' + Date.now();
  const addResult = connectionManager.addConnection(tempId, {
    name: 'Test Connection',
    cloudId,
    username,
    password
  });

  if (!addResult.success) {
    return res.json(addResult);
  }

  const testResult = await connectionManager.testConnection(tempId);
  connectionManager.removeConnection(tempId);

  res.json(testResult);
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


    let result;
    const options = { size: parseInt(recordLimit) || 500 };

    switch (timeRange) {
        case 'last1h':
            result = await fetcher.getRecentRideLocationHistory(driverId, 1, options);
            break;
      case 'last24h':
        result = await fetcher.getRecentRideLocationHistory(driverId, 24, options);
        break;
      case 'last7d':
        result = await fetcher.getRecentRideLocationHistory(driverId, 168, options);
        break;
      case 'last30d':
        result = await fetcher.getRecentRideLocationHistory(driverId, 720, options);
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
