const fs = require('fs');
const path = require('path');

function loadTemplateHtml() {
  const templatePath = path.join(process.cwd(), 'index.html');
  return fs.readFileSync(templatePath, 'utf8');
}

function buildViewerHtml({
  assetBase,
  trackingEnabled = true,
  presentationSlug = '',
  presentationVariant = 'live',
  presentationName = '',
  cacheVersion
}) {
  let html = loadTemplateHtml();

  html = html.replace(
    /const ASSET_BASE = ['`][^'`]*(?:['`]);/,
    `const ASSET_BASE = '${assetBase}';`
  );

  html = html.replace(
    /const TRACKING_ENABLED = (true|false);/,
    `const TRACKING_ENABLED = ${trackingEnabled ? 'true' : 'false'};`
  );

  html = html.replace(
    /const PRESENTATION_SLUG = ['`][^'`]*(?:['`]);/,
    `const PRESENTATION_SLUG = '${presentationSlug.replace(/'/g, "\\'")}';`
  );

  html = html.replace(
    /const PRESENTATION_VARIANT = ['`][^'`]*(?:['`]);/,
    `const PRESENTATION_VARIANT = '${presentationVariant.replace(/'/g, "\\'")}';`
  );

  if (presentationName) {
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${presentationName} - GPC Strategic Partnership</title>`
    );
    html = html.replace(
      /Fiber Connectivity and Communications Solutions for [^<]+/,
      `Fiber Connectivity and Communications Solutions for ${presentationName}`
    );
  }

  // Hardcoded root logo references become asset-base aware in published copies.
  html = html.replace(
    /src="GPC-White-1-1\.webp"/g,
    `src="${assetBase}GPC-White-1-1.webp"`
  );

  return html;
}

function buildServiceWorker(cacheVersion) {
  return `const CACHE_VERSION = '${cacheVersion}';
const APP_SHELL = [
  './',
  './index.html',
  './content.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
`;
}

function applyMeetingRecap(content, recap = {}) {
  const next = JSON.parse(JSON.stringify(content));
  next.settings = next.settings || {};

  if (next.mapData?.agenda) {
    next.mapData.agenda.title = 'Meeting Recap';
    next.mapData.agenda.navLabel = 'Meeting Recap';
    next.mapData.agenda.subtitle = recap.subtitle || 'Follow-Up from Our Conversation';
  }

  if (next.pageContent?.agenda) {
    next.pageContent.agenda.kicker = 'Meeting Recap';
    next.pageContent.agenda.headline = recap.headline || 'Thank you for the conversation. Here are the next steps.';
    if (Array.isArray(recap.items) && recap.items.length) {
      next.pageContent.agenda.items = recap.items.map(item => String(item || '').trim()).filter(Boolean);
    }
  }

  const includeRightfiber = recap.includeRightfiber !== false;
  const ensureNav = (list = []) => {
    const order = Array.isArray(list) ? list.slice() : [];
    if (!includeRightfiber) return order.filter(id => id !== 'rightfiber');
    if (!order.includes('rightfiber')) {
      const after = order.indexOf('core-capabilities');
      if (after >= 0) order.splice(after + 1, 0, 'rightfiber');
      else order.unshift('rightfiber');
    }
    return order;
  };

  next.navOrder = ensureNav(next.navOrder || next.settings.extendedNav || []);
  next.settings.extendedNav = ensureNav(next.settings.extendedNav || next.navOrder || []);
  next.settings.keyConceptsNav = ensureNav(next.settings.keyConceptsNav || []);

  return next;
}

module.exports = {
  buildViewerHtml,
  buildServiceWorker,
  applyMeetingRecap
};
