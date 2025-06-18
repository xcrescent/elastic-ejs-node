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
    const { driverId, timeRange, customStart, customEnd, recordLimit, rideStatus } = req.body;


    let result;
    const options = { size: parseInt(recordLimit) || 500, rideStatus: rideStatus || null };

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
// Add these routes to your existing routes/index.js file

const tripAnalysisFetcher = require('../services/TripAnalysisFetcher');

// Trip Analysis Dashboard route
router.get('/trip-analysis', (req, res) => {
  res.render('tripAnalysis', {
    title: 'Trip Analysis Dashboard',
    moment: moment
  });
});

// API route for trip search
router.post('/api/trips/search', async (req, res) => {
  try {
    const {
      tripId,
      rideId,
      driverId,
      riderId,
      riderPhone,
      tripStatus,
      paymentStatus,
      rideType,
      timeRange,
      customStart,
      customEnd,
      minPrice,
      maxPrice,
      recordLimit,
      sortBy,
      sortOrder
    } = req.body;

    console.log('Trip search request:', req.body);

    let startTime, endTime;

    // Handle time range
    switch (timeRange) {
      case 'today':
        startTime = moment().startOf('day').unix();
        endTime = moment().endOf('day').unix();
        break;
      case 'yesterday':
        startTime = moment().subtract(1, 'day').startOf('day').unix();
        endTime = moment().subtract(1, 'day').endOf('day').unix();
        break;
      case 'last7d':
        startTime = moment().subtract(7, 'days').startOf('day').unix();
        endTime = moment().endOf('day').unix();
        break;
      case 'last30d':
        startTime = moment().subtract(30, 'days').startOf('day').unix();
        endTime = moment().endOf('day').unix();
        break;
      case 'custom':
        if (!customStart || !customEnd) {
          return res.status(400).json({
            error: 'Custom date range requires both start and end dates'
          });
        }
        startTime = Math.floor(new Date(customStart).getTime() / 1000);
        endTime = Math.floor(new Date(customEnd).getTime() / 1000);
        break;
      default:
        // Default to today if no time range specified
        startTime = moment().startOf('day').unix();
        endTime = moment().endOf('day').unix();
    }

    const options = {
      tripId: tripId || undefined,
      rideId: rideId || undefined,
      driverId: driverId || undefined,
      riderId: riderId || undefined,
      riderPhone: riderPhone || undefined,
      tripStatus: tripStatus || undefined,
      paymentStatus: paymentStatus || undefined,
      rideType: rideType || undefined,
      startTime,
      endTime,
      minPrice: minPrice ? parseInt(minPrice) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
      size: parseInt(recordLimit) || 100,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'desc'
    };

    // Remove undefined values
    Object.keys(options).forEach(key =>
        options[key] === undefined && delete options[key]
    );

    console.log('Processed options:', options);

    const result = await tripAnalysisFetcher.fetchTrips(options);
    res.json(result);

  } catch (error) {
    console.error('Trip search error:', error);
    res.status(500).json({
      error: 'Failed to fetch trip data',
      details: error.message
    });
  }
});

// API route to get specific trip details
router.get('/api/trips/:tripId', async (req, res) => {
  try {
    const { tripId } = req.params;
    const trip = await tripAnalysisFetcher.getTripById(tripId);
    res.json(trip);
  } catch (error) {
    console.error('Get trip by ID error:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({
        error: 'Failed to fetch trip details',
        details: error.message
      });
    }
  }
});

// API route for driver analytics
router.get('/api/drivers/:driverId/analytics', async (req, res) => {
  try {
    const { driverId } = req.params;
    const timeRange = req.query.timeRange || 'last30d';

    let options = {};

    // Set time range for analytics
    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'last7d':
        startTime = endTime - (7 * 24 * 3600);
        break;
      case 'last30d':
        startTime = endTime - (30 * 24 * 3600);
        break;
      case 'last90d':
        startTime = endTime - (90 * 24 * 3600);
        break;
      default:
        startTime = endTime - (30 * 24 * 3600);
    }

    options.startTime = startTime;
    options.endTime = endTime;

    const analytics = await tripAnalysisFetcher.getDriverAnalytics(driverId, options);
    res.json(analytics);
  } catch (error) {
    console.error('Driver analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch driver analytics',
      details: error.message
    });
  }
});

// API route for trip text search
router.get('/api/trips/search/text', async (req, res) => {
  try {
    const { q, size = 50 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        error: 'Search query must be at least 2 characters long'
      });
    }

    const result = await tripAnalysisFetcher.searchTrips(q.trim(), { size: parseInt(size) });
    res.json(result);
  } catch (error) {
    console.error('Trip text search error:', error);
    res.status(500).json({
      error: 'Failed to search trips',
      details: error.message
    });
  }
});

// API route for recent trips
router.get('/api/trips/recent', async (req, res) => {
  try {
    const {
      timeValue = 24,
      timeUnit = 'hours',
      size = 50,
      driverId,
      tripStatus
    } = req.query;

    const options = {
      size: parseInt(size)
    };

    if (driverId) options.driverId = driverId;
    if (tripStatus) options.tripStatus = tripStatus;

    const result = await tripAnalysisFetcher.getRecentTrips(
        parseInt(timeValue),
        timeUnit,
        options
    );

    res.json(result);
  } catch (error) {
    console.error('Recent trips error:', error);
    res.status(500).json({
      error: 'Failed to fetch recent trips',
      details: error.message
    });
  }
});

// API route for trip analytics summary
router.get('/api/trips/analytics/summary', async (req, res) => {
  try {
    const { timeRange = 'last30d' } = req.query;

    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'today':
        startTime = moment().startOf('day').unix();
        break;
      case 'last7d':
        startTime = endTime - (7 * 24 * 3600);
        break;
      case 'last30d':
        startTime = endTime - (30 * 24 * 3600);
        break;
      case 'last90d':
        startTime = endTime - (90 * 24 * 3600);
        break;
      default:
        startTime = endTime - (30 * 24 * 3600);
    }

    const result = await tripAnalysisFetcher.fetchTrips({
      startTime,
      endTime,
      size: 0 // Only get aggregations, no individual trips
    });

    // Calculate additional metrics
    const summary = {
      timeRange,
      totalTrips: result.totalTrips,
      analytics: result.analytics,
      metrics: {
        completionRate: result.analytics.statusBreakdown.completed ?
            ((result.analytics.statusBreakdown.completed / result.totalTrips) * 100).toFixed(2) : 0,
        cancellationRate: result.analytics.statusBreakdown.cancelled ?
            ((result.analytics.statusBreakdown.cancelled / result.totalTrips) * 100).toFixed(2) : 0,
        averagePrice: result.analytics.priceStats.avg ?
            result.analytics.priceStats.avg.toFixed(2) : 0,
        totalRevenue: result.analytics.priceStats.sum || 0
      }
    };

    res.json(summary);
  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics summary',
      details: error.message
    });
  }
});

// API route for trip export (CSV format)
router.get('/api/trips/export', async (req, res) => {
  try {
    const {
      format = 'csv',
      timeRange = 'last7d',
      tripStatus,
      driverId,
      maxRecords = 1000
    } = req.query;

    // Set time range
    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'today':
        startTime = moment().startOf('day').unix();
        break;
      case 'last7d':
        startTime = endTime - (7 * 24 * 3600);
        break;
      case 'last30d':
        startTime = endTime - (30 * 24 * 3600);
        break;
      default:
        startTime = endTime - (7 * 24 * 3600);
    }

    const options = {
      startTime,
      endTime,
      size: parseInt(maxRecords),
      sortBy: 'createdAt',
      sortOrder: 'desc'
    };

    if (tripStatus) options.tripStatus = tripStatus;
    if (driverId) options.driverId = driverId;

    const result = await tripAnalysisFetcher.fetchTrips(options);

    if (format === 'csv') {
      // Convert to CSV format
      const csvHeader = [
        'Trip ID', 'Ride ID', 'Driver Name', 'Driver Phone', 'Rider Name',
        'Rider Phone', 'From', 'To', 'Trip Status', 'Payment Status',
        'Price', 'Created At', 'Start Time', 'End Time'
      ].join(',');

      const csvRows = result.trips.map(trip => [
        trip.tripId || '',
        trip.rideId || '',
        trip.driver.name || '',
        trip.driver.phone || '',
        trip.rider.name || '',
        trip.rider.phone || '',
        trip.from.name || '',
        trip.to.name || '',
        trip.tripStatus || '',
        trip.paymentStatus || '',
        trip.price || 0,
        trip.createdAt ? new Date(trip.createdAt._seconds * 1000).toISOString() : '',
        trip.startTime ? new Date(trip.startTime._seconds * 1000).toISOString() : '',
        trip.endTime ? new Date(trip.endTime._seconds * 1000).toISOString() : ''
      ].map(field => `"${field}"`).join(','));

      const csvContent = [csvHeader, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=trips_export_${timeRange}_${Date.now()}.csv`);
      res.send(csvContent);
    } else {
      // Return JSON format
      res.json(result);
    }

  } catch (error) {
    console.error('Trip export error:', error);
    res.status(500).json({
      error: 'Failed to export trip data',
      details: error.message
    });
  }
});

// API route for live trip monitoring
router.get('/api/trips/live', async (req, res) => {
  try {
    // Get ongoing trips from last hour
    const result = await tripAnalysisFetcher.getRecentTrips(1, 'hours', {
      tripStatus: 'ongoing',
      size: 100
    });

    // Add real-time status information
    const liveTrips = result.trips.map(trip => ({
      ...trip,
      isLive: true,
      lastUpdate: new Date().toISOString(),
      estimatedCompletion: trip.startTime ?
          new Date((trip.startTime._seconds + 3600) * 1000).toISOString() : null
    }));

    res.json({
      ...result,
      trips: liveTrips,
      refreshInterval: 30000 // 30 seconds
    });

  } catch (error) {
    console.error('Live trips error:', error);
    res.status(500).json({
      error: 'Failed to fetch live trip data',
      details: error.message
    });
  }
});
module.exports = router;
