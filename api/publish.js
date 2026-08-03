const { upsertFile, slugify, requireGitHub } = require('./_lib/github');
const { buildViewerHtml, buildServiceWorker, serializePresentationContent } = require('./_lib/viewer');

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
    content.settings.repName = String(content.settings.repName || body.repName || '').trim();
    content.meta = {
      ...(content.meta || {}),
      name,
      slug,
      repName: content.settings.repName,
      updatedAt: new Date().toISOString()
    };

    const contentJson = serializePresentationContent(content);
    // GitHub Contents API + Vercel request bodies struggle past a few MB.
    if (contentJson.length > 4.5 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        error: `Presentation content is too large (${(contentJson.length / (1024 * 1024)).toFixed(1)} MB). Compress or remove embedded photos/logos and publish again.`
      });
    }

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
