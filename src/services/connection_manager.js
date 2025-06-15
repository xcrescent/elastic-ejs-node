// services/connection_manager.js
const { Client } = require('@elastic/elasticsearch');

class ConnectionManager {
    constructor() {
        this.connections = new Map();
        this.defaultConnection = null;
    }

    addConnection(connectionId, config) {
        try {
            const client = new Client({
                cloud: { id: config.cloudId },
                auth: {
                    username: config.username,
                    password: config.password
                },
                requestTimeout: 30000,
                pingTimeout: 3000
            });

            this.connections.set(connectionId, {
                client,
                config: {
                    name: config.name,
                    cloudId: config.cloudId,
                    username: config.username,
                    url: config.url
                }
            });

            if (!this.defaultConnection) {
                this.defaultConnection = connectionId;
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getConnection(connectionId) {
        if (!connectionId && this.defaultConnection) {
            connectionId = this.defaultConnection;
        }
        return this.connections.get(connectionId);
    }

    getAllConnections() {
        const connections = {};
        for (const [id, conn] of this.connections) {
            connections[id] = conn.config;
        }
        return connections;
    }

    removeConnection(connectionId) {
        if (this.connections.has(connectionId)) {
            this.connections.delete(connectionId);
            if (this.defaultConnection === connectionId) {
                this.defaultConnection = this.connections.keys().next().value || null;
            }
            return true;
        }
        return false;
    }

    async testConnection(connectionId) {
        const connection = this.getConnection(connectionId);
        if (!connection) {
            return { success: false, error: 'Connection not found' };
        }

        try {
            const response = await connection.client.ping();
            return { success: true, data: response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

module.exports = new ConnectionManager();

