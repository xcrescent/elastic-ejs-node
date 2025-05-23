document.addEventListener('DOMContentLoaded', function() {
    // Auto-resize textareas
    const textareas = document.querySelectorAll('textarea');
    textareas.forEach(textarea => {
        textarea.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
    });

    // Copy JSON to clipboard
    const jsonViewers = document.querySelectorAll('.json-viewer pre');
    jsonViewers.forEach(pre => {
        pre.addEventListener('click', function() {
            const text = this.textContent;
            navigator.clipboard.writeText(text).then(() => {
                // Show temporary tooltip
                const tooltip = document.createElement('div');
                tooltip.textContent = 'Copied!';
                tooltip.style.cssText = 'position: absolute; background: #000; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 12px; z-index: 1000;';
                document.body.appendChild(tooltip);

                const rect = this.getBoundingClientRect();
                tooltip.style.left = rect.left + 'px';
                tooltip.style.top = (rect.top - 30) + 'px';

                setTimeout(() => {
                    document.body.removeChild(tooltip);
                }, 1500);
            });
        });

        // Add cursor pointer to indicate clickable
        pre.style.cursor = 'pointer';
        pre.title = 'Click to copy JSON';
    });

    // Format JSON in custom query textarea
    const queryTextarea = document.getElementById('query');
    if (queryTextarea) {
        queryTextarea.addEventListener('blur', function() {
            try {
                const parsed = JSON.parse(this.value);
                this.value = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // Invalid JSON, leave as is
            }
        });
    }

    // Auto-refresh connection status
    setInterval(checkConnectionStatus, 30000);
});

function checkConnectionStatus() {
    fetch('/api/health')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'ok') {
                // Update UI to show healthy connection
                console.log('Elasticsearch connection healthy');
            }
        })
        .catch(error => {
            console.warn('Elasticsearch connection issue:', error);
        });
}

// Utility function to highlight search terms
function highlightSearchTerms(text, searchTerm) {
    if (!searchTerm) return text;
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}