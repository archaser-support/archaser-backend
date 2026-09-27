'use strict';

/** Thin re-export so tests/docs that import clickup-chat-intent.js keep working. */
module.exports = require('./lambda/clickupChat');
module.exports.buildGrafanaDrilldownUrl = require('./lambda/grafanaLinks').buildGrafanaDrilldownUrl;
module.exports.rewriteGrafanaUrls = require('./lambda/grafanaLinks').rewriteGrafanaUrls;
