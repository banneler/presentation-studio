# Presentation Studio

A static presentation template plus a browser-based editor for building customized customer mapbooks.

## Run Locally

```bash
python3 -m http.server 8000
```

Open:

- Presentation: `http://localhost:8000/index.html`
- Editor: `http://localhost:8000/editor.html`

## Editing Flow

The editor can update:

- Page titles, nav labels, subtitles and logos
- Page visibility and navigation order
- Static map image references
- Agenda copy and agenda hero images
- Capability card copy and capability hero images
- Rightfiber and GPC Advantage page content

Click `Save Draft` to store changes in the browser. Click `Refresh Preview` to reload the presentation from that local draft.

## Share Links

Click `Create Share Link` to generate an `index.html?config=...` URL. The encoded configuration travels in the link, so the presentation can be opened without a backend.

Uploaded images are converted to data URLs. They work, but large images create large URLs. For production use, prefer hosted image URLs or asset filenames committed into the repo.
