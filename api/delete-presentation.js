const { getFile, deleteDirectory, requireGitHub, slugify } = require('./_lib/github');

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function normalizeConfirm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
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
    const slug = slugify(body.slug || '');
    const confirmName = normalizeConfirm(body.confirmName);

    if (!slug) return res.status(400).json({ ok: false, error: 'A valid slug is required' });
    if (!confirmName) return res.status(400).json({ ok: false, error: 'Owner name confirmation is required' });

    const contentFile = await getFile(`presentations/${slug}/content.json`);
    if (!contentFile?.content) {
      return res.status(404).json({ ok: false, error: 'Published presentation not found' });
    }

    const decoded = Buffer.from(contentFile.content, 'base64').toString('utf8');
    const content = JSON.parse(decoded);
    const ownerName = normalizeConfirm(content.settings?.repName || content.meta?.repName || '');
    const presentationName = normalizeConfirm(
      content.settings?.presentationName || content.meta?.name || slug
    );
    const expected = ownerName || presentationName;

    if (confirmName.toLowerCase() !== expected.toLowerCase()) {
      return res.status(400).json({
        ok: false,
        error: ownerName
          ? 'Owner name does not match. Type the exact owner name to delete.'
          : 'Confirmation does not match. Type the presentation name to delete.'
      });
    }

    const result = await deleteDirectory({
      path: `presentations/${slug}`,
      message: `Delete ${presentationName || slug} presentation`
    });

    return res.status(200).json({
      ok: true,
      slug,
      name: presentationName,
      deleted: result.deleted
    });
  } catch (error) {
    console.error('delete-presentation failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to delete presentation'
    });
  }
};
