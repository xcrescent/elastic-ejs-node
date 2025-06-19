const {Client} = require("@elastic/elasticsearch");
const moment = require('moment');

const client = new Client({
    cloud: { id: process.env.ELASTIC_CLOUD_ID},
    auth: {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD
    },
    requestTimeout: 60000,
    maxRetries: 3,
    resurrectStrategy: 'ping'
});

const indexName = 'prod_trips';

class TripAnalysisFetcher {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Validate input parameters
     */
    validateSearchParams(options) {
        const errors = [];

        if (options.size && (options.size < 1 || options.size > 10000)) {
            errors.push('Size must be between 1 and 10000');
        }

        if (options.startTime && options.endTime && options.startTime > options.endTime) {
            errors.push('Start time cannot be after end time');
        }

        if (options.minPrice && options.maxPrice && options.minPrice > options.maxPrice) {
            errors.push('Minimum price cannot be greater than maximum price');
        }

        if (options.riderPhone && !/^\d{10,15}$/.test(options.riderPhone.replace(/\D/g, ''))) {
            errors.push('Invalid phone number format');
        }

        return errors;
    }

    /**
     * Enhanced fetch trips with caching and validation
     */
    async fetchTrips(options = {}) {
        const validationErrors = this.validateSearchParams(options);
        if (validationErrors.length > 0) {
            throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
        }

        const {
            tripId, rideId, driverId, riderId, riderPhone, tripStatus, paymentStatus,
            rideType, startTime, endTime, minPrice, maxPrice, size = 100,
            sortBy = 'createdAt', sortOrder = 'desc', includeAnalytics = true
        } = options;

        try {
            // Check cache first for non-real-time queries
            const cacheKey = JSON.stringify(options);
            if (this.cache.has(cacheKey)) {
                const cached = this.cache.get(cacheKey);
                if (Date.now() - cached.timestamp < this.cacheTimeout) {
                    console.log('Returning cached result');
                    return cached.data;
                }
            }

            const query = this.buildEnhancedQuery(options);

            console.log('Executing enhanced Elasticsearch query...');
            console.log('Query size:', JSON.stringify(query).length, 'characters');

            const response = await client.search({
                index: indexName,
                body: query,
                timeout: '30s'
            });

            const result = this.processEnhancedResponse(response, options);

            // Cache the result
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            // Clean old cache entries
            this.cleanCache();

            return result;
        } catch (error) {
            console.error('Error fetching trip data:', error);
            if (error.meta?.body?.error) {
                throw new Error(`Elasticsearch error: ${error.meta.body.error.reason}`);
            }
            throw error;
        }
    }

    /**
     * Build enhanced query with better performance and more features
     */
    buildEnhancedQuery(options) {
        const {
            tripId, rideId, driverId, riderId, riderPhone, tripStatus, paymentStatus,
            rideType, startTime, endTime, minPrice, maxPrice, size, sortBy, sortOrder,
            includeAnalytics = true
        } = options;

        const query = {
            size,
            query: { bool: { filter: [], must: [], should: [] } },
            sort: [],
            _source: {
                excludes: ['reportData', 'locationDetails.driverLocationHistory'] // Exclude heavy fields
            }
        };

        // Enhanced aggregations for better analytics
        if (includeAnalytics) {
            query.aggs = {
                trip_status_breakdown: {
                    terms: { field: "tripStatus.keyword", size: 20 }
                },
                payment_status_breakdown: {
                    terms: { field: "paymentStatus.keyword", size: 20 }
                },
                ride_type_breakdown: {
                    terms: { field: "rideType.keyword", size: 20 }
                },
                price_statistics: {
                    stats: { field: "price" }
                },
                price_ranges: {
                    range: {
                        field: "price",
                        ranges: [
                            { to: 50 }, { from: 50, to: 100 }, { from: 100, to: 200 },
                            { from: 200, to: 500 }, { from: 500, to: 1000 }, { from: 1000 }
                        ]
                    }
                },
                daily_trip_count: {
                    date_histogram: {
                        field: "createdAt._seconds",
                        calendar_interval: "1d",
                        format: "yyyy-MM-dd",
                        // time_zone: "Asia/Kolkata"
                    }
                },
                hourly_distribution: {
                    date_histogram: {
                        field: "createdAt._seconds",
                        calendar_interval: "1h",
                        format: "HH",
                        // time_zone: "Asia/Kolkata"
                    }
                },
                top_drivers: {
                    terms: { field: "driver.id.keyword", size: 10 },
                    aggs: {
                        avg_rating: { avg: { field: "driver.rating" } },
                        total_revenue: { sum: { field: "price" } },
                        completion_rate: {
                            terms: { field: "tripStatus.keyword" }
                        }
                    }
                },
                top_routes: {
                    multi_terms: {
                        terms: [
                            { field: "from.name.keyword" },
                            { field: "to.name.keyword" }
                        ],
                        size: 10
                    },
                    aggs: {
                        avg_price: { avg: { field: "price" } },
                        trip_count: { value_count: { field: "tripId.keyword" } }
                    }
                },
                cancellation_analysis: {
                    filter: { term: { "tripStatus.keyword": "cancelled" } },
                    aggs: {
                        cancellation_reasons: {
                            terms: { field: "cancelReason.keyword", size: 10 }
                        },
                        cancelled_by: {
                            terms: { field: "canceledBy.keyword", size: 10 }
                        }
                    }
                },
                distance_analytics: {
                    stats: { field: "calculatedDistanceInKm" }
                },
                vehicle_type_analysis: {
                    terms: { field: "driver.vehicleType.keyword", size: 20 }
                }
            };
        }

        // Build filters with enhanced matching
        if (tripId) {
            query.query.bool.filter.push({
                term: { "tripId.keyword": tripId }
            });
        }

        if (rideId) {
            query.query.bool.filter.push({
                term: { "rideId.keyword": rideId }
            });
        }

        if (driverId) {
            query.query.bool.filter.push({
                term: { "driver.id.keyword": driverId }
            });
        }

        if (riderId) {
            query.query.bool.filter.push({
                term: { "rider.id.keyword": riderId }
            });
        }

        // Enhanced phone search across multiple fields
        if (riderPhone) {
            const phoneClean = riderPhone.replace(/\D/g, '');
            query.query.bool.should.push(
                { wildcard: { "rider.phone.keyword": `*${phoneClean}*` } },
                { wildcard: { "pickUpPhoneNumber.keyword": `*${phoneClean}*` } },
                { wildcard: { "dropOffPhoneNumber.keyword": `*${phoneClean}*` } },
                { wildcard: { "bookingContact.keyword": `*${phoneClean}*` } }
            );
            query.query.bool.minimum_should_match = 1;
        }

        if (tripStatus) {
            query.query.bool.filter.push({
                term: { "tripStatus.keyword": tripStatus }
            });
        }

        if (paymentStatus) {
            query.query.bool.filter.push({
                term: { "paymentStatus.keyword": paymentStatus }
            });
        }

        if (rideType) {
            query.query.bool.filter.push({
                term: { "rideType.keyword": rideType }
            });
        }

        // Enhanced time range filter
        if (startTime || endTime) {
            const rangeFilter = { range: { "createdAt._seconds": {} } };
            if (startTime) rangeFilter.range["createdAt._seconds"].gte = startTime;
            if (endTime) rangeFilter.range["createdAt._seconds"].lte = endTime;
            query.query.bool.filter.push(rangeFilter);
        }

        // Price range filter
        if (minPrice !== undefined || maxPrice !== undefined) {
            const priceFilter = { range: { "price": {} } };
            if (minPrice !== undefined) priceFilter.range.price.gte = minPrice;
            if (maxPrice !== undefined) priceFilter.range.price.lte = maxPrice;
            query.query.bool.filter.push(priceFilter);
        }

        // Enhanced sorting
        const sortField = this.getSortField(sortBy);
        query.sort.push({
            [sortField]: { order: sortOrder || 'desc' }
        });

        // Add secondary sort for consistency
        if (sortField !== 'createdAt._seconds') {
            query.sort.push({
                "createdAt._seconds": { order: 'desc' }
            });
        }

        return query;
    }

    /**
     * Enhanced response processing with better data formatting
     */
    processEnhancedResponse(response, options) {
        console.log('Processing enhanced trip response...');

        const hits = response.body ? response.body.hits.hits : response.hits.hits;
        const totalHits = response.hits.total.value;
        const aggregations = response.aggregations || {};

        const trips = hits.map(hit => this.formatEnhancedTripData(hit._source));
        const analytics = this.processEnhancedAggregations(aggregations);

        const result = {
            totalTrips: totalHits,
            tripsReturned: hits.length,
            trips,
            analytics,
            query: {
                took: response.took,
                timed_out: response.timed_out,
                total_shards: response._shards?.total,
                successful_shards: response._shards?.successful
            },
            pagination: {
                total: totalHits,
                size: options.size || 100,
                from: options.from || 0,
                pages: Math.ceil(totalHits / (options.size || 100))
            }
        };

        console.log(`Enhanced processing: ${totalHits} total trips, ${hits.length} returned`);
        return result;
    }

    /**
     * Enhanced trip data formatting with all fields
     */
    formatEnhancedTripData(trip) {

        return {
            // Basic trip info
            tripId: trip.tripId,
            rideId: trip.rideId,
            bookingId: trip.bookingId,
            scheduleId: trip.scheduleId,
            recurringTripId: trip.recurringTripId,
            upcomingTripId: trip.upcomingTripId,
            batchGroupId: trip.batchGroupId,

            // Driver information (enhanced)
            driver: {
                id: trip.driver?.id,
                name: trip.driver?.name,
                phone: trip.driver?.phone || trip.driverPhone,
                rating: trip.driver?.rating,
                reviewCount: trip.driver?.reviewCount,
                profileImageUrl: trip.driver?.profileImageUrl,
                photo: trip.driver?.photo,
                agencyId: trip.driver?.agencyId,
                vehicle: {
                    number: trip.driver?.vehicle?.number,
                    type: trip.driver?.vehicleType,
                    short_code: trip.driver?.vehicle?.short_code
                },
                currentLocation: trip.driver?.currentLocation,
                vehicleAttributes: trip.vehicleAttributes
            },

            // Rider information (enhanced)
            rider: {
                id: trip.rider?.id || trip.riderId,
                name: trip.rider?.name,
                phone: trip.rider?.phone,
                type: trip.rider?.type,
                age: trip.rider?.age,
                gender: trip.rider?.gender,
                cohorts: trip.rider?.cohorts,
                parentRider: trip.rider?.parentRider
            },

            // Location information (enhanced)
            from: {
                name: trip.from?.name,
                coordinate: trip.from?.coordinate || trip.from?.coordinates,
                shortName: trip.from?.shortName,
                stopNumber: trip.from?.stopNumber
            },
            to: {
                name: trip.to?.name,
                coordinate: trip.to?.coordinate || trip.to?.coordinates,
                shortName: trip.to?.shortName,
                stopNumber: trip.to?.stopNumber
            },
            pickUpPoint: trip.pickUpPoint,
            dropOffPoint: trip.dropOffPoint,
            pickUpPhoneNumber: trip.pickUpPhoneNumber,
            dropOffPhoneNumber: trip.dropOffPhoneNumber,
            bookingContact: trip.bookingContact,

            // Trip status and progress
            tripStatus: trip.tripStatus,
            taskStatus: trip.taskStatus,
            bookingStatus: trip.bookingStatus,
            rideType: trip.rideType,
            type: trip.type,
            subType: trip.subType,
            tripDirection: trip.tripDirection,

            // Pricing (enhanced)
            price: trip.price,
            calculatedPrice: trip.calculatedPrice,
            priceBreakUp: trip.priceBreakUp,
            priceOverridden: trip.priceOverridden,
            priceUpdatedBy: trip.priceUpdatedBy,
            isPriceUpdatedByAdmin: trip.isPriceUpdatedByAdmin,
            paymentStatus: trip.paymentStatus,
            paymentType: trip.paymentType,
            payCashLater: trip.payCashLater,
            cashCollected: trip.cashCollected,
            cashCollectedTime: trip.cashCollectedTime,
            paymentMethodChangeHistory: trip.paymentMethodChangeHistory,

            // Timing (enhanced)
            createdAt: trip.createdAt,
            updatedAt: trip.updatedAt,
            startTime: trip.startTime,
            endTime: trip.endTime,
            scheduledAt: trip.scheduledAt,
            scheduledTime: trip.scheduledTime,
            pickUpTime: trip.pickUpTime,
            tripStartTime: trip.tripStartTime,
            estimatedTripBeginTime: trip.estimatedTripBeginTime,
            dynamicEstimatedTripBeginTime: trip.dynamicEstimatedTripBeginTime,
            estDateAndTimetoPickup: trip.estDateAndTimetoPickup,

            // Trip progress (enhanced)
            driverArrived: trip.driverArrived,
            driverArrivedTime: trip.driverArrivedTime,
            driverArrivedLocation: trip.driverArrivedLocation,
            driverReached: trip.driverReached,
            driverReachedTime: trip.driverReachedTime,
            driverInitialLocation: trip.driverInitialLocation,
            driverLastLocation: trip.driverLastLocation,

            // Distance and duration
            distance: trip.distance,
            calculatedDistanceInKm: trip.calculatedDistanceInKm,
            driverToPickupDistance: trip.driverToPickupDistance,
            estTimeOriginToDestInSecond: trip.estTimeOriginToDestInSecond,
            estTimeToReachPickupInSecond: trip.estTimeToReachPickupInSecond,
            estTimeToReachToComplete: trip.estTimeToReachToComplete,
            googleEstimatedTimeFromPickupToDropoffInSeconds: trip.googleEstimatedTimeFromPickupToDropoffInSeconds,
            calculatedWaitingTimeInSecs: trip.calculatedWaitingTimeInSecs,
            distanceMatrices: trip.distanceMatrices,

            // Passenger details
            bookedSeats: trip.bookedSeats || trip.seatsBooked,
            passengerCount: trip.passengerCount,
            otp: trip.otp,
            isOtpRequired: trip.isOtpRequired,

            // Cancellation info (enhanced)
            cancelled: trip.cancled, // Note: typo in original field
            cancelReason: trip.cancelReason,
            cancelReasonDescription: trip.cancelReasonDescription,
            canceledBy: trip.canceledBy,
            canceledTime: trip.canceledTime,
            canceledByAdmin: trip.canceledByAdmin,
            quickCancel: trip.quickCancel,
            freeCancellationAllowed: trip.freeCancellationAllowed,
            freeCancellationAllowedReason: trip.freeCancellationAllowedReason,
            cancelEnquiry: trip.cancelEnquiry,

            // Contact information (enhanced)
            lastContacted: trip.lastContacted,
            lastContactedBy: trip.lastContactedBy,
            lastContactedByName: trip.lastContactedByName,
            firstContactedAt: trip.firstContactedAt,
            contactTimeInSeconds: trip.contactTimeInSeconds,
            contactReason: trip.contactReason,
            userCalledDriver: trip.userCalledDriver,
            userCalledDriverAttempts: trip.userCalledDriverAttempts,
            userCalledByDriverAttempts: trip.userCalledByDriverAttempts,
            userCalledDriverLastAttemptedAt: trip.userCalledDriverLastAttemptedAt,
            userCalledByDriverLastAttemptedAt: trip.userCalledByDriverLastAttemptedAt,

            // Admin information (enhanced)
            assignedAdmin: trip.assignedAdmin,
            assignedAdminHistory: trip.assignedAdminHistory,
            completedBy: trip.completedBy,
            completedByAdmin: trip.completedByAdmin,
            canceledCompletedByAdminName: trip.canceledCompletedByAdminName,
            canceledCompletedByAdminPhone: trip.canceledCompletedByAdminPhone,
            byAdmin: trip.byAdmin,
            requestedBy: trip.requestedBy,
            AdminAttempts: trip.AdminAttempts,

            // Special features and flags
            isRecurringTrip: trip.isRecurringTrip,
            isQrRide: trip.isQrRide,
            bookedForSomeoneElse: trip.bookedForSomeoneElse,
            isDynamicPricingApplied: trip.isDynamicPricingApplied,
            dynamicPricing: trip.dynamicPricing,

            // Delivery specific
            items: trip.items,
            itemImageUrl: trip.itemImageUrl,
            loadingPrice: trip.loadingPrice,
            offloadingPrice: trip.offloadingPrice,
            merchant: trip.merchant,
            merchantId: trip.merchantId,
            messageForDriver: trip.messageForDriver,
            messageForMerchant: trip.messageForMerchant,

            // Technical details
            appVersion: trip.appVersion,
            os: trip.os,
            deviceId: trip.deviceId,
            polygonId: trip.polygonId,
            priority: trip.priority,
            bookingTimeInHrs: trip.bookingTimeInHrs,
            bookingTimeInMins: trip.bookingTimeInMins,

            // Location and tracking
            currentLocation: trip.currentLocation,
            locationDetails: trip.locationDetails,
            tripLocations: trip.tripLocations,
            waitingData: trip.waitingData,

            // Driver change history
            driverChangeHistory: trip.driverChangeHistory,
            driverChangeRequestStatus: trip.driverChangeRequestStatus,
            driverChangeRequestSearchDeadline: trip.driverChangeRequestSearchDeadline,

            // Previous trip data
            previousOngoingTripId: trip.previousOngoingTripId,
            previousOngoingTripData: trip.previousOngoingTripData,
            previousOngoingTripDestination: trip.previousOngoingTripDestination,

            // Route information
            route: trip.route,

            // Metadata
            dateAndTime: trip.dateAndTime,
            dateAndTimetoChangeColor: trip.dateAndTimetoChangeColor,
            dateDriverId: trip.dateDriverId
        };
    }

    /**
     * Enhanced aggregation processing
     */
    processEnhancedAggregations(aggregations) {
        const analytics = {
            statusBreakdown: {},
            paymentBreakdown: {},
            rideTypeBreakdown: {},
            priceStats: {},
            priceRanges: {},
            dailyTrends: [],
            hourlyDistribution: [],
            topDrivers: [],
            topRoutes: [],
            cancellationAnalysis: {},
            distanceAnalytics: {},
            vehicleTypeAnalysis: {}
        };

        // Trip status breakdown
        if (aggregations.trip_status_breakdown?.buckets) {
            aggregations.trip_status_breakdown.buckets.forEach(bucket => {
                analytics.statusBreakdown[bucket.key] = bucket.doc_count;
            });
        }

        // Payment status breakdown
        if (aggregations.payment_status_breakdown?.buckets) {
            aggregations.payment_status_breakdown.buckets.forEach(bucket => {
                analytics.paymentBreakdown[bucket.key] = bucket.doc_count;
            });
        }

        // Ride type breakdown
        if (aggregations.ride_type_breakdown?.buckets) {
            aggregations.ride_type_breakdown.buckets.forEach(bucket => {
                analytics.rideTypeBreakdown[bucket.key] = bucket.doc_count;
            });
        }

        // Price statistics
        if (aggregations.price_statistics) {
            analytics.priceStats = {
                min: aggregations.price_statistics.min,
                max: aggregations.price_statistics.max,
                avg: aggregations.price_statistics.avg,
                sum: aggregations.price_statistics.sum,
                count: aggregations.price_statistics.count
            };
        }

        // Price ranges
        if (aggregations.price_ranges?.buckets) {
            aggregations.price_ranges.buckets.forEach(bucket => {
                const label = bucket.from !== undefined && bucket.to !== undefined
                    ? `₹${bucket.from}-₹${bucket.to}`
                    : bucket.from !== undefined
                        ? `₹${bucket.from}+`
                        : `<₹${bucket.to}`;
                analytics.priceRanges[label] = bucket.doc_count;
            });
        }

        // Daily trends
        if (aggregations.daily_trip_count?.buckets) {
            analytics.dailyTrends = aggregations.daily_trip_count.buckets.map(bucket => ({
                date: bucket.key_as_string,
                count: bucket.doc_count
            }));
        }

        // Hourly distribution
        if (aggregations.hourly_distribution?.buckets) {
            analytics.hourlyDistribution = aggregations.hourly_distribution.buckets.map(bucket => ({
                hour: bucket.key_as_string,
                count: bucket.doc_count
            }));
        }

        // Top drivers
        if (aggregations.top_drivers?.buckets) {
            analytics.topDrivers = aggregations.top_drivers.buckets.map(bucket => ({
                driverId: bucket.key,
                tripCount: bucket.doc_count,
                avgRating: bucket.avg_rating?.value || 0,
                totalRevenue: bucket.total_revenue?.value || 0,
                statusBreakdown: bucket.completion_rate?.buckets.reduce((acc, status) => {
                    acc[status.key] = status.doc_count;
                    return acc;
                }, {})
            }));
        }

        // Top routes
        if (aggregations.top_routes?.buckets) {
            analytics.topRoutes = aggregations.top_routes.buckets.map(bucket => ({
                from: bucket.key[0],
                to: bucket.key[1],
                tripCount: bucket.doc_count,
                avgPrice: bucket.avg_price?.value || 0
            }));
        }

        // Cancellation analysis
        if (aggregations.cancellation_analysis) {
            analytics.cancellationAnalysis = {
                totalCancelled: aggregations.cancellation_analysis.doc_count,
                reasons: aggregations.cancellation_analysis.cancellation_reasons?.buckets.reduce((acc, bucket) => {
                    acc[bucket.key] = bucket.doc_count;
                    return acc;
                }, {}),
                cancelledBy: aggregations.cancellation_analysis.cancelled_by?.buckets.reduce((acc, bucket) => {
                    acc[bucket.key] = bucket.doc_count;
                    return acc;
                }, {})
            };
        }

        // Distance analytics
        if (aggregations.distance_analytics) {
            analytics.distanceAnalytics = {
                avgDistance: aggregations.distance_analytics.avg,
                minDistance: aggregations.distance_analytics.min,
                maxDistance: aggregations.distance_analytics.max,
                totalDistance: aggregations.distance_analytics.sum
            };
        }

        // Vehicle type analysis
        if (aggregations.vehicle_type_analysis?.buckets) {
            aggregations.vehicle_type_analysis.buckets.forEach(bucket => {
                analytics.vehicleTypeAnalysis[bucket.key] = bucket.doc_count;
            });
        }

        return analytics;
    }

    /**
     * Get comprehensive trip analytics for dashboard
     */
    async getComprehensiveAnalytics(timeRange = 'last30d') {
        const endTime = Math.floor(Date.now() / 1000);
        let startTime;

        switch (timeRange) {
            case 'today':
                startTime = moment().startOf('day').unix();
                break;
            case 'yesterday':
                startTime = moment().subtract(1, 'day').startOf('day').unix();
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

        return this.fetchTrips({
            startTime,
            endTime,
            size: 0, // Only get aggregations
            includeAnalytics: true
        });
    }

    /**
     * Advanced search with fuzzy matching
     */
    async advancedSearch(searchText, options = {}) {
        const query = {
            size: options.size || 50,
            query: {
                bool: {
                    should: [
                        // Exact matches
                        { term: { "tripId.keyword": searchText } },
                        { term: { "rideId.keyword": searchText } },
                        { term: { "bookingId.keyword": searchText } },

                        // Fuzzy matches for names
                        { fuzzy: { "rider.name.keyword": { value: searchText, fuzziness: "AUTO" } } },
                        { fuzzy: { "driver.name.keyword": { value: searchText, fuzziness: "AUTO" } } },

                        // Wildcard matches for locations
                        { wildcard: { "from.name.keyword": `*${searchText}*` } },
                        { wildcard: { "to.name.keyword": `*${searchText}*` } },

                        // Phone number matches
                        { wildcard: { "rider.phone.keyword": `*${searchText.replace(/\D/g, '')}*` } },
                        { wildcard: { "driver.phone.keyword": `*${searchText.replace(/\D/g, '')}*` } }
                    ],
                    minimum_should_match: 1
                }
            },
            sort: [{ "_score": { order: "desc" } }, { "createdAt._seconds": { order: "desc" } }]
        };

        try {
            const response = await client.search({
                index: indexName,
                body: query
            });

            return this.processEnhancedResponse(response, options);
        } catch (error) {
            console.error('Error in advanced search:', error);
            throw error;
        }
    }

    /**
     * Get real-time trip updates
     */
    async getRealTimeUpdates(lastUpdateTime) {
        const query = {
            size: 100,
            query: {
                bool: {
                    filter: [
                        {
                            range: {
                                "updatedAt._seconds": {
                                    gt: lastUpdateTime
                                }
                            }
                        }
                    ]
                }
            },
            sort: [{ "updatedAt._seconds": { order: "desc" } }]
        };

        try {
            const response = await client.search({
                index: indexName,
                body: query
            });

            const hits = response.body ? response.body.hits.hits : response.hits.hits;
            return {
                updates: hits.map(hit => this.formatEnhancedTripData(hit._source)),
                lastUpdateTime: hits.length > 0 ? hits[0]._source.updatedAt._seconds : lastUpdateTime
            };
        } catch (error) {
            console.error('Error getting real-time updates:', error);
            throw error;
        }
    }

    /**
     * Cache management
     */
    cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    clearCache() {
        this.cache.clear();
    }

    /**
     * Get sort field mapping
     */
    getSortField(sortBy) {
        const sortFields = {
            'createdAt': 'createdAt._seconds',
            'startTime': 'startTime._seconds',
            'endTime': 'endTime._seconds',
            'scheduledTime': 'scheduledTime._seconds',
            'updatedAt': 'updatedAt._seconds',
            'price': 'price',
            'distance': 'calculatedDistanceInKm',
            'tripId': 'tripId.keyword',
            'tripStatus': 'tripStatus.keyword',
            'driverRating': 'driver.rating'
        };

        return sortFields[sortBy] || 'createdAt._seconds';
    }

    /**
     * Health check for Elasticsearch connection
     */
    async healthCheck() {
        try {
            const health = await client.cluster.health();
            const indexStats = await client.indices.stats({ index: indexName });

            return {
                status: 'healthy',
                cluster: health.body,
                indexStats: indexStats.body
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // All other existing methods remain the same...
    async getTripById(tripId) {
        try {
            const response = await client.search({
                index: indexName,
                body: {
                    query: { term: { "tripId.keyword": tripId } },
                    size: 1
                }
            });

            const hits = response.body ? response.body.hits.hits : response.hits.hits;
            if (hits.length === 0) {
                throw new Error(`Trip with ID ${tripId} not found`);
            }

            return this.formatEnhancedTripData(hits[0]._source);
        } catch (error) {
            console.error('Error fetching trip by ID:', error);
            throw error;
        }
    }

    async getTripsByDateRange(startDate, endDate, options = {}) {
        const startTime = Math.floor(new Date(startDate).getTime() / 1000);
        const endTime = Math.floor(new Date(endDate).getTime() / 1000);

        return this.fetchTrips({ ...options, startTime, endTime });
    }

    async getRecentTrips(timeValue = 24, timeUnit = 'hours', options = {}) {
        const endTime = Math.floor(Date.now() / 1000);
        let startTime;

        switch (timeUnit) {
            case 'hours': startTime = endTime - (timeValue * 3600); break;
            case 'days': startTime = endTime - (timeValue * 24 * 3600); break;
            case 'weeks': startTime = endTime - (timeValue * 7 * 24 * 3600); break;
            default: startTime = endTime - (timeValue * 3600);
        }

        return this.fetchTrips({ ...options, startTime, endTime });
    }

    async getDriverAnalytics(driverId, options = {}) {
        const query = {
            size: 0,
            query: { term: { "driver.id.keyword": driverId } },
            aggs: {
                total_trips: { value_count: { field: "tripId.keyword" } },
                completed_trips: { filter: { term: { "tripStatus.keyword": "completed" } } },
                cancelled_trips: { filter: { term: { "tripStatus.keyword": "cancelled" } } },
                total_revenue: { sum: { field: "price" } },
                avg_rating: { avg: { field: "driver.rating" } },
                trip_status_breakdown: { terms: { field: "tripStatus.keyword" } }
            }
        };

        try {
            const response = await client.search({ index: indexName, body: query });
            return { driverId, analytics: response.aggregations };
        } catch (error) {
            console.error('Error fetching driver analytics:', error);
            throw error;
        }
    }

    async searchTrips(searchText, options = {}) {
        return this.advancedSearch(searchText, options);
    }

    /**
     * Check polyline existence and get statistics
     */
    async getPolylineStatistics(options = {}) {
        const {
            startTime,
            endTime,
            tripStatus,
            rideType,
            driverId,
            riderId
        } = options;

        try {
            const query = {
                size: 0, // Only get aggregations
                query: { bool: { filter: [] } },
                aggs: {
                    total_trips: {
                        value_count: { field: "tripId.keyword" }
                    },
                    trips_with_polyline: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: "distanceMatrices.polyline" } },
                                    {
                                        bool: {
                                            must_not: [
                                                { term: { "distanceMatrices.polyline.keyword": "" } }
                                            ]
                                        }
                                    }
                                ]
                            }
                        }
                    },
                    trips_without_polyline: {
                        filter: {
                            bool: {
                                should: [
                                    {
                                        bool: {
                                            must_not: [
                                                { exists: { field: "distanceMatrices.polyline" } }
                                            ]
                                        }
                                    },
                                    { term: { "distanceMatrices.polyline.keyword": "" } }
                                ]
                            }
                        }
                    },
                    polyline_coverage_by_status: {
                        terms: { field: "tripStatus.keyword", size: 20 },
                        aggs: {
                            with_polyline: {
                                filter: {
                                    bool: {
                                        must: [
                                            { exists: { field: "distanceMatrices.polyline" } },
                                            {
                                                bool: {
                                                    must_not: [
                                                        { term: { "distanceMatrices.polyline.keyword": "" } }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    },
                    polyline_coverage_by_ride_type: {
                        terms: { field: "rideType.keyword", size: 20 },
                        aggs: {
                            with_polyline: {
                                filter: {
                                    bool: {
                                        must: [
                                            { exists: { field: "distanceMatrices.polyline" } },
                                            {
                                                bool: {
                                                    must_not: [
                                                        { term: { "distanceMatrices.polyline.keyword": "" } }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    },
                    daily_polyline_coverage: {
                        date_histogram: {
                            field: "createdAt._seconds",
                            calendar_interval: "1d",
                            format: "yyyy-MM-dd"
                        },
                        aggs: {
                            with_polyline: {
                                filter: {
                                    bool: {
                                        must: [
                                            { exists: { field: "distanceMatrices.polyline" } },
                                            {
                                                bool: {
                                                    must_not: [
                                                        { term: { "distanceMatrices.polyline.keyword": "" } }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                }
            };

            // Add filters based on options
            if (startTime || endTime) {
                const rangeFilter = { range: { "createdAt._seconds": {} } };
                if (startTime) rangeFilter.range["createdAt._seconds"].gte = startTime;
                if (endTime) rangeFilter.range["createdAt._seconds"].lte = endTime;
                query.query.bool.filter.push(rangeFilter);
            }

            if (tripStatus) {
                query.query.bool.filter.push({
                    term: { "tripStatus.keyword": tripStatus }
                });
            }

            await this.getTrips();

            if (rideType) {
                query.query.bool.filter.push({
                    term: { "rideType.keyword": rideType }
                });
            }

            if (driverId) {
                query.query.bool.filter.push({
                    term: { "driver.id.keyword": driverId }
                });
            }

            if (riderId) {
                query.query.bool.filter.push({
                    term: { "rider.id.keyword": riderId }
                });
            }

            console.log('Executing polyline statistics query...');
            const response = await client.search({
                index: indexName,
                body: query,
                timeout: '30s'
            });

            return this.processPolylineStatistics(response.aggregations);

        } catch (error) {
            console.error('Error fetching polyline statistics:', error);
            throw error;
        }
    }

    /**
     * Process polyline statistics response
     */
    processPolylineStatistics(aggregations) {
        const totalTrips = aggregations.total_trips.value;
        const tripsWithPolyline = aggregations.trips_with_polyline.doc_count;
        const tripsWithoutPolyline = aggregations.trips_without_polyline.doc_count;

        console.log(aggregations.trips_with_polyline);
        const coveragePercentage = totalTrips > 0 ?
            ((tripsWithPolyline / totalTrips) * 100).toFixed(2) : 0;

        const statistics = {
            overview: {
                totalTrips,
                tripsWithPolyline,
                tripsWithoutPolyline,
                coveragePercentage: parseFloat(coveragePercentage)
            },
            coverageByStatus: {},
            coverageByRideType: {},
            dailyCoverage: []
        };

        // Process coverage by status
        if (aggregations.polyline_coverage_by_status?.buckets) {
            aggregations.polyline_coverage_by_status.buckets.forEach(bucket => {
                const total = bucket.doc_count;
                const withPolyline = bucket.with_polyline.doc_count;
                statistics.coverageByStatus[bucket.key] = {
                    total,
                    withPolyline,
                    withoutPolyline: total - withPolyline,
                    coveragePercentage: total > 0 ?
                        parseFloat(((withPolyline / total) * 100).toFixed(2)) : 0
                };
            });
        }

        // Process coverage by ride type
        if (aggregations.polyline_coverage_by_ride_type?.buckets) {
            aggregations.polyline_coverage_by_ride_type.buckets.forEach(bucket => {
                const total = bucket.doc_count;
                const withPolyline = bucket.with_polyline.doc_count;
                statistics.coverageByRideType[bucket.key] = {
                    total,
                    withPolyline,
                    withoutPolyline: total - withPolyline,
                    coveragePercentage: total > 0 ?
                        parseFloat(((withPolyline / total) * 100).toFixed(2)) : 0
                };
            });
        }

        // Process daily coverage
        if (aggregations.daily_polyline_coverage?.buckets) {
            statistics.dailyCoverage = aggregations.daily_polyline_coverage.buckets.map(bucket => {
                const total = bucket.doc_count;
                const withPolyline = bucket.with_polyline.doc_count;
                return {
                    date: bucket.key_as_string,
                    total,
                    withPolyline,
                    withoutPolyline: total - withPolyline,
                    coveragePercentage: total > 0 ?
                        parseFloat(((withPolyline / total) * 100).toFixed(2)) : 0
                };
            });
        }

        return statistics;
    }

    /**
     * Enhanced fetch trips with polyline filtering
     */
    async fetchTripsWithPolylineFilter(options = {}) {
        const {
            polylineRequired = true, // true = only trips with polyline, false = only trips without polyline, null = all trips
            validatePolyline = false, // if true, also validate polyline format
            ...otherOptions
        } = options;

        // Add polyline filter to the existing query building logic
        const originalQuery = this.buildEnhancedQuery(otherOptions);

        if (polylineRequired !== null) {
            if (polylineRequired) {
                // Only trips WITH polyline
                originalQuery.query.bool.filter.push({
                    bool: {
                        must: [
                            { exists: { field: "distanceMatrices.polyline" } },
                            {
                                bool: {
                                    must_not: [
                                        { term: { "distanceMatrices.polyline.keyword": "" } }
                                    ]
                                }
                            }
                        ]
                    }
                });

                if (validatePolyline) {
                    // Add basic polyline validation (check if it's not empty and has reasonable length)
                    originalQuery.query.bool.filter.push({
                        script: {
                            script: {
                                source: "doc['distanceMatrices.polyline.keyword'].value.length() > 10",
                                lang: "painless"
                            }
                        }
                    });
                }
            } else {
                // Only trips WITHOUT polyline
                originalQuery.query.bool.filter.push({
                    bool: {
                        should: [
                            {
                                bool: {
                                    must_not: [
                                        { exists: { field: "distanceMatrices.polyline" } }
                                    ]
                                }
                            },
                            { term: { "distanceMatrices.polyline.keyword": "" } }
                        ]
                    }
                });
            }
        }

        try {
            console.log('Executing enhanced trip query with polyline filter...');
            const response = await client.search({
                index: indexName,
                body: originalQuery,
                timeout: '30s'
            });

            const result = this.processEnhancedResponse(response, options);

            // Add polyline-specific metadata
            result.polylineFilter = {
                required: polylineRequired,
                validated: validatePolyline,
                appliedAt: new Date().toISOString()
            };

            return result;

        } catch (error) {
            console.error('Error fetching trips with polyline filter:', error);
            throw error;
        }
    }

    /**
     * Get trips with detailed polyline information
     */
    async getTripsWithPolylineDetails(options = {}) {
        const { includePolylineMetrics = true, ...searchOptions } = options;

        const result = await this.fetchTripsWithPolylineFilter({
            ...searchOptions,
            polylineRequired: true,
            validatePolyline: true
        });

        if (includePolylineMetrics && result.trips.length > 0) {
            // Add polyline metrics to each trip
            result.trips = result.trips.map(trip => {
                if (trip.distanceMatrices?.polyline) {
                    const polyline = trip.distanceMatrices.polyline;
                    trip.polylineMetrics = {
                        length: polyline.length,
                        isValid: polyline.length > 10,
                        estimatedPoints: this.estimatePolylinePoints(polyline),
                        hasMultipleRoutes: Array.isArray(trip.distanceMatrices) && trip.distanceMatrices.length > 1
                    };
                }
                return trip;
            });

            // Add aggregate polyline metrics
            result.polylineMetrics = {
                totalTripsWithPolyline: result.trips.length,
                averagePolylineLength: result.trips.reduce((sum, trip) =>
                    sum + (trip.polylineMetrics?.length || 0), 0) / result.trips.length,
                validPolylines: result.trips.filter(trip =>
                    trip.polylineMetrics?.isValid).length,
                invalidPolylines: result.trips.filter(trip =>
                    !trip.polylineMetrics?.isValid).length
            };
        }

        return result;
    }

    /**
     * Estimate number of points in a polyline (rough calculation)
     */
    estimatePolylinePoints(polyline) {
        // Very rough estimation based on polyline string length
        // Actual point count would require decoding the polyline
        return Math.floor(polyline.length / 5);
    }

    /**
     * Validate individual trip's polyline data
     */
    async validateTripPolyline(tripId) {
        try {
            const trip = await this.getTripById(tripId);

            const validation = {
                tripId,
                hasPolyline: false,
                isValid: false,
                details: {},
                issues: []
            };

            if (!trip.distanceMatrices) {
                validation.issues.push('No distanceMatrices field found');
                return validation;
            }

            const polylineData = trip.distanceMatrices.polyline;

            if (!polylineData) {
                validation.issues.push('No polyline field in distanceMatrices');
                return validation;
            }

            if (typeof polylineData !== 'string') {
                validation.issues.push('Polyline is not a string');
                return validation;
            }

            if (polylineData.length === 0) {
                validation.issues.push('Polyline is empty string');
                return validation;
            }

            validation.hasPolyline = true;

            // Basic validation checks
            validation.details = {
                length: polylineData.length,
                startsWithValidChar: /^[a-zA-Z0-9_\-@\?\\]/.test(polylineData),
                hasValidChars: /^[a-zA-Z0-9_\-@\?\\`~]+$/.test(polylineData),
                estimatedPoints: this.estimatePolylinePoints(polylineData)
            };

            // Check if polyline seems valid
            if (validation.details.length < 10) {
                validation.issues.push('Polyline too short (likely invalid)');
            }

            if (!validation.details.startsWithValidChar) {
                validation.issues.push('Polyline starts with invalid character');
            }

            if (!validation.details.hasValidChars) {
                validation.issues.push('Polyline contains invalid characters');
            }

            validation.isValid = validation.issues.length === 0;

            return validation;

        } catch (error) {
            return {
                tripId,
                hasPolyline: false,
                isValid: false,
                error: error.message,
                issues: ['Error validating trip: ' + error.message]
            };
        }
    }

    /**
     * Bulk validate polylines for multiple trips
     */
    async bulkValidatePolylines(tripIds) {
        const validations = [];

        for (const tripId of tripIds) {
            try {
                const validation = await this.validateTripPolyline(tripId);
                validations.push(validation);
            } catch (error) {
                validations.push({
                    tripId,
                    hasPolyline: false,
                    isValid: false,
                    error: error.message,
                    issues: ['Bulk validation error: ' + error.message]
                });
            }
        }

        const summary = {
            totalChecked: validations.length,
            withPolyline: validations.filter(v => v.hasPolyline).length,
            valid: validations.filter(v => v.isValid).length,
            invalid: validations.filter(v => v.hasPolyline && !v.isValid).length,
            missing: validations.filter(v => !v.hasPolyline).length
        };

        return {
            summary,
            validations,
            checkedAt: new Date().toISOString()
        };
    }

    async getTrips() {

        try {
            // time range filter
            const response = await client.search({
                index: indexName,
                body: {
                    query: {
                        bool: {
                            filter: [
                                {
                                    range: {
                                        "createdAt._seconds": {
                                            gte: moment().subtract(1, 'days').unix(),
                                            lte: moment().unix()
                                        }
                                    }
                                }
                            ]
                        }


                    },
                    size: 10000, // Adjust size as needed
                    sort: [{ "createdAt._seconds": { order: "desc" } }]
                }
            });
            const hits = response.body ? response.body.hits.hits : response.hits.hits;
            let polylineCount = 0;
            let noPolylineCount = 0;
            let tripCountWithNoPolyline = 0;
            let noDistanceMatricesCount = 0;
            let emptyDistanceMatricesCount = 0;

            for (let hit of hits) {
                const trip = hit._source;
                if (!trip || !trip.distanceMatrices) {
                    noDistanceMatricesCount++;
                    continue; // Skip if no distanceMatrices
                }
                let hasPolyline = true;
                if (trip.distanceMatrices.length === 0) {
                    emptyDistanceMatricesCount++;
                    console.log(trip.distanceMatrices);
                    hasPolyline = false;
                }
                for (let x= 0; x < trip.distanceMatrices.length; x++) {
                    if (trip.distanceMatrices[x].polyline && trip.distanceMatrices[x].polyline.length > 0) {
                        polylineCount++;
                    } else {
                        hasPolyline = false;
                        noPolylineCount++;
                        console.log(moment.unix(trip.createdAt._seconds).format('YYYY-MM-DD HH:mm:ss'), 'No polyline for trip:', trip.tripId, 'appVersion:', trip.appVersion, 'distanceMatrices:', trip.distanceMatrices[x]);
                    }
                }
                if (!hasPolyline) {
                    tripCountWithNoPolyline++;
                }
            }

            console.log(`Total trips: ${hits.length}\nPolyline count: ${polylineCount}\nNo polyline count: ${noPolylineCount}\nNo distanceMatrices array count: ${noDistanceMatricesCount}`);
            console.log(`Trip count with no polyline: ${tripCountWithNoPolyline}\nEmpty distanceMatrices array count: ${emptyDistanceMatricesCount}`);
            return hits.map(hit => this.formatEnhancedTripData(hit._source));
        } catch (error) {
            console.error('Error fetching trips:', error);
            throw error;
        }
    }
}

module.exports = new TripAnalysisFetcher();