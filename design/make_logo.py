"""Builds the Nude logo as clean vector SVG from the brand reference (orange beam + rotated NU/DE diamond).
Letters use Inter ExtraBold outlines, so the SVGs need no fonts. Run: python3 design/make_logo.py"""
import math, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ORANGE = "#ED7D3A"
CREAM = "#F5F3EF"
FONT = "/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf"
font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()

def glyph(ch):
    name = cmap[ord(ch)]
    b = BoundsPen(gs); gs[name].draw(b)
    return name, b.bounds

def letter_path(ch, x, y, w, h):
    """Glyph path scaled to fill the box (x,y,w,h) in SVG coordinates (y down)."""
    name, (x0, y0, x1, y1) = glyph(ch)
    sx, sy = w / (x1 - x0), h / (y1 - y0)
    pen = SVGPathPen(gs)
    # font units: y up → flip
    t = TransformPen(pen, (sx, 0, 0, -sy, x - x0 * sx, y + y1 * sy))
    gs[name].draw(t)
    return pen.getCommands()

def diamond_letters(cx, cy, half_diag, gap_ratio=0.07):
    side = half_diag * math.sqrt(2)
    cell = side / 2
    g = cell * gap_ratio
    ox, oy = cx - side / 2, cy - side / 2
    paths = []
    for i, ch in enumerate("NUDE"):
        col, row = i % 2, i // 2
        paths.append(letter_path(ch, ox + col * cell + g / 2, oy + row * cell + g / 2, cell - g, cell - g))
    d = " ".join(paths)
    return f'<g transform="rotate(-45 {cx:.2f} {cy:.2f})"><path fill="{ORANGE}" d="{d}"/></g>'

def full_logo(bg=None):
    # Coordinates traced from the reference (387×411 → ×3 scale = 1161×1233 canvas).
    W, H = 1161, 1233
    L, R, C = 307, 877, 592
    apex_y, side_y = 553, 830
    beam = f'''
  <defs>
    <linearGradient id="bl" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="{ORANGE}" stop-opacity="0"/><stop offset="0.45" stop-color="{ORANGE}" stop-opacity="0.45"/><stop offset="1" stop-color="{ORANGE}"/>
    </linearGradient>
    <linearGradient id="br" x1="0.85" y1="0" x2="0.15" y2="1">
      <stop offset="0" stop-color="{ORANGE}" stop-opacity="0"/><stop offset="0.45" stop-color="{ORANGE}" stop-opacity="0.45"/><stop offset="1" stop-color="{ORANGE}"/>
    </linearGradient>
  </defs>
  <polygon fill="url(#bl)" points="{L},0 {C},0 {C},{apex_y} {L},{side_y}"/>
  <polygon fill="url(#br)" points="{C},0 {R},0 {R},{side_y} {C},{apex_y}"/>'''
    letters = diamond_letters(C + 8, 842, 282)
    bgrect = f'<rect width="{W}" height="{H}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{bgrect}{beam}\n  {letters}\n</svg>\n'

def mark(size=1024, bg=None, pad=0.16, rounded=None):
    """Square icon: just the NU/DE diamond (beam omitted — reads better small)."""
    cx = cy = size / 2
    half = size * (0.5 - pad)
    bgrect = ''
    if bg:
        r = f' rx="{rounded}"' if rounded else ''
        bgrect = f'<rect width="{size}" height="{size}" fill="{bg}"{r}/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{bgrect}{diamond_letters(cx, cy, half)}</svg>\n'

out = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(out, "nude-logo.svg"), "w").write(full_logo())
open(os.path.join(out, "nude-logo-cream.svg"), "w").write(full_logo(CREAM))
open(os.path.join(out, "nude-mark.svg"), "w").write(mark(1024, None, 0.06))
open(os.path.join(out, "nude-icon-desktop.svg"), "w").write(mark(1024, CREAM, 0.17, rounded=230))
open(os.path.join(out, "nude-icon-fullbleed.svg"), "w").write(mark(1024, CREAM, 0.17))
print("written to", out)

# ---- Android adaptive-icon foreground (VectorDrawable, 108dp canvas, safe zone ~66dp) ----
def android_foreground():
    size = 108.0
    cx = cy = size / 2
    half = 25.0
    side = half * math.sqrt(2)
    cell = side / 2
    g = cell * 0.07
    ox, oy = cx - side / 2, cy - side / 2
    paths = []
    for i, ch in enumerate("NUDE"):
        col, row = i % 2, i // 2
        paths.append(letter_path(ch, ox + col * cell + g / 2, oy + row * cell + g / 2, cell - g, cell - g))
    d = " ".join(paths)
    return f'''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <group android:rotation="-45" android:pivotX="{cx}" android:pivotY="{cy}">
        <path android:fillColor="{ORANGE}" android:pathData="{d}" />
    </group>
</vector>
'''

def android_mark_tinted():
    """Same mark in white for in-app use (tinted by Compose)."""
    return android_foreground().replace(ORANGE, "#FFFFFFFF").replace('android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108"', 'android:width="24dp" android:height="24dp" android:viewportWidth="108" android:viewportHeight="108"')

open(os.path.join(out, "android_ic_launcher_foreground.xml"), "w").write(android_foreground())
open(os.path.join(out, "android_ic_nude_mark.xml"), "w").write(android_mark_tinted())
