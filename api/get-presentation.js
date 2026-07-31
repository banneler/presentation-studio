const { getFile, requireGitHub } = require('./_lib/github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    requireGitHub();
    const slug = String(req.query.slug || '').trim();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
      return res.status(400).json({ ok: false, error: 'A valid slug is required' });
    }

    const contentFile = await getFile(`presentations/${slug}/content.json`);
    if (!contentFile?.content) {
      return res.status(404).json({ ok: false, error: 'Published presentation not found' });
    }

    const decoded = Buffer.from(contentFile.content, 'base64').toString('utf8');
    const content = JSON.parse(decoded);

    let hasFollowUp = false;
    try {
      const followUp = await getFile(`presentations/${slug}/follow-up/content.json`);
      hasFollowUp = Boolean(followUp?.content);
    } catch (error) {
      hasFollowUp = false;
    }

    return res.status(200).json({
      ok: true,
      slug,
      content,
      url: `/presentations/${slug}/`,
      followUpUrl: hasFollowUp ? `/presentations/${slug}/follow-up/` : null,
      hasFollowUp
    });
  } catch (error) {
    console.error('get-presentation failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to load presentation'
    });
  }
};
