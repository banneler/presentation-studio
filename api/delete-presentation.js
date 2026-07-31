const {
  getFile,
  listFilesRecursive,
  deleteDirectory,
  requireGitHub,
  slugify
} = require('./_lib/github');

function parseBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

function normalizeConfirm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function resolveDeleteTarget(slug) {
  const basePath = `presentations/${slug}`;
  const files = await listFilesRecursive(basePath);
  if (!files.length) return null;

  const contentFile = await getFile(`${basePath}/content.json`);
  if (contentFile?.content) {
    const decoded = Buffer.from(contentFile.content, 'base64').toString('utf8');
    const content = JSON.parse(decoded);
    const ownerName = normalizeConfirm(content.settings?.repName || content.meta?.repName || '');
    const presentationName = normalizeConfirm(
      content.settings?.presentationName || content.meta?.name || slug
    );
    return {
      basePath,
      presentationName,
      ownerName,
      expected: ownerName || presentationName,
      orphan: false
    };
  }

  // Remnants only (e.g. follow-up left after a partial delete) — still purgeable.
  let presentationName = slug;
  let ownerName = '';
  try {
    const followUpFile = await getFile(`${basePath}/follow-up/content.json`);
    if (followUpFile?.content) {
      const decoded = Buffer.from(followUpFile.content, 'base64').toString('utf8');
      const content = JSON.parse(decoded);
      presentationName = normalizeConfirm(
        content.settings?.presentationName || content.meta?.name || slug
      );
      ownerName = normalizeConfirm(content.settings?.repName || content.meta?.repName || '');
    }
  } catch (error) {
    // keep slug fallback
  }

  return {
    basePath,
    presentationName,
    ownerName,
    // Accept owner, presentation name, or slug so library ghosts stay removable.
    expected: ownerName || presentationName || slug,
    alsoAccept: [slug],
    orphan: true
  };
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

    const target = await resolveDeleteTarget(slug);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Published presentation not found' });
    }

    const accepted = new Set(
      [target.expected, ...(target.alsoAccept || [])]
        .filter(Boolean)
        .map(value => value.toLowerCase())
    );
    if (!accepted.has(confirmName.toLowerCase())) {
      return res.status(400).json({
        ok: false,
        error: target.ownerName
          ? 'Owner name does not match. Type the exact owner name to delete.'
          : 'Confirmation does not match. Type the presentation name to delete.'
      });
    }

    const result = await deleteDirectory({
      path: target.basePath,
      message: `Delete ${target.presentationName || slug} presentation`
    });

    return res.status(200).json({
      ok: true,
      slug,
      name: target.presentationName,
      orphan: target.orphan,
      deleted: result.deleted,
      errors: result.errors || []
    });
  } catch (error) {
    console.error('delete-presentation failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to delete presentation'
    });
  }
};
