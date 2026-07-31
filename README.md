# Presentation Studio

A static presentation template plus a browser-based editor for building, publishing, and following up on customer mapbooks.

## Run Locally

```bash
npm install
npx vercel dev
# or: python3 -m http.server 8000  (editor works; publish APIs need Vercel)
```

Open:

- Editor: `/` (or `/editor.html`)
- Template preview: `/index.html`

## Editing Flow

1. Enter a **Presentation Name** (slug auto-fills as the directory name)
2. Edit pages, nav visibility (Key / Ext), logos, copy, and hero color
3. **Save Draft** stores a browser draft namespaced to that slug
4. **Publish** writes `presentations/{slug}/` to GitHub via API
5. After the meeting, **Create Follow-Up** publishes `presentations/{slug}/follow-up/` with Meeting Recap copy and open tracking

Published URLs:

- Live: `/presentations/{slug}/`
- Follow-up: `/presentations/{slug}/follow-up/`

**Copy Draft Link** remains available as a local escape hatch (`?config=`), but customer links should use Publish.

## Required Vercel Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Fine-scoped PAT with `contents: write` on this repo |
| `GITHUB_REPO` | `banneler/presentation-studio` |
| `GMAIL_USER` | Gmail account used to send open alerts |
| `GMAIL_APP_PASSWORD` | Gmail app password |
| `TRACK_NOTIFY_TO` | Inbox for open alerts (default `banneler@gpcom.com`) |

Do not commit secrets. Use Vercel project env vars (and local `.env` only while gitignored).

## Tracking

Published live and follow-up viewers send a one-time-per-session open event to `/api/track-open`, which emails suspected IP geolocation using Vercel geo headers.

## Notes

- Shared images stay at the repo root; published decks reference them with relative `ASSET_BASE`
- Prefer hosted image filenames over huge data-URL uploads in published content
- After publish, wait for the Vercel deploy before sharing the live URL
