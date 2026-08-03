const { upsertFile, slugify, requireGitHub } = require('./_lib/github');
const {
  buildViewerHtml,
  buildServiceWorker,
  applyMeetingRecap,
  serializePresentationContent
} = require('./_lib/viewer');

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
    const recap = body.recap || {};

    if (!name) return res.status(400).json({ ok: false, error: 'Presentation name is required' });
    if (!slug) return res.status(400).json({ ok: false, error: 'A valid slug is required' });
    if (!content || typeof content !== 'object') {
      return res.status(400).json({ ok: false, error: 'Presentation content is required' });
    }

    const followUpContent = applyMeetingRecap(content, recap);
    followUpContent.settings = followUpContent.settings || {};
    followUpContent.settings.presentationName = name;
    followUpContent.settings.presentationSlug = slug;
    followUpContent.settings.repName = String(followUpContent.settings.repName || content.settings?.repName || '').trim();
    followUpContent.settings.variant = 'follow-up';
    followUpContent.meta = {
      ...(followUpContent.meta || {}),
      name,
      slug,
      repName: followUpContent.settings.repName,
      variant: 'follow-up',
      updatedAt: new Date().toISOString()
    };

    const contentJson = serializePresentationContent(followUpContent);
    if (contentJson.length > 4.5 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        error: `Follow-up content is too large (${(contentJson.length / (1024 * 1024)).toFixed(1)} MB). Compress or remove embedded photos/logos and publish again.`
      });
    }

    const cacheVersion = `presentation-${slug}-follow-up-v${Date.now()}`;
    const basePath = `presentations/${slug}/follow-up`;
    const viewerHtml = buildViewerHtml({
      assetBase: '../../../',
      trackingEnabled: true,
      presentationSlug: slug,
      presentationVariant: 'follow-up',
      presentationName: `${name} Follow-Up`,
      cacheVersion
    });
    const swJs = buildServiceWorker(cacheVersion);

    await upsertFile({
      path: `${basePath}/content.json`,
      content: contentJson,
      message: `Publish ${name} follow-up content`
    });
    await upsertFile({
      path: `${basePath}/index.html`,
      content: viewerHtml,
      message: `Publish ${name} follow-up viewer`
    });
    await upsertFile({
      path: `${basePath}/sw.js`,
      content: swJs,
      message: `Publish ${name} follow-up service worker`
    });

    return res.status(200).json({
      ok: true,
      name,
      slug,
      url: `/presentations/${slug}/follow-up/`
    });
  } catch (error) {
    console.error('publish-follow-up failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to publish follow-up'
    });
  }
};
