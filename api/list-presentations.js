const { listDirectory, getFile } = require('./_lib/github');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const entries = await listDirectory('presentations');
    const dirs = entries.filter(item => item.type === 'dir');

    const presentations = (await Promise.all(
      dirs.map(async dir => {
        const contentFile = await getFile(`presentations/${dir.name}/content.json`);
        // Skip orphan directories (e.g. follow-up left after a partial delete).
        if (!contentFile?.content) return null;

        let name = dir.name;
        let repName = '';
        let hasFollowUp = false;
        try {
          const decoded = Buffer.from(contentFile.content, 'base64').toString('utf8');
          const parsed = JSON.parse(decoded);
          name = parsed.settings?.presentationName || parsed.meta?.name || dir.name;
          repName = parsed.settings?.repName || parsed.meta?.repName || '';
        } catch (error) {
          // keep slug as name
        }
        try {
          const followUp = await getFile(`presentations/${dir.name}/follow-up/content.json`);
          hasFollowUp = Boolean(followUp?.content);
        } catch (error) {
          hasFollowUp = false;
        }
        return {
          slug: dir.name,
          name,
          repName,
          url: `/presentations/${dir.name}/`,
          followUpUrl: hasFollowUp ? `/presentations/${dir.name}/follow-up/` : null,
          hasFollowUp
        };
      })
    )).filter(Boolean);

    presentations.sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ ok: true, presentations });
  } catch (error) {
    console.error('list-presentations failed:', error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Failed to list presentations'
    });
  }
};
