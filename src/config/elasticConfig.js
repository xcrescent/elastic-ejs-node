const { Client } = require('@elastic/elasticsearch');
// Create client for health check
const client = new Client({
    cloud: { id: process.env.ELASTICSEARCH_URL },
    auth: {
        username: process.env.ES_USERNAME,
        password: process.env.ES_PASSWORD
    }
});

module.exports = client;