#!/usr/bin/env python3
"""Builds Pipeline's brand assets from one definition so they always match.

Outputs (next to index.html, one level up from this folder):
  logo.svg            full lockup (arc + three nodes over the wordmark), text as outlines
  logo-mark.svg       just the arc and nodes
  favicon.svg         mark on a dark rounded square
  favicon-32.png, apple-touch-icon.png
  og.png              1200x630 link-preview image
  logo-paths.json     geometry, read by nothing at runtime; handy when replacing the logo later

The wordmark is converted to outlines (Inter Display SemiBold) so the logo looks the
same everywhere, with no font loading. To swap in the final logo later, replace
logo.svg / logo-mark.svg / favicon.svg and re-run only the PNG steps (or the
rsvg-convert lines below).

Needs: fontTools, rsvg-convert. Run:  python3 tools/build_brand.py
"""
import json
import math
import os
import random
import subprocess

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FONT = '/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf'

INK = '#F2F5FB'
BG = '#05070D'
ARC_DIM, ARC_BRIGHT = '#5E74D4', '#BCCBFF'
NODE_1, NODE_2, NODE_3 = '#6C82DA', '#B3C2FF', '#FFFFFF'


def outline(text, size, tracking_em=-0.02):
    """Return (svg path d, width) for text set at `size` px with its baseline at y=0."""
    font = TTFont(FONT)
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    upm = font['head'].unitsPerEm
    scale = size / upm
    x = 0.0
    d = []
    spans = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        # flip y: font units go up, SVG goes down
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        d.append(pen.getCommands())
        adv = font['hmtx'][name][0] * scale
        spans.append((x, x + adv))
        x += adv + tracking_em * size
    return ' '.join(d), x - tracking_em * size, spans


def lockup():
    size = 52
    d, width, spans = outline('Pipeline', size)
    pad_x = 14
    cap = 0.76 * size  # ascender height of l / dot of i
    base = 112
    arc_y = base - cap - 0.30 * size  # y of the arc's end nodes
    x0 = pad_x + spans[0][0] + 0.24 * size
    x1 = pad_x + spans[-1][1] - 0.26 * size
    xm = (x0 + x1) / 2
    lift = 0.55 * size  # how far the arc rises above its ends
    ctrl_y = arc_y - 2 * lift
    mid_y = arc_y - lift
    w = width + 2 * pad_x
    h = base + 16
    arc = f'M{x0:.1f} {arc_y:.1f} Q{xm:.1f} {ctrl_y:.1f} {x1:.1f} {arc_y:.1f}'
    nodes = [(x0, arc_y, 4.2, NODE_1, 1), (xm, mid_y, 5.2, NODE_2, 1), (x1, arc_y, 6.4, NODE_3, 1)]
    geo = dict(width=round(w, 1), height=round(h, 1), arc=arc, nodes=[dict(x=round(a, 1), y=round(b, 1), r=r) for a, b, r, _, _ in nodes],
               text_path=d, text_transform=f'translate({pad_x} {base})')
    return geo, nodes


def mark_svg(geo, nodes, ids=''):
    pad = 10
    xs = [n[0] for n in nodes]
    ys = [n[1] for n in nodes]
    mid_y = min(ys)
    x_min, x_max = min(xs) - pad - 8, max(xs) + pad + 8
    y_min, y_max = mid_y - pad - 6, max(ys) + pad + 6
    return x_min, y_min, x_max - x_min, y_max - y_min


def lockup_svg(geo, nodes):
    w, h = geo['width'], geo['height']
    circles = '\n    '.join(
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{c}" opacity="{o}"/>' for x, y, r, c, o in nodes)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="Pipeline">
  <defs>
    <linearGradient id="pl-arc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{ARC_DIM}"/>
      <stop offset="1" stop-color="{ARC_BRIGHT}"/>
    </linearGradient>
    <filter id="pl-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="{geo['arc']}" fill="none" stroke="url(#pl-arc)" stroke-width="2" stroke-linecap="round"/>
  <g>
    {circles[:circles.rfind('<circle')].rstrip()}
    <circle cx="{nodes[2][0]:.1f}" cy="{nodes[2][1]:.1f}" r="{nodes[2][2]}" fill="{nodes[2][3]}" filter="url(#pl-glow)"/>
  </g>
  <path transform="{geo['text_transform']}" d="{geo['text_path']}" fill="{INK}"/>
</svg>
'''


def mark_only_svg(geo, nodes, bg=None, tight=False):
    x, y, w, h = mark_svg(geo, nodes)
    cx, cy = x + w / 2, y + h / 2
    if tight:
        vb = f'{x + 2:.1f} {y + 2:.1f} {w - 4:.1f} {h - 4:.1f}'
        s = max(w, h)
    else:
        # square canvas centred on the mark (favicon)
        s = max(w, h)
        vb = f'{cx - s / 2:.1f} {cy - s / 2:.1f} {s:.1f} {s:.1f}'
    circles = '\n    '.join(
        f'<circle cx="{nx:.1f}" cy="{ny:.1f}" r="{r * 1.25:.1f}" fill="{c}" opacity="{o}"/>' for nx, ny, r, c, o in nodes)
    rect = ''
    if bg:
        rect = f'<rect x="{cx - s / 2:.1f}" y="{cy - s / 2:.1f}" width="{s:.1f}" height="{s:.1f}" rx="{s * 0.22:.1f}" fill="{bg}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Pipeline mark">
  <defs>
    <linearGradient id="pl-arc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{ARC_DIM}"/>
      <stop offset="1" stop-color="{ARC_BRIGHT}"/>
    </linearGradient>
  </defs>
  {rect}
  <path d="{geo['arc']}" fill="none" stroke="url(#pl-arc)" stroke-width="2.6" stroke-linecap="round"/>
  <g>
    {circles}
  </g>
</svg>
'''


def og_svg(geo, nodes):
    W, H = 1200, 630
    rnd = random.Random(7)
    pts = []
    # a few loose clusters on the right, fading toward the text
    for cx, cy, n in [(930, 150, 8), (1040, 430, 9), (800, 520, 6), (1110, 250, 5)]:
        for _ in range(n):
            a, r = rnd.random() * math.tau, 16 + rnd.random() * 70
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r, 1.4 + rnd.random() * 2.2))
    lines = []
    for i, a in enumerate(pts):
        for b in pts[i + 1:]:
            dist = math.hypot(a[0] - b[0], a[1] - b[1])
            if dist < 92:
                lines.append(f'<line x1="{a[0]:.0f}" y1="{a[1]:.0f}" x2="{b[0]:.0f}" y2="{b[1]:.0f}" stroke="#8EA4F5" stroke-opacity="{0.34 - dist / 330:.2f}"/>')
    # the lit path: one real node from each of three clusters, joined by soft curves
    centres = [(930, 150), (1040, 430), (800, 520)]
    route = [min(pts, key=lambda p: math.hypot(p[0] - c[0], p[1] - c[1]))[:2] for c in centres]
    path = f'M{route[0][0]:.0f} {route[0][1]:.0f} ' + ' '.join(
        f'Q{(a[0] + b[0]) / 2 + 28:.0f} {(a[1] + b[1]) / 2 - 18:.0f} {b[0]:.0f} {b[1]:.0f}' for a, b in zip(route, route[1:]))
    dots = ''.join(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="#EEF2FF" fill-opacity="0.75"/>' for x, y, r in pts)
    s = 1.55
    lw, lh = geo['width'] * s, geo['height'] * s
    inner = lockup_svg(geo, nodes).split('\n', 1)[1].rsplit('</svg>', 1)[0]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="bgglow" cx="0.28" cy="0.5" r="0.7">
      <stop offset="0" stop-color="#0D1226"/>
      <stop offset="1" stop-color="{BG}"/>
    </radialGradient>
    <linearGradient id="pl-arc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{ARC_DIM}"/>
      <stop offset="1" stop-color="{ARC_BRIGHT}"/>
    </linearGradient>
    <filter id="pl-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="{W}" height="{H}" fill="url(#bgglow)"/>
  {''.join(lines)}
  <path d="{path}" fill="none" stroke="#B4C4FF" stroke-opacity="0.6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  {dots}
  <g transform="translate(78 150) scale({s})">{inner}</g>
  <text x="100" y="{150 + lh + 70}" font-family="Inter Display, Inter, sans-serif" font-weight="600" font-size="46" fill="{INK}" letter-spacing="-1">Find where your network leads.</text>
  <text x="100" y="{150 + lh + 124}" font-family="Inter, sans-serif" font-weight="400" font-size="26" fill="#9AA3B8">Discover opportunities through the teams,</text>
  <text x="100" y="{150 + lh + 160}" font-family="Inter, sans-serif" font-weight="400" font-size="26" fill="#9AA3B8">clubs, and communities that connect you.</text>
</svg>
'''


def write(name, text):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(text)


def png(svg, out, w, h=None):
    cmd = ['rsvg-convert', '-w', str(w)] + (['-h', str(h)] if h else []) + [os.path.join(OUT, svg), '-o', os.path.join(OUT, out)]
    subprocess.run(cmd, check=True)


if __name__ == '__main__':
    geo, nodes = lockup()
    write('logo.svg', lockup_svg(geo, nodes))
    write('logo-mark.svg', mark_only_svg(geo, nodes, tight=True))
    write('favicon.svg', mark_only_svg(geo, nodes, bg=BG))
    write('og.svg', og_svg(geo, nodes))
    png('favicon.svg', 'favicon-32.png', 32, 32)
    png('favicon.svg', 'apple-touch-icon.png', 180, 180)
    png('og.svg', 'og.png', 1200, 630)
    os.remove(os.path.join(OUT, 'og.svg'))
    with open(os.path.join(OUT, 'tools', 'logo-geometry.json'), 'w') as f:
        json.dump({k: v for k, v in geo.items() if k != 'text_path'} | {'text_path_chars': len(geo['text_path'])}, f, indent=2)
    print('ok', geo['width'], geo['height'])
