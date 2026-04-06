# Firgun report site

This repo contains a GitHub Pages-ready static HTML version of the Firgun paid media report.

## Main site file

- `index.html` is the public entrypoint for GitHub Pages.
- `deep-research-report-firgun.html` is a named copy of the same long-form page.
- `html_build/build-firgun-html.js` rebuilds the page from `deep-research-report.md`.

## Rebuild locally

```bash
/usr/local/bin/node html_build/build-firgun-html.js deep-research-report.md index.html
/usr/local/bin/node html_build/build-firgun-html.js deep-research-report.md deep-research-report-firgun.html
```

## Publish on GitHub Pages

1. Push this repository to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Under `Build and deployment`, choose:
   - `Source`: `Deploy from a branch`
   - `Branch`: `master`
   - `Folder`: `/ (root)`
5. Save, then wait for GitHub Pages to publish the site.

For the current remote, the expected project site URL is:

- `https://cdznho.github.io/paid_media_firgun/`

If the repository is private, GitHub Pages availability depends on the repository visibility and plan settings in GitHub.
