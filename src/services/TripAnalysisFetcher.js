const {Client} = require("@elastic/elasticsearch");
const moment = require('moment');

const client = new Client({
    cloud: { id: process.env.ELASTIC_CLOUD_ID},
    auth: {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD
    }
});

const indexName = 'prod_trips';

class TripAnalysisFetcher {

    /**
     * Fetch trip data with comprehensive filtering options
     * @param {Object} options - Query options
     * @param {string} options.tripId - Specific trip ID
     * @param {string} options.rideId - Specific ride ID
     * @param {string} options.driverId - Driver ID filter
     * @param {string} options.riderId - Rider ID filter
     * @param {string} options.riderPhone - Rider phone number
     * @param {string} options.tripStatus - Trip status filter
     * @param {string} options.paymentStatus - Payment status filter
     * @param {string} options.rideType - Ride type filter
     * @param {number} options.startTime - Start timestamp (seconds)
     * @param {number} options.endTime - End timestamp (seconds)
     * @param {number} options.minPrice - Minimum price filter
     * @param {number} options.maxPrice - Maximum price filter
     * @param {number} options.size - Number of records to fetch
     * @param {string} options.sortBy - Sort field
     * @param {string} options.sortOrder - Sort order (asc/desc)
     * @returns {Promise<Object>} Query results with trip data and analytics
     */
    async fetchTrips(options = {}) {
        const {
            tripId,
            rideId,
            driverId,
            riderId,
            riderPhone,
            tripStatus,
            paymentStatus,
            rideType,
            startTime,
            endTime,
            minPrice,
            maxPrice,
            size = 100,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = options;

        try {
            const query = this.buildQuery(options);

            console.log('Executing Elasticsearch query for trips...');
            console.log('Query:', JSON.stringify(query, null, 2));

            const response = await client.search({
                index: indexName,
                body: query
            });

            return this.processResponse(response, options);
        } catch (error) {
            console.error('Error fetching trip data:', error);
            throw error;
        }
    }

    /**
     * Build comprehensive Elasticsearch query
     */
    buildQuery(options) {
        const {
            tripId,
            rideId,
            driverId,
            riderId,
            riderPhone,
            tripStatus,
            paymentStatus,
            rideType,
            startTime,
            endTime,
            minPrice,
            maxPrice,
            size,
            sortBy,
            sortOrder
        } = options;

        const query = {
            size,
            query: {
                bool: {
                    filter: []
                }
            },
            sort: [],
            aggs: {
                trip_stats: {
                    multi_terms: {
                        terms: [
                            { field: "tripStatus.keyword" },
                            { field: "paymentStatus.keyword" }
                        ]
                    }
                },
                price_stats: {
                    stats: {
                        field: "price"
                    }
                },
                ride_type_breakdown: {
                    terms: {
                        field: "rideType.keyword",
                        size: 10
                    }
                },
                daily_trips: {
                    date_histogram: {
                        field: "createdAt._seconds",
                        calendar_interval: "1d",
                        format: "yyyy-MM-dd"
                    }
                }
            }
        };

        // Build filters
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

        if (riderPhone) {
            // Search in multiple phone fields
            query.query.bool.filter.push({
                bool: {
                    should: [
                        { wildcard: { "rider.phone.keyword": `*${riderPhone}*` } },
                        { wildcard: { "pickUpPhoneNumber.keyword": `*${riderPhone}*` } },
                        { wildcard: { "dropOffPhoneNumber.keyword": `*${riderPhone}*` } }
                    ],
                    minimum_should_match: 1
                }
            });
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

        // Time range filter
        if (startTime || endTime) {
            const rangeFilter = {
                range: {
                    "createdAt._seconds": {}
                }
            };

            if (startTime) rangeFilter.range["createdAt._seconds"].gte = startTime;
            if (endTime) rangeFilter.range["createdAt._seconds"].lte = endTime;

            query.query.bool.filter.push(rangeFilter);
        }

        // Price range filter
        if (minPrice || maxPrice) {
            const priceFilter = {
                range: {
                    "price": {}
                }
            };

            if (minPrice) priceFilter.range.price.gte = minPrice;
            if (maxPrice) priceFilter.range.price.lte = maxPrice;

            query.query.bool.filter.push(priceFilter);
        }

        // Sorting
        const sortField = this.getSortField(sortBy);
        query.sort.push({
            [sortField]: {
                order: sortOrder || 'desc'
            }
        });

        return query;
    }

    /**
     * Get the correct field name for sorting
     */
    getSortField(sortBy) {
        const sortFields = {
            'createdAt': 'createdAt._seconds',
            'startTime': 'startTime._seconds',
            'endTime': 'endTime._seconds',
            'scheduledTime': 'scheduledTime._seconds',
            'price': 'price',
            'tripId': 'tripId.keyword',
            'tripStatus': 'tripStatus.keyword'
        };

        return sortFields[sortBy] || 'createdAt._seconds';
    }

    /**
     * Process Elasticsearch response
     */
    processResponse(response, options) {
        console.log('Processing trip response...');

        const hits = response.body ? response.body.hits.hits : response.hits.hits;
        const totalHits = response.hits.total.value;
        const aggregations = response.aggregations || {};

        const trips = hits.map(hit => this.formatTripData(hit._source));

        // Process aggregations for analytics
        const analytics = this.processAggregations(aggregations);

        const result = {
            totalTrips: totalHits,
            tripsReturned: hits.length,
            trips,
            analytics,
            query: {
                took: response.took,
                timed_out: response.timed_out
            }
        };

        console.log(`Total trips found: ${totalHits}`);
        console.log(`Trips returned: ${hits.length}`);
        console.log('Analytics:', analytics);

        return result;
    }

    /**
     * Format trip data for frontend consumption
     */
    formatTripData(trip) {
        return {
            tripId: trip.tripId,
            rideId: trip.rideId,
            bookingId: trip.bookingId,

            // Driver information
            driver: {
                id: trip.driver?.id,
                name: trip.driver?.name,
                phone: trip.driver?.phone || trip.driverPhone,
                rating: trip.driver?.rating,
                vehicle: {
                    number: trip.driver?.vehicle?.number,
                    type: trip.driver?.vehicleType
                },
                currentLocation: trip.driver?.currentLocation
            },

            // Rider information
            rider: {
                id: trip.rider?.id || trip.riderId,
                name: trip.rider?.name,
                phone: trip.rider?.phone,
                type: trip.rider?.type,
                parentRider: trip.rider?.parentRider
            },

            // Location information
            from: {
                name: trip.from?.name,
                coordinate: trip.from?.coordinate || trip.from?.coordinates,
                shortName: trip.from?.shortName
            },
            to: {
                name: trip.to?.name,
                coordinate: trip.to?.coordinate || trip.to?.coordinates,
                shortName: trip.to?.shortName
            },
            pickUpPoint: trip.pickUpPoint,
            dropOffPoint: trip.dropOffPoint,

            // Trip details
            tripStatus: trip.tripStatus,
            taskStatus: trip.taskStatus,
            bookingStatus: trip.bookingStatus,
            rideType: trip.rideType,
            type: trip.type,
            subType: trip.subType,

            // Pricing
            price: trip.price,
            calculatedPrice: trip.calculatedPrice,
            priceBreakUp: trip.priceBreakUp,
            paymentStatus: trip.paymentStatus,
            paymentType: trip.paymentType,

            // Timing
            createdAt: trip.createdAt,
            startTime: trip.startTime,
            endTime: trip.endTime,
            scheduledAt: trip.scheduledAt,
            scheduledTime: trip.scheduledTime,
            pickUpTime: trip.pickUpTime,

            // Trip progress
            driverArrived: trip.driverArrived,
            driverArrivedTime: trip.driverArrivedTime,
            driverReached: trip.driverReached,
            driverReachedTime: trip.driverReachedTime,

            // Additional details
            bookedSeats: trip.bookedSeats || trip.seatsBooked,
            passengerCount: trip.passengerCount,
            distance: trip.distance,
            calculatedDistanceInKm: trip.calculatedDistanceInKm,
            otp: trip.otp,

            // Cancellation info
            cancelled: trip.cancled, // Note: typo in original field name
            cancelReason: trip.cancelReason,
            canceledBy: trip.canceledBy,
            canceledTime: trip.canceledTime,

            // Contact information
            lastContacted: trip.lastContacted,
            lastContactedBy: trip.lastContactedBy,
            lastContactedByName: trip.lastContactedByName,

            // Admin information
            assignedAdmin: trip.assignedAdmin,
            completedByAdmin: trip.completedByAdmin,
            canceledByAdmin: trip.canceledByAdmin,

            // Special flags
            isRecurringTrip: trip.isRecurringTrip,
            isQrRide: trip.isQrRide,
            bookedForSomeoneElse: trip.bookedForSomeoneElse,
            isDynamicPricingApplied: trip.isDynamicPricingApplied,

            // Location details for analytics
            locationDetails: trip.locationDetails,
            currentLocation: trip.currentLocation
        };
    }

    /**
     * Process aggregations for analytics
     */
    processAggregations(aggregations) {
        const analytics = {
            statusBreakdown: {},
            paymentBreakdown: {},
            rideTypeBreakdown: {},
            priceStats: {},
            dailyTrends: []
        };

        // Process trip status and payment status breakdown
        if (aggregations.trip_stats && aggregations.trip_stats.buckets) {
            aggregations.trip_stats.buckets.forEach(bucket => {
                const [tripStatus, paymentStatus] = bucket.key;
                if (!analytics.statusBreakdown[tripStatus]) {
                    analytics.statusBreakdown[tripStatus] = 0;
                }
                if (!analytics.paymentBreakdown[paymentStatus]) {
                    analytics.paymentBreakdown[paymentStatus] = 0;
                }
                analytics.statusBreakdown[tripStatus] += bucket.doc_count;
                analytics.paymentBreakdown[paymentStatus] += bucket.doc_count;
            });
        }

        // Process ride type breakdown
        if (aggregations.ride_type_breakdown && aggregations.ride_type_breakdown.buckets) {
            aggregations.ride_type_breakdown.buckets.forEach(bucket => {
                analytics.rideTypeBreakdown[bucket.key] = bucket.doc_count;
            });
        }

        // Process price statistics
        if (aggregations.price_stats) {
            analytics.priceStats = {
                min: aggregations.price_stats.min,
                max: aggregations.price_stats.max,
                avg: aggregations.price_stats.avg,
                sum: aggregations.price_stats.sum,
                count: aggregations.price_stats.count
            };
        }

        // Process daily trends
        if (aggregations.daily_trips && aggregations.daily_trips.buckets) {
            analytics.dailyTrends = aggregations.daily_trips.buckets.map(bucket => ({
                date: bucket.key_as_string,
                count: bucket.doc_count
            }));
        }

        return analytics;
    }

    /**
     * Get trip details by specific trip ID
     */
    async getTripById(tripId) {
        try {
            const response = await client.search({
                index: indexName,
                body: {
                    query: {
                        term: {
                            "tripId.keyword": tripId
                        }
                    },
                    size: 1
                }
            });

            const hits = response.body ? response.body.hits.hits : response.hits.hits;

            if (hits.length === 0) {
                throw new Error(`Trip with ID ${tripId} not found`);
            }

            return this.formatTripData(hits[0]._source);
        } catch (error) {
            console.error('Error fetching trip by ID:', error);
            throw error;
        }
    }

    /**
     * Get trips by date range with analytics
     */
    async getTripsByDateRange(startDate, endDate, options = {}) {
        const startTime = Math.floor(new Date(startDate).getTime() / 1000);
        const endTime = Math.floor(new Date(endDate).getTime() / 1000);

        return this.fetchTrips({
            ...options,
            startTime,
            endTime
        });
    }

    /**
     * Get recent trips (last N hours/days)
     */
    async getRecentTrips(timeValue = 24, timeUnit = 'hours', options = {}) {
        const endTime = Math.floor(Date.now() / 1000);
        let startTime;

        switch (timeUnit) {
            case 'hours':
                startTime = endTime - (timeValue * 3600);
                break;
            case 'days':
                startTime = endTime - (timeValue * 24 * 3600);
                break;
            case 'weeks':
                startTime = endTime - (timeValue * 7 * 24 * 3600);
                break;
            default:
                startTime = endTime - (timeValue * 3600);
        }

        return this.fetchTrips({
            ...options,
            startTime,
            endTime
        });
    }

    /**
     * Get driver performance analytics
     */
    async getDriverAnalytics(driverId, options = {}) {
        const query = {
            size: 0,
            query: {
                term: {
                    "driver.id.keyword": driverId
                }
            },
            aggs: {
                total_trips: {
                    value_count: {
                        field: "tripId.keyword"
                    }
                },
                completed_trips: {
                    filter: {
                        term: { "tripStatus.keyword": "completed" }
                    }
                },
                cancelled_trips: {
                    filter: {
                        term: { "tripStatus.keyword": "cancelled" }
                    }
                },
                total_revenue: {
                    sum: {
                        field: "price"
                    }
                },
                avg_rating: {
                    avg: {
                        field: "driver.rating"
                    }
                },
                trip_status_breakdown: {
                    terms: {
                        field: "tripStatus.keyword"
                    }
                }
            }
        };

        try {
            const response = await client.search({
                index: indexName,
                body: query
            });

            return {
                driverId,
                analytics: response.aggregations
            };
        } catch (error) {
            console.error('Error fetching driver analytics:', error);
            throw error;
        }
    }

    /**
     * Search trips with text query (for rider names, locations, etc.)
     */
    async searchTrips(searchText, options = {}) {
        const query = {
            size: options.size || 50,
            query: {
                bool: {
                    should: [
                        { wildcard: { "rider.name.keyword": `*${searchText}*` } },
                        { wildcard: { "driver.name.keyword": `*${searchText}*` } },
                        { wildcard: { "from.name.keyword": `*${searchText}*` } },
                        { wildcard: { "to.name.keyword": `*${searchText}*` } },
                        { wildcard: { "tripId.keyword": `*${searchText}*` } },
                        { wildcard: { "rideId.keyword": `*${searchText}*` } }
                    ],
                    minimum_should_match: 1
                }
            },
            sort: [
                { "createdAt._seconds": { order: "desc" } }
            ]
        };

        try {
            const response = await client.search({
                index: indexName,
                body: query
            });

            return this.processResponse(response, options);
        } catch (error) {
            console.error('Error searching trips:', error);
            throw error;
        }
    }
}

module.exports = new TripAnalysisFetcher();