const nodemailer = require('nodemailer');

const FROM_EMAIL = process.env.GMAIL_USER || 'support@constellation-crm.com';
const TO_EMAIL = process.env.TRACK_NOTIFY_TO || 'banneler@gpcom.com';
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

function firstHeader(value) {
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

function getClientIp(req) {
  return (
    firstHeader(req.headers['x-real-ip']) ||
    firstHeader(req.headers['x-forwarded-for']) ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function getSuspectedLocation(req) {
  const city = req.headers['x-vercel-ip-city'] || '';
  const region = req.headers['x-vercel-ip-country-region'] || '';
  const country = req.headers['x-vercel-ip-country'] || '';
  const latitude = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';
  const timezone = req.headers['x-vercel-ip-timezone'] || '';

  const parts = [city, region, country].filter(Boolean).map(decodeURIComponent);
  return {
    summary: parts.length ? parts.join(', ') : 'Unknown / unavailable',
    city: city ? decodeURIComponent(city) : '',
    region,
    country,
    latitude,
    longitude,
    timezone
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmail({ openedAt, ip, location, path, referrer, userAgent, presentation, variant }) {
  const mapsLink =
    location.latitude && location.longitude
      ? `https://maps.google.com/?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`
      : '';

  const label = presentation ? `${presentation} (${variant})` : variant;
  const text = [
    'Presentation Studio link opened.',
    '',
    `Presentation: ${label}`,
    `Opened at: ${openedAt}`,
    `Path: ${path}`,
    `IP: ${ip}`,
    `Suspected location: ${location.summary}`,
    location.timezone ? `Timezone: ${location.timezone}` : null,
    mapsLink ? `Map: ${mapsLink}` : null,
    referrer ? `Referrer: ${referrer}` : null,
    `User agent: ${userAgent || 'unknown'}`
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;line-height:1.5;">
      <h2 style="margin:0 0 12px;font-size:20px;">Presentation opened</h2>
      <p style="margin:0 0 18px;color:#475569;">Someone loaded a published Presentation Studio link.</p>
      <table style="border-collapse:collapse;width:100%;max-width:560px;">
        <tr><td style="padding:8px 0;color:#64748b;width:160px;">Presentation</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(label)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Opened at</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(openedAt)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Path</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(path)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">IP</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(ip)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Suspected location</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(location.summary)}</td></tr>
        ${location.timezone ? `<tr><td style="padding:8px 0;color:#64748b;">Timezone</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(location.timezone)}</td></tr>` : ''}
        ${mapsLink ? `<tr><td style="padding:8px 0;color:#64748b;">Map</td><td style="padding:8px 0;"><a href="${escapeHtml(mapsLink)}">${escapeHtml(mapsLink)}</a></td></tr>` : ''}
        ${referrer ? `<tr><td style="padding:8px 0;color:#64748b;">Referrer</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(referrer)}</td></tr>` : ''}
        <tr><td style="padding:8px 0;color:#64748b;vertical-align:top;">User agent</td><td style="padding:8px 0;font-weight:600;word-break:break-word;">${escapeHtml(userAgent || 'unknown')}</td></tr>
      </table>
    </div>
  `;

  return { text, html, label };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!GMAIL_APP_PASSWORD) return res.status(500).json({ ok: false, error: 'Email sender is not configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const ip = getClientIp(req);
    const location = getSuspectedLocation(req);
    const openedAt = new Date().toISOString();
    const path = String(body.path || '/').slice(0, 300);
    const referrer = String(body.referrer || req.headers.referer || '').slice(0, 500);
    const userAgent = String(body.userAgent || req.headers['user-agent'] || '').slice(0, 500);
    const presentation = String(body.presentation || body.slug || 'unknown').slice(0, 80);
    const variant = String(body.variant || 'live').slice(0, 40);
    const { text, html, label } = buildEmail({
      openedAt,
      ip,
      location,
      path,
      referrer,
      userAgent,
      presentation,
      variant
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: FROM_EMAIL, pass: GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `"Presentation Studio" <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      subject: `${label} opened — ${location.summary}`,
      text,
      html
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('track-open failed:', error);
    return res.status(500).json({ ok: false, error: 'Failed to send tracking email' });
  }
};
