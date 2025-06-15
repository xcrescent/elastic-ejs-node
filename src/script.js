const { Client } = require('@elastic/elasticsearch');

// Initialize Elasticsearch client
const client = new Client({

    cloud: { id: 'myrik:YXNpYS1zb3V0aDEuZ2NwLmVsYXN0aWMtY2xvdWQuY29tOjQ0MyQxNmU0MTAyZGU5NzY0ZmYzOTkxOTg5ZGYxYzlkN2I0ZiRiYmU4N2MxMzM4ZDU0NzkwYmY1MTdiMTgzMDY1YTdjNg==' },
    auth: {
        username: 'elastic',
        password: '7WBeQ11eFFh9zTW5TUXhcTMq'
    },
    requestTimeout: 30000,
    pingTimeout: 3000
});

/**
 * Update URL for a single document by ID
 */
async function updateSingleAdUrl(documentId, newUrl) {
    try {
        const response = await client.update({
            index: 'ads',
            id: documentId,
            body: {
                doc: {
                    url: newUrl,
                    updated_at: new Date().toISOString()
                }
            }
        });

        console.log(`Successfully updated document ${documentId}`);
        return response;
    } catch (error) {
        console.error('Error updating single document:', error);
        throw error;
    }
}

/**
 * Update URLs for multiple documents matching criteria
 */
async function updateMultipleAdUrls(query, newUrl) {
    try {
        const response = await client.updateByQuery({
            index: 'ads',
            body: {
                script: {
                    source: `
            ctx._source.url = params.new_url;
            ctx._source.updated_at = params.timestamp;
          `,
                    params: {
                        new_url: newUrl,
                        timestamp: new Date().toISOString()
                    }
                },
                query: query
            },
            refresh: true,
            conflicts: 'proceed'
        });

        console.log(`Updated ${response.body.updated} documents`);
        return response;
    } catch (error) {
        console.error('Error updating multiple documents:', error);
        throw error;
    }
}

/**
 * Replace domain in URLs matching a pattern
 */
async function replaceDomainInUrls(oldDomain, newDomain) {
    try {
        const response = await client.updateByQuery({
            index: 'ads',
            body: {
                script: {
                    source: `
            if (ctx._source.url != null && ctx._source.url.contains(params.old_domain)) {
              ctx._source.url = ctx._source.url.replace(params.old_domain, params.new_domain);
              ctx._source.updated_at = params.timestamp;
            }
          `,
                    params: {
                        old_domain: oldDomain,
                        new_domain: newDomain,
                        timestamp: new Date().toISOString()
                    }
                },
                query: {
                    wildcard: {
                        url: `*${oldDomain}*`
                    }
                }
            },
            refresh: true,
            conflicts: 'proceed'
        });

        console.log(`Updated ${response.body.updated} documents with domain replacement`);
        return response;
    } catch (error) {
        console.error('Error replacing domain:', error);
        throw error;
    }
}

/**
 * Bulk update multiple specific documents
 */
async function bulkUpdateAdUrls(updates) {
    try {
        const body = [];

        updates.forEach(update => {
            body.push({
                update: {
                    _index: 'ads',
                    _id: update.id
                }
            });
            body.push({
                doc: {
                    url: update.url,
                    updated_at: new Date().toISOString()
                }
            });
        });

        const response = await client.bulk({
            body: body,
            refresh: true
        });

        const errors = response.body.items.filter(item => item.update.error);
        if (errors.length > 0) {
            console.error('Some updates failed:', errors);
        }

        console.log(`Bulk update completed. ${updates.length - errors.length} successful updates`);
        return response;
    } catch (error) {
        console.error('Error in bulk update:', error);
        throw error;
    }
}

/**
 * Update URL with validation and error handling
 */
async function updateAdUrlWithValidation(documentId, newUrl) {
    try {
        // Validate URL format
        new URL(newUrl); // Throws if invalid

        // Check if document exists
        const exists = await client.exists({
            index: 'ads',
            id: documentId
        });

        if (!exists.body) {
            throw new Error(`Document with ID ${documentId} does not exist`);
        }

        // Update the document
        const response = await client.update({
            index: 'ads',
            id: documentId,
            body: {
                doc: {
                    url: newUrl,
                    updated_at: new Date().toISOString()
                }
            }
        });

        console.log(`Successfully updated and validated document ${documentId}`);
        return response;
    } catch (error) {
        console.error('Error in validated update:', error);
        throw error;
    }
}

// Example usage functions
async function examples() {
    try {
        // Example 1: Update single document
        await updateSingleAdUrl('ad-123', 'https://new-landing-page.com');

        // Example 2: Update all active ads
        await updateMultipleAdUrls(
            { match: { status: 'active' } },
            'https://default-active-url.com'
        );

        // Example 3: Replace old domain with new domain
        await replaceDomainInUrls('old-site.com', 'new-site.com');

        // Example 4: Bulk update specific documents
        await bulkUpdateAdUrls([
            { id: 'ad-1', url: 'https://new-url-1.com' },
            { id: 'ad-2', url: 'https://new-url-2.com' },
            { id: 'ad-3', url: 'https://new-url-3.com' }
        ]);

        // Example 5: Update with validation
        await updateAdUrlWithValidation('ad-456', 'https://validated-url.com');

    } catch (error) {
        console.error('Example execution failed:', error);
    }
}
updateSingleAdUrl('1960eae0-a50b-11ef-a3c1-01adad2db9d0', 'https://storage.googleapis.com/transcoded_ads/output_1749274527932/master.m3u8');

// Export functions for use in other modules
module.exports = {
    updateSingleAdUrl,
    updateMultipleAdUrls,
    replaceDomainInUrls,
    bulkUpdateAdUrls,
    updateAdUrlWithValidation,
    examples
};