const express = require('express');
const router = express.Router();

router.get('/health', async (req, res) => {
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