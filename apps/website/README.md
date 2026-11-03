# Nude website

The landing page for Nude: kinetic type, Nebula and Rovian Defender previews, modes, and download links to the latest GitHub release.

- Edit `src/page.html`. Brand art comes from `/design` and is inlined at build time.
- Build: `python3 apps/website/build.py` → writes `index.html` (a complete static page; host it anywhere, e.g. GitHub Pages).
- Download links point at `https://github.com/thysbango-star/Nude/releases/latest/download/<file>`, so they follow each release. If the desktop version number changes, update the Windows and macOS file names in `src/page.html`.
