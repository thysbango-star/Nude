#!/usr/bin/env python3
"""Builds the Nude website: inlines the brand SVGs into src/page.html and writes index.html."""
import pathlib, re
here = pathlib.Path(__file__).resolve().parent
design = here.parent.parent / 'design'
def svg(name, cls='', strip_ids=None):
    s = (design / name).read_text()
    s = re.sub(r'<\?xml[^>]*>\s*', '', s).strip()
    if cls: s = s.replace('<svg ', f'<svg class="{cls}" aria-hidden="true" ', 1)
    if strip_ids:
        for old, new in strip_ids.items(): s = s.replace(old, new)
    return s
rovian = svg('rovian-mark.svg', 'shield')
arm = '<path d="M96 118 C132 128 170 92 162 -8"/>'
rovian = (rovian.replace('<path id="arm" d="M96 118 C132 128 170 92 162 -8"/>', arm)
          .replace('<use href="#arm" transform="rotate(120 100 116)"/>', f'<g transform="rotate(120 100 116)">{arm}</g>')
          .replace('<use href="#arm" transform="rotate(240 100 116)"/>', f'<g transform="rotate(240 100 116)">{arm}</g>'))
page = (here / 'src/page.html').read_text()
page = (page.replace('{{LOGO}}', svg('nude-logo.svg', 'logo-big'))
            .replace('{{MARK}}', svg('nude-mark.svg', 'mark'))
            .replace('{{MARK2}}', svg('nude-mark.svg', 'mark'))
            .replace('{{ROVIAN}}', rovian)
            .replace('{{BLOCK}}', svg('rovian-block.svg', 'shield')))
(here / 'dist').mkdir(exist_ok=True)
(here / 'dist/artifact.html').write_text(page)
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
title_end = page.index('</style>') + len('</style>')
(here / 'index.html').write_text(head + page[:title_end] + '\n</head>\n<body>\n' + page[title_end:] + '\n</body>\n</html>\n')
print('built', len(page), 'bytes')
