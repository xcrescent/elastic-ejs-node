// routes/index.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, query, param, validationResult } = require('express-validator');
const moment = require('moment');
const ElasticsearchService = require('../services/elasticsearch_service');
const connectionManager = require('../services/connection_manager');
const fetcher = require('../services/RideLocationHistoryFetcher');
const tripAnalysisFetcher = require('../services/TripAnalysisFetcher');
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

// Rate limiting middleware
const createRateLimit = (maxRequests, windowMs) => rateLimit({
  windowMs,
  max: maxRequests,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// Input sanitization
const sanitizeInput = (req, res, next) => {
  // Basic XSS protection
  for (const key in req.body) {
    if (typeof req.body[key] === 'string') {
      req.body[key] = req.body[key].replace(/<script[^>]*>.*?<\/script>/gi, '');
    }
  }
  next();
};

// Apply rate limiting to API routes
router.use('/api/', createRateLimit(100, 15 * 60 * 1000)); // 100 requests per 15 minutes

// Enhanced Trip Analysis Dashboard route
router.get('/trip-analysis', (req, res) => {
  res.render('tripAnalysis', {
    title: 'Advanced Trip Analysis Dashboard',
    moment: moment,
    user: req.user || null, // For authentication if implemented
    features: {
      realTime: true,
      export: true,
      analytics: true,
      mapping: true
    }
  });
});

// API route for comprehensive trip search with validation
router.post('/api/trips/search', [
  createRateLimit(1500, 15 * 60 * 1000), // Stricter limit for search
  sanitizeInput,
  // body('tripId').optional().isLength({ max: 100 }).trim(),
  // body('rideId').optional().isLength({ max: 100 }).trim(),
  // body('driverId').optional().isLength({ max: 100 }).trim(),
  // body('riderId').optional().isLength({ max: 100 }).trim(),
  // body('riderPhone').optional().matches(/^[\d\s\-\+\(\)]+$/).isLength({ min: 10, max: 15 }),
  // body('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  // body('paymentStatus').optional().isIn(['paid', 'pending', 'failed', 'refunded']),
  // body('rideType').optional().isIn(['shared', 'private', 'delivery', 'scheduled']),
  // body('timeRange').optional().isIn(['today', 'yesterday', 'last7d', 'last30d', 'custom']),
  // body('customStart').optional().isISO8601(),
  // body('customEnd').optional().isISO8601(),
  // body('minPrice').optional().isInt({ min: 0, max: 100000 }),
  // body('maxPrice').optional().isInt({ min: 0, max: 100000 }),
  // body('recordLimit').optional().isInt({ min: 1, max: 10000 }),
  // body('sortBy').optional().isIn(['createdAt', 'startTime', 'endTime', 'price', 'distance', 'tripStatus']),
  // body('sortOrder').optional().isIn(['asc', 'desc']),
  // handleValidationErrors
], async (req, res) => {
  try {
    const {
      tripId, rideId, driverId, riderId, riderPhone, tripStatus, paymentStatus,
      rideType, timeRange, customStart, customEnd, minPrice, maxPrice,
      recordLimit, sortBy, sortOrder
    } = req.body;

    console.log('Enhanced trip search request:', {
      ...req.body,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    let startTime, endTime;

    // Enhanced time range handling
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

        // Validate date range
        if (startTime > endTime) {
          return res.status(400).json({
            error: 'Start date cannot be after end date'
          });
        }

        // Prevent queries for ranges too large (more than 1 year)
        if (endTime - startTime > 365 * 24 * 3600) {
          return res.status(400).json({
            error: 'Date range cannot exceed 1 year'
          });
        }
        break;
      default:
        startTime = moment().startOf('day').unix();
        endTime = moment().endOf('day').unix();
    }

    const options = {
      tripId: tripId?.trim() || undefined,
      rideId: rideId?.trim() || undefined,
      driverId: driverId?.trim() || undefined,
      riderId: riderId?.trim() || undefined,
      riderPhone: riderPhone?.replace(/\D/g, '') || undefined,
      tripStatus: tripStatus || undefined,
      paymentStatus: paymentStatus || undefined,
      rideType: rideType || undefined,
      startTime,
      endTime,
      minPrice: minPrice ? parseInt(minPrice) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
      size: parseInt(recordLimit) || 100,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'desc',
      includeAnalytics: true
    };

    // Remove undefined values
    Object.keys(options).forEach(key =>
        options[key] === undefined && delete options[key]
    );

    console.log('Processed search options:', options);

    const result = await tripAnalysisFetcher.fetchTrips(options);

    // Add request metadata to response
    result.metadata = {
      requestId: req.headers['x-request-id'] || Date.now().toString(),
      processedAt: new Date().toISOString(),
      processingTime: Date.now() - req.startTime
    };

    res.json(result);

  } catch (error) {
    console.error('Trip search error:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      ip: req.ip
    });

    // Enhanced error responses
    if (error.message.includes('Validation failed')) {
      res.status(400).json({
        error: 'Invalid search parameters',
        details: error.message,
        suggestions: 'Please check your input parameters and try again'
      });
    } else if (error.message.includes('Elasticsearch')) {
      res.status(503).json({
        error: 'Search service temporarily unavailable',
        details: 'Please try again in a few moments',
        retryAfter: 30
      });
    } else {
      res.status(500).json({
        error: 'Failed to fetch trip data',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

// Enhanced trip details endpoint with caching
router.get('/api/trips/:tripId', [
  param('tripId').isLength({ min: 1, max: 100 }).trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { tripId } = req.params;

    // Check cache first
    const cacheKey = `trip_${tripId}`;
    // Implement your caching mechanism here

    const trip = await tripAnalysisFetcher.getTripById(tripId);

    res.json({
      trip,
      metadata: {
        fetchedAt: new Date().toISOString(),
        source: 'database'
      }
    });

  } catch (error) {
    console.error('Get trip by ID error:', error);

    if (error.message.includes('not found')) {
      res.status(404).json({
        error: 'Trip not found',
        tripId: req.params.tripId
      });
    } else {
      res.status(500).json({
        error: 'Failed to fetch trip details',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

// Enhanced driver analytics with validation
router.get('/api/drivers/:driverId/analytics', [
  param('driverId').isLength({ min: 1, max: 100 }).trim(),
  query('timeRange').optional().isIn(['last7d', 'last30d', 'last90d']),
  handleValidationErrors
], async (req, res) => {
  try {
    const { driverId } = req.params;
    const timeRange = req.query.timeRange || 'last30d';

    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'last7d': startTime = endTime - (7 * 24 * 3600); break;
      case 'last30d': startTime = endTime - (30 * 24 * 3600); break;
      case 'last90d': startTime = endTime - (90 * 24 * 3600); break;
      default: startTime = endTime - (30 * 24 * 3600);
    }

    const analytics = await tripAnalysisFetcher.getDriverAnalytics(driverId, {
      startTime,
      endTime
    });

    res.json({
      driverId,
      timeRange,
      analytics,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Driver analytics error:', error);
    res.status(500).json({
      error: 'Failed to fetch driver analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Advanced text search with autocomplete
router.get('/api/trips/search/text', [
  query('q').isLength({ min: 2, max: 100 }).trim(),
  query('size').optional().isInt({ min: 1, max: 100 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const { q, size = 20 } = req.query;

    const result = await tripAnalysisFetcher.advancedSearch(q, {
      size: parseInt(size)
    });

    res.json({
      query: q,
      results: result.trips,
      totalFound: result.totalTrips,
      suggestions: result.trips.slice(0, 5).map(trip => ({
        tripId: trip.tripId,
        display: `${trip.tripId} - ${trip.driver.name} (${trip.from.name} → ${trip.to.name})`
      }))
    });

  } catch (error) {
    console.error('Trip text search error:', error);
    res.status(500).json({
      error: 'Failed to search trips',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Search service error'
    });
  }
});

// Enhanced recent trips endpoint
router.get('/api/trips/recent', [
  query('timeValue').optional().isInt({ min: 1, max: 168 }),
  query('timeUnit').optional().isIn(['hours', 'days']),
  query('size').optional().isInt({ min: 1, max: 1000 }),
  query('driverId').optional().isLength({ max: 100 }).trim(),
  query('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      timeValue = 24,
      timeUnit = 'hours',
      size = 50,
      driverId,
      tripStatus
    } = req.query;

    const options = { size: parseInt(size) };
    if (driverId) options.driverId = driverId;
    if (tripStatus) options.tripStatus = tripStatus;

    const result = await tripAnalysisFetcher.getRecentTrips(
        parseInt(timeValue),
        timeUnit,
        options
    );

    res.json({
      ...result,
      timeRange: `${timeValue} ${timeUnit}`,
      fetchedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Recent trips error:', error);
    res.status(500).json({
      error: 'Failed to fetch recent trips',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Comprehensive analytics summary
router.get('/api/trips/analytics/summary', [
  query('timeRange').optional().isIn(['today', 'last7d', 'last30d', 'last90d']),
  handleValidationErrors
], async (req, res) => {
  try {
    const { timeRange = 'last30d' } = req.query;

    const result = await tripAnalysisFetcher.getComprehensiveAnalytics(timeRange);

    // Calculate additional KPIs
    const summary = {
      timeRange,
      overview: {
        totalTrips: result.totalTrips,
        totalRevenue: result.analytics.priceStats.sum || 0,
        averagePrice: result.analytics.priceStats.avg || 0,
        completionRate: result.analytics.statusBreakdown.completed ?
            ((result.analytics.statusBreakdown.completed / result.totalTrips) * 100).toFixed(2) : 0,
        cancellationRate: result.analytics.statusBreakdown.cancelled ?
            ((result.analytics.statusBreakdown.cancelled / result.totalTrips) * 100).toFixed(2) : 0
      },
      breakdowns: {
        status: result.analytics.statusBreakdown,
        payment: result.analytics.paymentBreakdown,
        rideType: result.analytics.rideTypeBreakdown,
        priceRanges: result.analytics.priceRanges
      },
      trends: {
        daily: result.analytics.dailyTrends,
        hourly: result.analytics.hourlyDistribution
      },
      insights: {
        topDrivers: result.analytics.topDrivers.slice(0, 5),
        topRoutes: result.analytics.topRoutes.slice(0, 5),
        cancellationAnalysis: result.analytics.cancellationAnalysis
      },
      generatedAt: new Date().toISOString()
    };

    res.json(summary);

  } catch (error) {
    console.error('Analytics summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics summary',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Enhanced export functionality with multiple formats
router.get('/api/trips/export', [
  query('format').optional().isIn(['csv', 'json', 'xlsx']),
  query('timeRange').optional().isIn(['today', 'last7d', 'last30d']),
  query('maxRecords').optional().isInt({ min: 1, max: 10000 }),
  query('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  query('driverId').optional().isLength({ max: 100 }).trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      format = 'csv',
      timeRange = 'last7d',
      tripStatus,
      driverId,
      maxRecords = 1000
    } = req.query;

    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'today': startTime = moment().startOf('day').unix(); break;
      case 'last7d': startTime = endTime - (7 * 24 * 3600); break;
      case 'last30d': startTime = endTime - (30 * 24 * 3600); break;
      default: startTime = endTime - (7 * 24 * 3600);
    }

    const options = {
      startTime,
      endTime,
      size: parseInt(maxRecords),
      sortBy: 'createdAt',
      sortOrder: 'desc',
      includeAnalytics: false // Skip analytics for export
    };

    if (tripStatus) options.tripStatus = tripStatus;
    if (driverId) options.driverId = driverId;

    const result = await tripAnalysisFetcher.fetchTrips(options);

    const filename = `trips_export_${timeRange}_${Date.now()}`;

    switch (format) {
      case 'csv':
        const csvHeader = [
          'Trip ID', 'Ride ID', 'Driver Name', 'Driver Phone', 'Driver Rating',
          'Rider Name', 'Rider Phone', 'From Location', 'To Location',
          'Trip Status', 'Payment Status', 'Ride Type', 'Price', 'Distance (km)',
          'Created At', 'Start Time', 'End Time', 'Booking Type'
        ].join(',');

        const csvRows = result.trips.map(trip => [
          trip.tripId || '',
          trip.rideId || '',
          trip.driver.name || '',
          trip.driver.phone || '',
          trip.driver.rating || '',
          trip.rider.name || '',
          trip.rider.phone || '',
          trip.from.name || '',
          trip.to.name || '',
          trip.tripStatus || '',
          trip.paymentStatus || '',
          trip.rideType || '',
          trip.price || 0,
          trip.calculatedDistanceInKm || trip.distance || '',
          trip.createdAt ? new Date(trip.createdAt._seconds * 1000).toISOString() : '',
          trip.startTime ? new Date(trip.startTime._seconds * 1000).toISOString() : '',
          trip.endTime ? new Date(trip.endTime._seconds * 1000).toISOString() : '',
          trip.bookedForSomeoneElse ? 'Proxy' : 'Direct'
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','));

        const csvContent = [csvHeader, ...csvRows].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send('\ufeff' + csvContent); // Add BOM for Excel compatibility
        break;

      case 'xlsx':
        // Implement XLSX export using a library like exceljs
        res.status(501).json({ error: 'XLSX export not yet implemented' });
        break;

      case 'json':
      default:
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json({
          exportInfo: {
            format,
            timeRange,
            totalRecords: result.totalTrips,
            exportedRecords: result.trips.length,
            generatedAt: new Date().toISOString()
          },
          data: result.trips
        });
        break;
    }

  } catch (error) {
    console.error('Trip export error:', error);
    res.status(500).json({
      error: 'Failed to export trip data',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Export service error'
    });
  }
});

// Real-time updates endpoint
router.get('/api/trips/live', [
  query('lastUpdate').optional().isInt({ min: 0 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const lastUpdateTime = parseInt(req.query.lastUpdate) || Math.floor(Date.now() / 1000) - 3600;

    const result = await tripAnalysisFetcher.getRealTimeUpdates(lastUpdateTime);

    res.json({
      ...result,
      refreshInterval: 30000, // 30 seconds
      serverTime: Math.floor(Date.now() / 1000)
    });

  } catch (error) {
    console.error('Live trips error:', error);
    res.status(500).json({
      error: 'Failed to fetch live trip data',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Live data service error'
    });
  }
});

// Health check endpoint
router.get('/api/health', async (req, res) => {
  try {
    const health = await tripAnalysisFetcher.healthCheck();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        elasticsearch: health.status,
        api: 'healthy'
      },
      version: process.env.API_VERSION || '1.0.0'
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Add these routes to your existing routes/index.js file
// Fixed Polyline Statistics API (for array structure)
router.get('/api/trips/polyline/statistics', [
  query('timeRange').optional().isIn(['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'custom']),
  query('customStart').optional().isISO8601(),
  query('customEnd').optional().isISO8601(),
  query('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  query('rideType').optional().isIn(['shared', 'private', 'delivery', 'scheduled']),
  query('driverId').optional().isLength({ max: 100 }).trim(),
  query('riderId').optional().isLength({ max: 100 }).trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      timeRange = 'last30d',
      customStart,
      customEnd,
      tripStatus,
      rideType,
      driverId,
      riderId
    } = req.query;

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
      case 'last90d':
        startTime = moment().subtract(90, 'days').startOf('day').unix();
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
        startTime = moment().subtract(30, 'days').startOf('day').unix();
        endTime = moment().endOf('day').unix();
    }

    const options = {
      startTime,
      endTime,
      tripStatus,
      rideType,
      driverId,
      riderId
    };

    // Remove undefined values
    Object.keys(options).forEach(key =>
        options[key] === undefined && delete options[key]
    );

    const statistics = await tripAnalysisFetcher.getPolylineStatistics(options);

    res.json({
      timeRange,
      filters: options,
      statistics,
      generatedAt: new Date().toISOString(),
      dataStructure: 'array' // Indicate we're using the array structure
    });

  } catch (error) {
    console.error('Polyline statistics error:', error);
    res.status(500).json({
      error: 'Failed to fetch polyline statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Fixed Trips with Polyline Filter API (for array structure)
router.post('/api/trips/search/with-polyline', [
  createRateLimit(100, 15 * 60 * 1000),
  sanitizeInput,
  body('polylineRequired').optional().isBoolean(),
  body('validatePolyline').optional().isBoolean(),
  body('includePolylineMetrics').optional().isBoolean(),
  body('timeRange').optional().isIn(['today', 'yesterday', 'last7d', 'last30d', 'custom']),
  body('customStart').optional().isISO8601(),
  body('customEnd').optional().isISO8601(),
  body('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  body('rideType').optional().isIn(['shared', 'private', 'delivery', 'scheduled']),
  body('driverId').optional().isLength({ max: 100 }).trim(),
  body('riderId').optional().isLength({ max: 100 }).trim(),
  body('recordLimit').optional().isInt({ min: 1, max: 10000 }),
  body('sortBy').optional().isIn(['createdAt', 'startTime', 'endTime', 'price', 'distance', 'tripStatus']),
  body('sortOrder').optional().isIn(['asc', 'desc']),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      polylineRequired = true,
      validatePolyline = false,
      includePolylineMetrics = false,
      timeRange,
      customStart,
      customEnd,
      tripStatus,
      rideType,
      driverId,
      riderId,
      recordLimit,
      sortBy,
      sortOrder,
      ...otherFilters
    } = req.body;

    let startTime, endTime;

    // Handle time range (same logic as above)
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
        if (timeRange) {
          startTime = moment().startOf('day').unix();
          endTime = moment().endOf('day').unix();
        }
    }

    const searchOptions = {
      polylineRequired,
      validatePolyline,
      includePolylineMetrics,
      startTime,
      endTime,
      tripStatus,
      rideType,
      driverId,
      riderId,
      size: parseInt(recordLimit) || 100,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'desc',
      includeAnalytics: true,
      ...otherFilters
    };

    // Remove undefined values
    Object.keys(searchOptions).forEach(key =>
        searchOptions[key] === undefined && delete searchOptions[key]
    );

    console.log('Polyline-filtered trip search (array structure):', searchOptions);

    let result;
    if (includePolylineMetrics) {
      result = await tripAnalysisFetcher.getTripsWithPolylineDetails(searchOptions);
    } else {
      result = await tripAnalysisFetcher.fetchTripsWithPolylineFilter(searchOptions);
    }

    res.json({
      ...result,
      searchOptions: {
        polylineRequired,
        validatePolyline,
        includePolylineMetrics,
        timeRange
      },
      metadata: {
        requestId: req.headers['x-request-id'] || Date.now().toString(),
        processedAt: new Date().toISOString(),
        processingTime: Date.now() - req.startTime,
        dataStructure: 'array'
      }
    });

  } catch (error) {
    console.error('Polyline-filtered trip search error:', error);
    res.status(500).json({
      error: 'Failed to fetch trips with polyline filter',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Fixed Validate Single Trip Polyline API (for array structure)
router.get('/api/trips/:tripId/polyline/validate', [
  param('tripId').isLength({ min: 1, max: 100 }).trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { tripId } = req.params;

    const validation = await tripAnalysisFetcher.validateTripPolyline(tripId);

    res.json({
      tripId,
      validation,
      validatedAt: new Date().toISOString(),
      dataStructure: 'array',
      validationVersion: '2.0' // Updated validation for array structure
    });

  } catch (error) {
    console.error('Trip polyline validation error:', error);

    if (error.message.includes('not found')) {
      res.status(404).json({
        error: 'Trip not found',
        tripId: req.params.tripId
      });
    } else {
      res.status(500).json({
        error: 'Failed to validate trip polyline',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
});

// Fixed Bulk Validate Polylines API (for array structure)
router.post('/api/trips/polyline/validate-bulk', [
  createRateLimit(10, 15 * 60 * 1000), // Stricter limit for bulk operations
  body('tripIds').isArray({ min: 1, max: 100 }),
  body('tripIds.*').isLength({ min: 1, max: 100 }).trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { tripIds } = req.body;

    console.log(`Bulk validating polylines for ${tripIds.length} trips (array structure)`);

    const result = await tripAnalysisFetcher.bulkValidatePolylines(tripIds);

    res.json({
      bulkValidation: result,
      requestInfo: {
        totalRequested: tripIds.length,
        requestedTripIds: tripIds,
        processedAt: new Date().toISOString(),
        dataStructure: 'array',
        validationVersion: '2.0'
      }
    });

  } catch (error) {
    console.error('Bulk polyline validation error:', error);
    res.status(500).json({
      error: 'Failed to bulk validate polylines',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Fixed Get Trips Missing Polylines API (for array structure)
router.get('/api/trips/missing-polylines', [
  query('timeRange').optional().isIn(['today', 'yesterday', 'last7d', 'last30d', 'custom']),
  query('customStart').optional().isISO8601(),
  query('customEnd').optional().isISO8601(),
  query('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  query('rideType').optional().isIn(['shared', 'private', 'delivery', 'scheduled']),
  query('size').optional().isInt({ min: 1, max: 1000 }),
  query('sortBy').optional().isIn(['createdAt', 'startTime', 'tripStatus']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      timeRange = 'last7d',
      customStart,
      customEnd,
      tripStatus,
      rideType,
      size = 100,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let startTime, endTime;

    // Handle time range (same logic as above)
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
        startTime = moment().subtract(7, 'days').startOf('day').unix();
        endTime = moment().endOf('day').unix();
    }

    const searchOptions = {
      polylineRequired: false, // Get trips WITHOUT polylines
      validatePolyline: false,
      startTime,
      endTime,
      tripStatus,
      rideType,
      size: parseInt(size),
      sortBy,
      sortOrder,
      includeAnalytics: true,
      includePolylineMetrics: true // Include metrics to show route breakdown
    };

    // Remove undefined values
    Object.keys(searchOptions).forEach(key =>
        searchOptions[key] === undefined && delete searchOptions[key]
    );

    const result = await tripAnalysisFetcher.fetchTripsWithPolylineFilter(searchOptions);

    // Add summary information
    const summary = {
      totalTripsWithoutPolyline: result.totalTrips,
      tripsReturned: result.tripsReturned,
      timeRange,
      filters: {
        tripStatus,
        rideType,
        startTime: new Date(startTime * 1000).toISOString(),
        endTime: new Date(endTime * 1000).toISOString()
      },
      dataStructure: 'array'
    };

    res.json({
      summary,
      trips: result.trips,
      analytics: result.analytics,
      polylineMetrics: result.polylineMetrics, // Include route-level metrics
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Missing polylines error:', error);
    res.status(500).json({
      error: 'Failed to fetch trips missing polylines',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Fixed Polyline Coverage Report API (for array structure)
router.get('/api/trips/polyline/coverage-report', [
  query('timeRange').optional().isIn(['last7d', 'last30d', 'last90d']),
  query('format').optional().isIn(['json', 'csv']),
  query('includeDetails').optional().isBoolean(),
  query('includeRouteBreakdown').optional().isBoolean(),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      timeRange = 'last30d',
      format = 'json',
      includeDetails = false,
      includeRouteBreakdown = false
    } = req.query;

    const endTime = Math.floor(Date.now() / 1000);
    let startTime;

    switch (timeRange) {
      case 'last7d': startTime = endTime - (7 * 24 * 3600); break;
      case 'last30d': startTime = endTime - (30 * 24 * 3600); break;
      case 'last90d': startTime = endTime - (90 * 24 * 3600); break;
      default: startTime = endTime - (30 * 24 * 3600);
    }

    const statistics = await tripAnalysisFetcher.getPolylineStatistics({
      startTime,
      endTime
    });

    const report = {
      reportInfo: {
        title: 'Polyline Coverage Report (Array Structure)',
        timeRange,
        period: {
          from: new Date(startTime * 1000).toISOString(),
          to: new Date(endTime * 1000).toISOString()
        },
        generatedAt: new Date().toISOString(),
        dataStructure: 'array',
        version: '2.0'
      },
      summary: statistics.overview,
      breakdown: {
        byStatus: statistics.coverageByStatus,
        byRideType: statistics.coverageByRideType
      },
      trends: statistics.dailyCoverage
    };

    if (includeDetails) {
      // Get some sample trips with and without polylines
      const [withPolylines, withoutPolylines] = await Promise.all([
        tripAnalysisFetcher.fetchTripsWithPolylineFilter({
          polylineRequired: true,
          startTime,
          endTime,
          size: 10,
          includeAnalytics: false,
          includePolylineMetrics: true
        }),
        tripAnalysisFetcher.fetchTripsWithPolylineFilter({
          polylineRequired: false,
          startTime,
          endTime,
          size: 10,
          includeAnalytics: false,
          includePolylineMetrics: true
        })
      ]);

      report.samples = {
        tripsWithPolylines: withPolylines.trips.slice(0, 5).map(trip => ({
          tripId: trip.tripId,
          tripStatus: trip.tripStatus,
          rideType: trip.rideType,
          routeSummary: tripAnalysisFetcher.getTripRouteSummary(trip),
          polylineMetrics: trip.polylineMetrics
        })),
        tripsWithoutPolylines: withoutPolylines.trips.slice(0, 5).map(trip => ({
          tripId: trip.tripId,
          tripStatus: trip.tripStatus,
          rideType: trip.rideType,
          routeSummary: tripAnalysisFetcher.getTripRouteSummary(trip),
          polylineMetrics: trip.polylineMetrics
        }))
      };
    }

    if (includeRouteBreakdown && report.samples) {
      // Add detailed route analysis
      report.routeAnalysis = {
        averageRoutesPerTrip: report.samples.tripsWithPolylines.reduce((sum, trip) =>
            sum + (trip.routeSummary?.totalRoutes || 0), 0) / (report.samples.tripsWithPolylines.length || 1),
        multiRouteTripsPercentage: report.samples.tripsWithPolylines.filter(trip =>
            trip.routeSummary?.totalRoutes > 1).length / (report.samples.tripsWithPolylines.length || 1) * 100,
        partialPolylineTripsPercentage: report.samples.tripsWithPolylines.filter(trip =>
            trip.routeSummary && trip.routeSummary.routesWithPolylines < trip.routeSummary.totalRoutes
        ).length / (report.samples.tripsWithPolylines.length || 1) * 100
      };
    }

    if (format === 'csv') {
      // Generate enhanced CSV format for the daily coverage data
      const csvHeader = [
        'Date',
        'Total Trips',
        'Trips With Polylines',
        'Trips Without Polylines',
        'Coverage Percentage',
        'Data Structure'
      ].join(',');

      const csvRows = statistics.dailyCoverage.map(day => [
        day.date,
        day.total,
        day.withPolyline,
        day.withoutPolyline,
        day.coveragePercentage,
        'array'
      ].join(','));

      const csvContent = [csvHeader, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="polyline_coverage_array_${timeRange}_${Date.now()}.csv"`);
      res.send('\ufeff' + csvContent);
    } else {
      res.json(report);
    }

  } catch (error) {
    console.error('Polyline coverage report error:', error);
    res.status(500).json({
      error: 'Failed to generate polyline coverage report',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Fixed Quick Polyline Check API (for array structure)
router.get('/api/trips/polyline/quick-check', async (req, res) => {
  try {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (24 * 3600); // Last 24 hours

    const statistics = await tripAnalysisFetcher.getPolylineStatistics({
      startTime,
      endTime
    });

    const quickCheck = {
      period: 'last24h',
      status: statistics.overview.coveragePercentage >= 80 ? 'healthy' :
          statistics.overview.coveragePercentage >= 60 ? 'warning' : 'critical',
      coveragePercentage: statistics.overview.coveragePercentage,
      totalTrips: statistics.overview.totalTrips,
      tripsWithPolyline: statistics.overview.tripsWithPolyline,
      tripsWithoutPolyline: statistics.overview.tripsWithoutPolyline,
      checkedAt: new Date().toISOString(),
      dataStructure: 'array',
      version: '2.0'
    };

    res.json(quickCheck);

  } catch (error) {
    console.error('Polyline quick check error:', error);
    res.status(500).json({
      status: 'error',
      error: 'Failed to perform polyline quick check',
      checkedAt: new Date().toISOString()
    });
  }
});

// NEW: Route Analysis API
router.get('/api/trips/polyline/route-analysis', [
  query('timeRange').optional().isIn(['today', 'yesterday', 'last7d', 'last30d']),
  query('tripStatus').optional().isIn(['completed', 'cancelled', 'ongoing', 'scheduled', 'assigned']),
  query('includeRouteLabels').optional().isBoolean(),
  handleValidationErrors
], async (req, res) => {
  try {
    const {
      timeRange = 'last7d',
      tripStatus,
      includeRouteLabels = true
    } = req.query;

    let startTime, endTime;
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
      default:
        startTime = moment().subtract(7, 'days').startOf('day').unix();
        endTime = moment().endOf('day').unix();
    }

    // Get sample of trips with polylines for analysis
    const result = await tripAnalysisFetcher.getTripsWithPolylineDetails({
      polylineRequired: true,
      validatePolyline: true,
      includePolylineMetrics: true,
      startTime,
      endTime,
      tripStatus,
      size: 1000 // Larger sample for analysis
    });

    const routeAnalysis = {
      timeRange,
      period: {
        from: new Date(startTime * 1000).toISOString(),
        to: new Date(endTime * 1000).toISOString()
      },
      totalTripsAnalyzed: result.trips.length,
      routeMetrics: {
        averageRoutesPerTrip: result.polylineMetrics.averageRoutesPerTrip,
        tripsWithMultipleRoutes: result.polylineMetrics.totalTripsWithMultipleRoutes,
        multiRouteTripPercentage: result.trips.length > 0 ?
            (result.polylineMetrics.totalTripsWithMultipleRoutes / result.trips.length * 100).toFixed(2) : 0,
        totalValidPolylines: result.polylineMetrics.totalValidPolylines,
        totalInvalidPolylines: result.polylineMetrics.totalInvalidPolylines,
        averagePolylineLength: result.polylineMetrics.averagePolylineLength
      }
    };

    // Analyze route patterns if requested
    if (includeRouteLabels) {
      const routeLabelCount = {};
      const routeLabelPolylineCount = {};

      result.trips.forEach(trip => {
        if (trip.polylineMetrics && trip.polylineMetrics.routeLabels) {
          trip.polylineMetrics.routeLabels.forEach(label => {
            routeLabelCount[label] = (routeLabelCount[label] || 0) + 1;
            if (trip.polylineMetrics.routesWithPolylines > 0) {
              routeLabelPolylineCount[label] = (routeLabelPolylineCount[label] || 0) + 1;
            }
          });
        }
      });

      routeAnalysis.routeLabels = {
        distribution: routeLabelCount,
        polylineCoverage: Object.keys(routeLabelCount).reduce((acc, label) => {
          acc[label] = {
            total: routeLabelCount[label],
            withPolylines: routeLabelPolylineCount[label] || 0,
            coveragePercentage: routeLabelCount[label] > 0 ?
                ((routeLabelPolylineCount[label] || 0) / routeLabelCount[label] * 100).toFixed(2) : 0
          };
          return acc;
        }, {})
      };
    }

    res.json({
      ...routeAnalysis,
      generatedAt: new Date().toISOString(),
      dataStructure: 'array'
    });

  } catch (error) {
    console.error('Route analysis error:', error);
    res.status(500).json({
      error: 'Failed to perform route analysis',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Dashboard route
router.get('/polyline-dashboard', (req, res) => {
  res.render('polylineDashboard', {
    title: 'Polyline Management Dashboard (Array Structure)',
    moment: moment,
    user: req.user || null,
    features: {
      realTime: true,
      export: true,
      analytics: true,
      validation: true,
      bulkOperations: true,
      routeAnalysis: true, // New feature
      arrayStructure: true // Indicate array support
    },
    dataStructure: 'array'
  });
});
// Middleware to add request timing
router.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});



// Error handling middleware
router.use((error, req, res, next) => {
  console.error('Route error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    ip: req.ip
  });

  res.status(500).json({
    error: 'Internal server error',
    requestId: req.headers['x-request-id'] || Date.now().toString(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
