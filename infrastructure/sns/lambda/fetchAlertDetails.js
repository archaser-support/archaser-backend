'use strict';

const https = require('https');
const http = require('http');
const { resolveAlertDetailsType } = require('./resolveAlertType');

async function fetchAlertDetailsByType(alertType, limit = 10) {
  const apiUrl = process.env.ALERT_DETAILS_API_URL;
  const apiKey = process.env.ALERT_DETAILS_API_KEY;

  if (!apiUrl || !apiKey) {
    console.log('Alert details API not configured, skipping details fetch');
    return null;
  }
  if (!alertType) {
    return null;
  }

  try {
    const url = `${apiUrl}?type=${encodeURIComponent(alertType)}&limit=${limit}`;
    console.log(`Fetching alert details from: ${url}`);

    const response = await new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(
        url,
        { headers: { 'x-api-key': apiKey } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`API returned ${res.statusCode}: ${data}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });

    return response;
  } catch (error) {
    console.error('Failed to fetch alert details:', error.message);
    return null;
  }
}

async function fetchAlertDetailsForAlert(alert, fallbackName) {
  const alertType = resolveAlertDetailsType(alert, fallbackName);
  if (!alertType) {
    console.log(
      `No alert details type resolved for: ${fallbackName || alert?.labels?.alertname || 'unknown'}`
    );
    return null;
  }
  return fetchAlertDetailsByType(alertType);
}

/**
 * Fetch details once per resolved type for a batch of alerts.
 * Returns an array aligned with alerts[].
 */
async function fetchDetailsByAlertIndex(alerts, groupAlertName) {
  const typeByIndex = alerts.map((alert) =>
    resolveAlertDetailsType(alert, groupAlertName)
  );
  const uniqueTypes = [...new Set(typeByIndex.filter(Boolean))];
  const detailsByType = {};
  await Promise.all(
    uniqueTypes.map(async (type) => {
      detailsByType[type] = await fetchAlertDetailsByType(type);
    })
  );
  return typeByIndex.map((type) => (type ? detailsByType[type] || null : null));
}

module.exports = {
  fetchAlertDetailsByType,
  fetchAlertDetailsForAlert,
  fetchDetailsByAlertIndex,
};
