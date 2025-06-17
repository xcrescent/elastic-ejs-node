const {Client} = require("@elastic/elasticsearch");
const moment = require('moment');
const polyline = require('@mapbox/polyline');
const client = new Client({
    cloud: { id: process.env.ELASTIC_CLOUD_ID},
    auth: {
        username: process.env.ELASTIC_USERNAME,
        password: process.env.ELASTIC_PASSWORD
    }
});
const indexName =  'prod_ride_location_history';
class RideLocationHistoryFetcher {


    /**
     * Fetch ride location history for a specific driver
     * @param {string} driverId - Driver ID to search for
     * @param {Object} options - Query options
     * @param {number} options.size - Number of records to fetch (default: 500)
     * @param {number} options.startTime - Start timestamp (seconds)
     * @param {number} options.endTime - End timestamp (seconds)
     * @param {boolean} options.calculateDistance - Whether to calculate total distance (default: true)
     * @returns {Promise<Object>} Query results with location data and distance
     */
    async fetchRideLocationHistory(driverId, options = {}) {
        const {
            size = 500,
            startTime,
            endTime,
            calculateDistance = true
        } = options;

        try {
            const query = this.buildQuery(driverId, { size, startTime, endTime, calculateDistance });

            console.log('Executing Elasticsearch query...');
            console.log('Query:', JSON.stringify(query, null, 2));

            const response = await client.search({
                index: indexName,
                body: query
            });

            return this.processResponse(response, driverId);
        } catch (error) {
            console.error('Error fetching ride location history:', error);
            throw error;
        }
    }

    /**
     * Build Elasticsearch query
     */
    buildQuery(driverId, options) {
        const { size, startTime, endTime, calculateDistance } = options;

        const query = {
            size,
            query: {
                bool: {
                    filter: [
                        {
                            term: {
                                "driver.id.keyword": driverId
                            }
                        }
                    ]
                }
            },
            sort: [
                {
                    "createdAt._seconds": {
                        order: "desc"
                    }
                }
            ]
        };

        // Add time range filter if provided
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
        // Add distance calculation aggregation if requested
        if (calculateDistance) {
            query.aggs = {
                distance_traveled: {
                    scripted_metric: {
                        init_script: `
                            state.points = [];
                        `,
                        map_script: `
                            if (doc.containsKey('currentLocation.lat') && doc.containsKey('currentLocation.lng')) {
                                def lat = doc['currentLocation.lat'].value;
                                def lng = doc['currentLocation.lng'].value;
                                def ts = doc['createdAt._seconds'].value;
                                state.points.add([ 'lat': lat, 'lng': lng, 'ts': ts ]);
                            }
                        `,
                        combine_script: `
                            return state.points;
                        `,
                        reduce_script: `
                            def all_points = [];
                            for (s in states) {
                                all_points.addAll(s);
                            }

                            // Sort by timestamp
                            all_points.sort((a, b) -> a.ts.compareTo(b.ts));

                            def total = 0.0;
                            def R = 6371.0; // Earth radius in km

                            for (int i = 1; i < all_points.size(); i++) {
                                def p1 = all_points[i - 1];
                                def p2 = all_points[i];

                                def dLat = Math.toRadians(p2.lat - p1.lat);
                                def dLon = Math.toRadians(p2.lng - p1.lng);
                                def lat1 = Math.toRadians(p1.lat);
                                def lat2 = Math.toRadians(p2.lat);

                                def a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
                                def c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

                                total += R * c;
                            }

                            return total;
                        `
                    }
                }
            };
        }
        return query;
    }

    /**
     * Process Elasticsearch response
     */
    processResponse(response, driverId) {
        console.log(response);
        const hits = response.body ? response.body.hits.hits : response.hits.hits;
        const totalHits = response.hits.total.value;
        let highAccuracyCount = 0;
        let lowAccuracyCount = 0;
        let highAccuracyLocationHistory = [];
        let highAccuracyDistance = 0;
        for (const hit of hits) {
            // console.log(hit._source);
            console.log(hit._source.currentLocation);
            // IST
            console.log(moment.unix(hit._source.createdAt._seconds).format('YYYY-MM-DD HH:mm:ss'));

            if (hit._source.currentLocation.accuracy < 500) {
                highAccuracyCount++;
                highAccuracyLocationHistory.push(hit._source);
                // Calculate distance for high accuracy locations
                if (hit._source.currentLocation.lat && hit._source.currentLocation.lng) {
                    if (highAccuracyLocationHistory.length > 1) {
                        const lastEntry = highAccuracyLocationHistory[highAccuracyLocationHistory.length - 2];
                        highAccuracyDistance += RideLocationHistoryFetcher.calculateDistance(
                            lastEntry.currentLocation.lat, lastEntry.currentLocation.lng,
                            hit._source.currentLocation.lat, hit._source.currentLocation.lng
                        );
                    }
                }
            } else {
                lowAccuracyCount++;
            }
        }
        console.log(`Total records found: ${totalHits}`);
        console.log(`Total records returned: ${hits.length}`);
        console.log(`High accuracy locations: ${highAccuracyCount}`);
        console.log(`Low accuracy locations: ${lowAccuracyCount}`);
        console.log(`Distance traveled: ${response.aggregations ? response.aggregations.distance_traveled.value : 'N/A'} km`);
        console.log(`High accuracy distance: ${highAccuracyDistance.toFixed(2)} km`);
        const highAccuracyPolyline = this.generatePolylineFromLocations(highAccuracyLocationHistory);
        console.log(`High accuracy polyline: ${highAccuracyPolyline}`);
        const locations = hits.map(hit => ({
            id: hit._id,
            rideId: hit._source.rideId,
            currentLocation: hit._source.currentLocation,
            createdAt: hit._source.createdAt,
            driver: hit._source.driver,
            online: hit._source.online,
            bookedSeats: hit._source.bookedSeats,
            outForDelivery: hit._source.outForDelivery,
            checkedIn: hit._source.checkedIn,
            autoRouting: hit._source.autoRouting,
            assignedRouteId: hit._source.assignedRouteId,
            redirectRouteStarted: hit._source.redirectRouteStarted
        }));

        const polyline = this.generatePolylineFromLocations(locations);
        console.log(`Generated polyline: ${polyline}`);

        const result = {
            driverId,
            totalRecords: totalHits,
            recordsReturned: hits.length,
            locations,
            query: {
                took: response.took,
                timed_out: response.timed_out
            }
        };

        // Add distance calculation if available
        if (response.aggregations && response.aggregations.distance_traveled) {
            result.totalDistanceKm = response.aggregations.distance_traveled.value;
        }

        return result;
    }

    generatePolylineFromLocations(locationHistory) {
        // Sort by timestamp to ensure correct order
        const sortedLocations = locationHistory
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .map(location => [location.currentLocation.lat, location.currentLocation.lng]);

        return polyline.encode(sortedLocations, 5); // 5 is the precision level
    }
    /**
     * Helper method to calculate distance between two points (Haversine formula)
     */
    static calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Get ride location history within a specific time range
     */
    async getRideLocationHistoryByTimeRange(driverId, startDate, endDate, options = {}) {
        const startTime = Math.floor(new Date(startDate).getTime() / 1000);
        const endTime = Math.floor(new Date(endDate).getTime() / 1000);

        return this.fetchRideLocationHistory(driverId, {
            ...options,
            startTime,
            endTime
        });
    }

    /**
     * Get recent ride location history (last N hours)
     */
    async getRecentRideLocationHistory(driverId, hoursBack = 24, options = {}) {
        const endTime = Math.floor(Date.now() / 1000);
        const startTime = endTime - (hoursBack * 3600);

        return this.fetchRideLocationHistory(driverId, {
            ...options,
            startTime,
            endTime
        });
    }
}

// // Usage example
// async function main() {
//     // Configure Elasticsearch connection
//     const esConfig = {
//         cloud: { id: 'myrik:YXNpYS1zb3V0aDEuZ2NwLmVsYXN0aWMtY2xvdWQuY29tOjQ0MyQxNmU0MTAyZGU5NzY0ZmYzOTkxOTg5ZGYxYzlkN2I0ZiRiYmU4N2MxMzM4ZDU0NzkwYmY1MTdiMTgzMDY1YTdjNg==' },
//         auth: { username: 'elastic', password: '7WBeQ11eFFh9zTW5TUXhcTMq' }
//     };
//
//     const fetcher = new RideLocationHistoryFetcher(esConfig);
//     const driverId = '48a18460-0dd3-11ef-ab1d-81f61a430ce0';
//
//     try {
//         console.log(`Fetching ride location history for driver: ${driverId}`);
//
//         // Example 1: Get recent history (last 24 hours)
//         const recentHistory = await fetcher.getRecentRideLocationHistory(driverId, 24, {
//             size: 100
//         });
//
//         console.log('Recent History Results:');
//         console.log(`Total records: ${recentHistory.totalRecords}`);
//         console.log(`Records returned: ${recentHistory.recordsReturned}`);
//
//         if (recentHistory.totalDistanceKm !== undefined) {
//             console.log(`Total distance traveled: ${recentHistory.totalDistanceKm.toFixed(2)} km`);
//         }
//
//         // Example 2: Get history for specific date range
//         const specificRange = await fetcher.getRideLocationHistoryByTimeRange(
//             driverId,
//             '2024-01-01T00:00:00Z',
//             '2024-01-02T00:00:00Z',
//             { size: 500 }
//         );
//
//         console.log('\nSpecific Range Results:');
//         console.log(`Total records: ${specificRange.totalRecords}`);
//         console.log(`Records returned: ${specificRange.recordsReturned}`);
//
//         // Example 3: Get history with custom timestamp range (using your reference)
//         const customHistory = await fetcher.fetchRideLocationHistory(driverId, {
//             size: 500,
//             startTime: 1748776740,
//             endTime: 1748800800,
//             calculateDistance: true
//         });
//
//         console.log('\nCustom Range Results:');
//         console.log(`Total records: ${customHistory.totalRecords}`);
//         console.log(`Records returned: ${customHistory.recordsReturned}`);
//
//         if (customHistory.totalDistanceKm !== undefined) {
//             console.log(`Total distance traveled: ${customHistory.totalDistanceKm.toFixed(2)} km`);
//         }
//
//         // Display some location data
//         if (customHistory.locations.length > 0) {
//             console.log('\nSample location data:');
//             customHistory.locations.slice(0, 3).forEach((location, index) => {
//                 console.log(`${index + 1}. Ride: ${location.rideId}`);
//                 console.log(`   Location: ${location.currentLocation.lat}, ${location.currentLocation.lng}`);
//                 console.log(`   Created: ${new Date(location.createdAt._seconds * 1000).toISOString()}`);
//                 console.log(`   Online: ${location.online}, Booked Seats: ${location.bookedSeats}`);
//                 console.log('');
//             });
//         }
//
//     } catch (error) {
//         console.error('Error in main function:', error);
//     }
// }


module.exports = new RideLocationHistoryFetcher();