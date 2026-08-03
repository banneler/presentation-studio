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
  // Shallow-clone only mutated branches so large embedded data-URL assets are not
  // duplicated in memory during follow-up publish.
  const source = content && typeof content === 'object' ? content : {};
  const next = { ...source };
  next.settings = { ...(source.settings || {}) };
  next.mapData = { ...(source.mapData || {}) };
  next.pageContent = { ...(source.pageContent || {}) };

  if (source.mapData?.agenda) {
    next.mapData.agenda = {
      ...source.mapData.agenda,
      title: 'Meeting Recap',
      navLabel: 'Meeting Recap',
      subtitle: recap.subtitle || 'Follow-Up from Our Conversation'
    };
  }

  if (source.pageContent?.agenda) {
    const agenda = { ...source.pageContent.agenda };
    agenda.kicker = 'Meeting Recap';
    agenda.headline = recap.headline || 'Thank you for the conversation. Here are the next steps.';
    if (Array.isArray(recap.items) && recap.items.length) {
      agenda.items = recap.items.map(item => String(item || '').trim()).filter(Boolean);
    }
    next.pageContent.agenda = agenda;
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

/** Remove duplicated page.logo copies of settings.customerLogo before writing content.json. */
function stripDuplicatePageLogos(content) {
  if (!content || typeof content !== 'object') return content;
  const globalLogo = content.settings?.customerLogo || '';
  Object.values(content.mapData || {}).forEach(page => {
    if (!page || typeof page !== 'object') return;
    if (page.useCustomerLogo === true || page.useCustomerLogo === false) {
      delete page.logo;
      return;
    }
    if (globalLogo && page.logo === globalLogo) {
      page.useCustomerLogo = true;
      delete page.logo;
    }
  });
  return content;
}

function serializePresentationContent(content) {
  stripDuplicatePageLogos(content);
  // Pretty-print is fine for template decks; skip indent for large asset-heavy payloads
  // so GitHub Contents uploads stay smaller/faster.
  const compact = JSON.stringify(content);
  if (compact.length > 400 * 1024) {
    return `${compact}\n`;
  }
  return `${JSON.stringify(content, null, 2)}\n`;
}

module.exports = {
  buildViewerHtml,
  buildServiceWorker,
  applyMeetingRecap,
  stripDuplicatePageLogos,
  serializePresentationContent
};
