const { upsertFile, slugify, requireGitHub } = require('./_lib/github');
const { buildViewerHtml, buildServiceWorker } = require('./_lib/viewer');

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    requireGitHub();
    const body = parseBody(req);
    const name = String(body.name || '').trim();
    const slug = slugify(body.slug || name);
    const content = body.content;

    if (!name) return res.status(400).json({ ok: false, error: 'Presentation name is required' });
    if (!slug) return res.status(400).json({ ok: false, error: 'A valid slug is required' });
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ ok: false, error: 'Presentation content is required' });
    }

    content.settings = content.settings || {};
    content.settings.presentationName = name;
    content.settings.presentationSlug = slug;
    content.meta = {
      ...(content.meta || {}),
      name,
      slug,
      updatedAt: new Date().toISOString()
    };

    const cacheVersion = `presentation-${slug}-v${Date.now()}`;
    const basePath = `presentations/${slug}`;
    const viewerHtml = buildViewerHtml({
      assetBase: '../../',
      trackingEnabled: true,
      presentationSlug: slug,
      presentationVariant: 'live',
      presentationName: name,
      cacheVersion
    });
    const swJs = buildServiceWorker(cacheVersion);
    const contentJson = `${JSON.stringify(content, null, 2)}\n`;

    await upsertFile({
      path: `${basePath}/content.json`,
      content: contentJson,
      message: `Publish ${name} presentation content`
    });
    await upsertFile({
      path: `${basePath}/index.html`,
      content: viewerHtml,
      message: `Publish ${name} presentation viewer`
    });
    await upsertFile({
      path: `${basePath}/sw.js`,
      content: swJs,
      message: `Publish ${name} presentation service worker`
    });

    const url = `/presentations/${slug}/`;
    return res.status(200).json({
      ok: true,
      name,
      slug,
      url,
      absoluteUrl: null
    });
  } catch (error) {
    console.error('publish failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to publish presentation'
    });
  }
};
