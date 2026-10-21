"""Generates the built-in NEXUS cosmetic pack (SVG files + manifest.json).

All assets share a 200x200 canvas laid out for the default body (centre ~100,110).
Colour placeholders {{primary}} {{secondary}} {{accent}} {{glow}} are substituted
by the renderer for tintable assets (manifest `colors` gives the defaults).
Run:  python gen_builtin.py   (writes ./builtin/)
"""
import json
import os

OUT = os.path.join(os.path.dirname(__file__), "builtin")
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))

def svg(body, defs=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">{("<defs>" + defs + "</defs>") if defs else ""}{body}</svg>'

ASSETS = []

def add(id, name, category, files, z=None, tintable=False, colors=None, mirrorable=False, tags=None, variants=None):
    """files: svg body string (single) ; variants: dict expression -> svg string."""
    src = f"{id}.svg"
    open(os.path.join(OUT, src), "w", encoding="utf-8").write(files)
    a = {"id": id, "name": name, "category": category, "assetType": "svg", "source": src}
    if z is not None:
        a["zIndex"] = z
    if tintable:
        a["tintable"] = True
        a["colors"] = colors or {}
    if mirrorable:
        a["mirrorable"] = True
    a["duplicable"] = True
    if tags:
        a["tags"] = tags
    if variants:
        a["variants"] = {}
        for expr, content in variants.items():
            vf = f"{id}__{expr}.svg"
            open(os.path.join(OUT, vf), "w", encoding="utf-8").write(content)
            a["variants"][expr] = vf
    ASSETS.append(a)

# ------------------------------------------------------------------ bodies
shade = '<radialGradient id="sh" cx="0.38" cy="0.3" r="0.8"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.12"/></radialGradient>'
add("nexus_bot", "NEXUS Bot", "body", svg(
    '<line x1="100" y1="34" x2="100" y2="56" stroke="{{secondary}}" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round"/>'
    '<circle cx="100" cy="30" r="8" fill="{{accent}}"><animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite"/></circle>'
    '<rect x="22" y="92" width="16" height="38" rx="8" fill="{{primary}}" opacity="0.85"/><rect x="162" y="92" width="16" height="38" rx="8" fill="{{primary}}" opacity="0.85"/>'
    '<rect x="34" y="54" width="132" height="116" rx="48" fill="{{primary}}"/><rect x="34" y="54" width="132" height="116" rx="48" fill="url(#sh)"/>'
    '<rect x="50" y="74" width="100" height="72" rx="30" fill="{{secondary}}"/>', shade),
    z=0, tintable=True, colors={"primary": "#eef2f8", "secondary": "#0b0e14", "accent": "#8fd3ff"}, tags=["robot", "default"])
add("white_blob", "White Blob", "body", svg(
    '<path d="M100 48c38 0 66 30 66 70 0 34-26 54-66 54s-66-20-66-54c0-40 28-70 66-70z" fill="{{primary}}"/>'
    '<path d="M100 48c38 0 66 30 66 70 0 34-26 54-66 54s-66-20-66-54c0-40 28-70 66-70z" fill="url(#sh)"/>'
    '<ellipse cx="100" cy="176" rx="46" ry="6" fill="#000" opacity="0.18"/>', shade),
    z=0, tintable=True, colors={"primary": "#f7f8fb"}, tags=["blob", "cute"])
add("ghost", "Ghost", "body", svg(
    '<path d="M42 116c0-38 26-66 58-66s58 28 58 66v54l-12-10-12 10-12-10-11 10-11-10-12 10-12-10-12 10z" fill="{{primary}}"/>'
    '<path d="M42 116c0-38 26-66 58-66s58 28 58 66v54l-12-10-12 10-12-10-11 10-11-10-12 10-12-10-12 10z" fill="url(#sh)"/>', shade),
    z=0, tintable=True, colors={"primary": "#f2f4ff"}, tags=["ghost", "spooky"])
add("cube", "Cube", "body", svg(
    '<rect x="42" y="56" width="116" height="112" rx="26" fill="{{primary}}"/><rect x="42" y="56" width="116" height="112" rx="26" fill="url(#sh)"/>', shade),
    z=0, tintable=True, colors={"primary": "#e9f6ff"}, tags=["cube"])

# ------------------------------------------------------------------ eyes (with expression variants)
L, R = 82, 118
CY = 106

def nexus_eyes(expr, c="{{primary}}"):
    glow = f'<filter id="g"><feGaussianBlur stdDeviation="2.2"/></filter>'
    if expr == "happy" or expr == "proud":
        e = f'<g stroke="{c}" stroke-width="6" stroke-linecap="round" fill="none"><path d="M{L-10} {CY+4} q10 -14 20 0"/><path d="M{R-10} {CY+4} q10 -14 20 0"/></g>'
        if expr == "proud":
            e += f'<path d="M148 78l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="{c}"><animate attributeName="opacity" values="0;1;0" dur="1.6s" repeatCount="indefinite"/></path>'
        return svg(e, glow)
    if expr == "concerned":
        return svg(f'<g fill="{c}"><rect x="{L-8}" y="{CY-2}" width="16" height="11" rx="5"/><rect x="{R-8}" y="{CY-2}" width="16" height="11" rx="5"/></g>'
                   f'<g stroke="{c}" stroke-width="4" stroke-linecap="round"><path d="M{L-10} {CY-14} l18 6"/><path d="M{R+10} {CY-14} l-18 6"/></g>', glow)
    if expr in ("neutral",):
        return svg(f'<g stroke="{c}" stroke-width="6" stroke-linecap="round"><path d="M{L-9} {CY} h18"/><path d="M{R-9} {CY} h18"/></g>', glow)
    if expr == "sleepy":
        return svg(f'<g stroke="{c}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M{L-9} {CY} q9 7 18 0"/><path d="M{R-9} {CY} q9 7 18 0"/></g>', glow)
    if expr == "focused":
        return svg(f'<g fill="{c}"><rect x="{L-10}" y="{CY-4}" width="20" height="8" rx="4"/><rect x="{R-10}" y="{CY-4}" width="20" height="8" rx="4"/></g>', glow)
    if expr == "surprised":
        return svg(f'<g fill="{c}"><circle cx="{L}" cy="{CY}" r="11"/><circle cx="{R}" cy="{CY}" r="11"/></g>'
                   f'<g fill="#0b0e14"><circle cx="{L+3}" cy="{CY-4}" r="3.5"/><circle cx="{R+3}" cy="{CY-4}" r="3.5"/></g>', glow)
    if expr == "curious":
        return svg(f'<g fill="{c}"><rect x="{L-9}" y="{CY-14}" width="18" height="26" rx="9"/><rect x="{R-7}" y="{CY-8}" width="14" height="18" rx="7"/></g>', glow)
    if expr == "thinking":
        return svg(f'<g fill="{c}"><ellipse cx="{L+3}" cy="{CY-3}" rx="7" ry="10"/><ellipse cx="{R+3}" cy="{CY-3}" rx="7" ry="10"/>'
                   f'<animateTransform attributeName="transform" type="translate" values="-4 0;4 -2;-4 0" dur="1.8s" repeatCount="indefinite"/></g>'
                   f'<g fill="{c}" opacity="0.8"><circle cx="88" cy="130" r="2.5"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" repeatCount="indefinite"/></circle>'
                   f'<circle cx="100" cy="130" r="2.5"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.2s" repeatCount="indefinite"/></circle>'
                   f'<circle cx="112" cy="130" r="2.5"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.4s" repeatCount="indefinite"/></circle></g>', glow)
    # normal: blinking
    blink = '<animate attributeName="ry" values="11;11;1;11" keyTimes="0;0.93;0.96;1" dur="4.5s" repeatCount="indefinite"/>'
    return svg(f'<g fill="{c}"><ellipse cx="{L}" cy="{CY}" rx="8" ry="11">{blink}</ellipse><ellipse cx="{R}" cy="{CY}" rx="8" ry="11">{blink}</ellipse></g>', glow)

EXPRS = ["normal", "happy", "focused", "concerned", "curious", "thinking", "surprised", "sleepy", "neutral", "proud"]
add("nexus_eyes", "NEXUS Eyes", "eyes", nexus_eyes("normal"), z=60, tintable=True, colors={"primary": "#8fd3ff"},
    variants={e: nexus_eyes(e) for e in EXPRS if e != "normal"}, tags=["default", "glow"])

def round_eyes(expr):
    c = "{{primary}}"
    hl = f'<g fill="#fff"><circle cx="{L+3}" cy="{CY-4}" r="3"/><circle cx="{R+3}" cy="{CY-4}" r="3"/></g>'
    if expr in ("happy", "proud"):
        return svg(f'<g stroke="{c}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M{L-8} {CY+3} q8 -11 16 0"/><path d="M{R-8} {CY+3} q8 -11 16 0"/></g>')
    if expr == "sleepy":
        return svg(f'<g stroke="{c}" stroke-width="4" stroke-linecap="round" fill="none"><path d="M{L-8} {CY} q8 6 16 0"/><path d="M{R-8} {CY} q8 6 16 0"/></g>')
    if expr == "neutral":
        return svg(f'<g stroke="{c}" stroke-width="4" stroke-linecap="round"><path d="M{L-7} {CY} h14"/><path d="M{R-7} {CY} h14"/></g>')
    if expr == "concerned":
        return svg(f'<g fill="{c}"><circle cx="{L}" cy="{CY+2}" r="6"/><circle cx="{R}" cy="{CY+2}" r="6"/></g>'
                   f'<g stroke="{c}" stroke-width="3.5" stroke-linecap="round"><path d="M{L-9} {CY-12} l15 5"/><path d="M{R+9} {CY-12} l-15 5"/></g>')
    if expr == "focused":
        return svg(f'<g fill="{c}"><circle cx="{L}" cy="{CY}" r="7"/><circle cx="{R}" cy="{CY}" r="7"/></g>'
                   f'<g stroke="{c}" stroke-width="3.5" stroke-linecap="round"><path d="M{L-9} {CY-12} h17"/><path d="M{R-8} {CY-12} h17"/></g>')
    if expr == "surprised":
        return svg(f'<g fill="{c}"><circle cx="{L}" cy="{CY}" r="10"/><circle cx="{R}" cy="{CY}" r="10"/></g>{hl}')
    if expr in ("curious", "thinking"):
        anim = '<animateTransform attributeName="transform" type="translate" values="-3 0;3 -2;-3 0" dur="1.8s" repeatCount="indefinite"/>' if expr == "thinking" else ""
        return svg(f'<g fill="{c}"><circle cx="{L+2}" cy="{CY-2}" r="8"/><circle cx="{R+2}" cy="{CY-2}" r="{6 if expr == "curious" else 8}"/>{anim}</g>{hl}')
    blink = '<animate attributeName="ry" values="8;8;1;8" keyTimes="0;0.93;0.96;1" dur="4.8s" repeatCount="indefinite"/>'
    return svg(f'<g fill="{c}"><ellipse cx="{L}" cy="{CY}" rx="8" ry="8">{blink}</ellipse><ellipse cx="{R}" cy="{CY}" rx="8" ry="8">{blink}</ellipse></g>{hl}')

add("round_eyes", "Round Eyes", "eyes", round_eyes("normal"), z=60, tintable=True, colors={"primary": "#1b1f2a"},
    variants={e: round_eyes(e) for e in EXPRS if e != "normal"}, tags=["cute"])

def star(cx, cy, r, c):
    import math
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        a = -math.pi / 2 + i * math.pi / 5
        pts.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{c}"/>'

def star_eyes(expr):
    c = "{{primary}}"
    if expr in ("sleepy", "neutral"):
        return round_eyes(expr).replace("{{primary}}", c)
    spin = '<animateTransform attributeName="transform" type="rotate" values="0 {x} {y};12 {x} {y};0 {x} {y}" dur="2s" repeatCount="indefinite"/>'
    r = 13 if expr in ("happy", "proud", "surprised") else 11
    return svg(f'<g>{star(L, CY, r, c)}{spin.format(x=L, y=CY)}</g><g>{star(R, CY, r, c)}{spin.format(x=R, y=CY)}</g>')

add("star_eyes", "Star Eyes", "eyes", star_eyes("normal"), z=60, tintable=True, colors={"primary": "#ffd34d"},
    variants={e: star_eyes(e) for e in ["happy", "proud", "surprised", "sleepy", "neutral"]}, tags=["fun"])

# ------------------------------------------------------------------ mouths
def smile(expr):
    c = "{{primary}}"
    y = 128
    if expr in ("happy", "proud"):
        return svg(f'<path d="M88 {y-2} q12 16 24 0z" fill="{c}"/><path d="M93 {y+5} q7 5 14 0" fill="#ff7a8a"/>')
    if expr == "concerned":
        return svg(f'<path d="M90 {y+5} q10 -9 20 0" stroke="{c}" stroke-width="4" fill="none" stroke-linecap="round"/>')
    if expr in ("surprised", "curious"):
        return svg(f'<ellipse cx="100" cy="{y+1}" rx="{6 if expr == "surprised" else 4}" ry="{7 if expr == "surprised" else 4}" fill="{c}"/>')
    if expr in ("sleepy", "neutral", "focused"):
        return svg(f'<path d="M92 {y} h16" stroke="{c}" stroke-width="4" stroke-linecap="round"/>')
    if expr == "thinking":
        return svg(f'<path d="M93 {y+2} q8 -5 16 -2" stroke="{c}" stroke-width="4" fill="none" stroke-linecap="round"/>')
    return svg(f'<path d="M90 {y-2} q10 10 20 0" stroke="{c}" stroke-width="4" fill="none" stroke-linecap="round"/>')

add("smile_mouth", "Smile", "mouth", smile("normal"), z=62, tintable=True, colors={"primary": "#1b1f2a"},
    variants={e: smile(e) for e in EXPRS if e != "normal"})
add("cat_mouth", "Cat Mouth", "mouth", svg('<path d="M90 124 q5 7 10 0 q5 7 10 0" stroke="{{primary}}" stroke-width="3.5" fill="none" stroke-linecap="round"/>'),
    z=62, tintable=True, colors={"primary": "#1b1f2a"},
    variants={"happy": svg('<path d="M88 123 q6 10 12 0 q6 10 12 0" stroke="{{primary}}" stroke-width="4" fill="none" stroke-linecap="round"/>'),
              "concerned": svg('<path d="M90 130 q10 -8 20 0" stroke="{{primary}}" stroke-width="3.5" fill="none" stroke-linecap="round"/>')})
add("fangs", "Little Fangs", "mouth", svg('<path d="M88 124 q12 10 24 0" stroke="{{primary}}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M93 127l2 7 3-6z M107 127l-2 7-3-6z" fill="#fff"/>'),
    z=62, tintable=True, colors={"primary": "#1b1f2a"}, tags=["vampire"])

# ------------------------------------------------------------------ ears, horns
add("cat_ears", "Cat Ears", "ears", svg(
    '<path d="M48 78 L58 26 L92 58 Z" fill="{{primary}}"/><path d="M58 66 L62 40 L80 58 Z" fill="{{secondary}}"/>'
    '<path d="M152 78 L142 26 L108 58 Z" fill="{{primary}}"/><path d="M142 66 L138 40 L120 58 Z" fill="{{secondary}}"/>'),
    z=-2, tintable=True, colors={"primary": "#f7f8fb", "secondary": "#ffb3c7"}, mirrorable=True, tags=["cat"])
add("bunny_ears", "Bunny Ears", "ears", svg(
    '<g fill="{{primary}}"><ellipse cx="74" cy="34" rx="14" ry="38" transform="rotate(-12 74 34)"/><ellipse cx="126" cy="34" rx="14" ry="38" transform="rotate(12 126 34)"/></g>'
    '<g fill="{{secondary}}"><ellipse cx="74" cy="36" rx="7" ry="27" transform="rotate(-12 74 36)"/><ellipse cx="126" cy="36" rx="7" ry="27" transform="rotate(12 126 36)"/></g>'),
    z=-2, tintable=True, colors={"primary": "#f7f8fb", "secondary": "#ffc2d1"}, tags=["bunny"])
add("bear_ears", "Bear Ears", "ears", svg(
    '<g fill="{{primary}}"><circle cx="56" cy="58" r="20"/><circle cx="144" cy="58" r="20"/></g><g fill="{{secondary}}"><circle cx="56" cy="58" r="10"/><circle cx="144" cy="58" r="10"/></g>'),
    z=-2, tintable=True, colors={"primary": "#c98d5a", "secondary": "#8a5a36"}, tags=["bear"])
add("devil_horns", "Devil Horns", "horns", svg(
    '<path d="M62 62 C50 50 48 34 56 22 C60 36 70 46 80 52 Z" fill="{{primary}}"/><path d="M138 62 C150 50 152 34 144 22 C140 36 130 46 120 52 Z" fill="{{primary}}"/>'),
    z=75, tintable=True, colors={"primary": "#e0384c"}, mirrorable=True, tags=["demon"])
add("unicorn_horn", "Unicorn Horn", "horns", svg(
    '<path d="M92 56 L100 12 L108 56 Z" fill="{{primary}}"/><path d="M94 46 L106 42 M96 36 L104 33 M98 26 L102 24" stroke="{{secondary}}" stroke-width="2.5"/>'),
    z=75, tintable=True, colors={"primary": "#ffe9a8", "secondary": "#f0b8ff"}, tags=["unicorn"])

# ------------------------------------------------------------------ wings
dragon = ('M70 92 C46 60 18 52 2 64 C16 70 20 82 16 96 C26 92 34 98 34 110 C44 102 54 104 58 114 C62 104 66 98 70 92 Z')
add("dragon_wings", "Dragon Wings", "wings", svg('<g>' +
    f'<path d="{dragon}" fill="{{{{primary}}}}" stroke="{{{{secondary}}}}" stroke-width="2.5" stroke-linejoin="round"/>'
    f'<path d="{dragon}" fill="{{{{primary}}}}" stroke="{{{{secondary}}}}" stroke-width="2.5" stroke-linejoin="round" transform="translate(200 0) scale(-1 1)"/>'
    '<path d="M70 92 L16 96 M70 92 L34 110 M70 92 L58 114" stroke="{{secondary}}" stroke-width="2" opacity="0.7"/>'
    '<path d="M70 92 L16 96 M70 92 L34 110 M70 92 L58 114" stroke="{{secondary}}" stroke-width="2" opacity="0.7" transform="translate(200 0) scale(-1 1)"/>'
    '<animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.6s" repeatCount="indefinite"/></g>'),
    z=-10, tintable=True, colors={"primary": "#d6304a", "secondary": "#7a0f22"}, mirrorable=True, tags=["dragon"])
add("dragon_wing_single", "Dragon Wing (single)", "wings", svg(
    f'<path d="{dragon}" fill="{{{{primary}}}}" stroke="{{{{secondary}}}}" stroke-width="2.5" stroke-linejoin="round"/>'
    '<path d="M70 92 L16 96 M70 92 L34 110 M70 92 L58 114" stroke="{{secondary}}" stroke-width="2" opacity="0.7"/>'),
    z=-10, tintable=True, colors={"primary": "#d6304a", "secondary": "#7a0f22"}, mirrorable=True, tags=["dragon", "single"])
angel = 'M66 96 C40 70 10 70 4 88 C18 88 10 100 18 106 C26 104 22 116 34 118 C40 112 46 120 56 118 C60 110 64 104 66 96 Z'
add("angel_wings", "Angel Wings", "wings", svg('<g>' +
    f'<path d="{angel}" fill="{{{{primary}}}}" stroke="{{{{secondary}}}}" stroke-width="2"/>'
    f'<path d="{angel}" fill="{{{{primary}}}}" stroke="{{{{secondary}}}}" stroke-width="2" transform="translate(200 0) scale(-1 1)"/>'
    '<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="2s" repeatCount="indefinite"/></g>'),
    z=-10, tintable=True, colors={"primary": "#ffffff", "secondary": "#cfe3ff"}, mirrorable=True, tags=["angel"])

# ------------------------------------------------------------------ tails
add("demon_tail", "Demon Tail", "tail", svg(
    '<path d="M140 150 C170 160 182 140 176 118 C172 104 182 96 188 100" stroke="{{primary}}" stroke-width="7" fill="none" stroke-linecap="round"/>'
    '<path d="M186 84 L198 104 L178 104 Z" fill="{{primary}}"/>'
    '<animateTransform attributeName="transform" type="rotate" values="0 140 150;6 140 150;0 140 150" dur="1.4s" repeatCount="indefinite"/>'),
    z=-5, tintable=True, colors={"primary": "#e0384c"}, mirrorable=True, tags=["demon"])
add("cat_tail", "Cat Tail", "tail", svg(
    '<path d="M144 150 C176 150 184 120 172 98 C166 86 172 76 182 80" stroke="{{primary}}" stroke-width="12" fill="none" stroke-linecap="round"/>'
    '<animateTransform attributeName="transform" type="rotate" values="0 144 150;-8 144 150;0 144 150" dur="2.2s" repeatCount="indefinite"/>'),
    z=-5, tintable=True, colors={"primary": "#f7f8fb"}, mirrorable=True, tags=["cat"])
add("fox_tail", "Fox Tail", "tail", svg(
    '<path d="M140 156 C180 164 198 130 186 100 C182 120 170 128 156 130 C164 120 160 108 150 104 C152 126 144 140 140 156 Z" fill="{{primary}}"/>'
    '<path d="M186 100 C182 116 176 122 168 126 C176 112 182 106 186 100 Z" fill="{{secondary}}"/>'),
    z=-5, tintable=True, colors={"primary": "#f08a3c", "secondary": "#ffffff"}, mirrorable=True, tags=["fox"])

# ------------------------------------------------------------------ headwear
add("crown", "Royal Crown", "headwear", svg(
    '<path d="M68 52 L72 26 L86 40 L100 20 L114 40 L128 26 L132 52 Z" fill="{{primary}}" stroke="{{secondary}}" stroke-width="2.5" stroke-linejoin="round"/>'
    '<circle cx="100" cy="42" r="4" fill="{{accent}}"/><circle cx="80" cy="46" r="3" fill="{{accent}}"/><circle cx="120" cy="46" r="3" fill="{{accent}}"/>'),
    z=80, tintable=True, colors={"primary": "#ffcc33", "secondary": "#b8860b", "accent": "#e0384c"}, tags=["royal"])
add("wizard_hat", "Wizard Hat", "headwear", svg(
    '<path d="M52 62 Q100 74 148 62 L118 52 L96 4 L82 52 Z" fill="{{primary}}"/><path d="M84 44 Q100 50 116 44 L118 52 Q100 58 82 52 Z" fill="{{secondary}}"/>'
    + star(104, 28, 6, "{{secondary}}")),
    z=80, tintable=True, colors={"primary": "#4b3ab8", "secondary": "#ffd34d"}, tags=["magic"])
add("cap", "Cap", "headwear", svg(
    '<path d="M50 64 C52 34 148 34 150 64 Z" fill="{{primary}}"/><path d="M120 62 Q160 58 176 68 Q150 72 120 68 Z" fill="{{secondary}}"/><circle cx="100" cy="38" r="4" fill="{{secondary}}"/>'),
    z=80, tintable=True, colors={"primary": "#2f6fe0", "secondary": "#1d4fae"}, mirrorable=True)
add("halo", "Halo", "headwear", svg(
    '<ellipse cx="100" cy="30" rx="30" ry="8" fill="none" stroke="{{primary}}" stroke-width="5"><animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/></ellipse>'),
    z=80, tintable=True, colors={"primary": "#ffe680"}, tags=["angel"])

# ------------------------------------------------------------------ glasses
add("round_glasses", "Round Glasses", "glasses", svg(
    f'<g fill="{{{{secondary}}}}" fill-opacity="0.18" stroke="{{{{primary}}}}" stroke-width="3.5"><circle cx="{L}" cy="{CY}" r="15"/><circle cx="{R}" cy="{CY}" r="15"/></g>'
    f'<path d="M{L+15} {CY} Q100 {CY-6} {R-15} {CY}" stroke="{{{{primary}}}}" stroke-width="3" fill="none"/>'
    f'<path d="M{L-15} {CY-2} L48 {CY-6} M{R+15} {CY-2} L152 {CY-6}" stroke="{{{{primary}}}}" stroke-width="3"/>'),
    z=70, tintable=True, colors={"primary": "#2b2b36", "secondary": "#9fd8ff"})
add("sunglasses", "Sunglasses", "glasses", svg(
    f'<path d="M{L-17} {CY-9} h34 v10 q0 12 -17 12 q-17 0 -17 -12z M{R-17} {CY-9} h34 v10 q0 12 -17 12 q-17 0 -17 -12z" fill="{{{{primary}}}}"/>'
    f'<path d="M{L+17} {CY-6} h{R-L-34}" stroke="{{{{primary}}}}" stroke-width="4"/><path d="M{L-12} {CY-5} l8 0" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/>'),
    z=70, tintable=True, colors={"primary": "#14161c"}, tags=["cool"])
add("monocle", "Monocle", "glasses", svg(
    f'<circle cx="{R}" cy="{CY}" r="15" fill="#9fd8ff" fill-opacity="0.15" stroke="{{{{primary}}}}" stroke-width="3"/><path d="M{R+12} {CY+10} Q146 140 134 168" stroke="{{{{primary}}}}" stroke-width="1.5" fill="none"/>'),
    z=70, tintable=True, colors={"primary": "#c9a227"}, mirrorable=True, tags=["fancy"])

# ------------------------------------------------------------------ face / neck / back / limbs / pet
add("blush", "Blush", "face", svg('<g fill="{{primary}}" opacity="0.55"><ellipse cx="66" cy="124" rx="9" ry="5"/><ellipse cx="134" cy="124" rx="9" ry="5"/></g>'),
    z=55, tintable=True, colors={"primary": "#ff8fa8"}, tags=["cute"])
add("mustache", "Mustache", "face", svg('<path d="M100 122 C90 112 74 116 70 126 C80 122 88 128 100 126 C112 128 120 122 130 126 C126 116 110 112 100 122 Z" fill="{{primary}}"/>'),
    z=64, tintable=True, colors={"primary": "#4a3426"}, tags=["funny"])
add("scarf", "Scarf", "neck", svg(
    '<path d="M50 150 Q100 166 150 150 L150 162 Q100 178 50 162 Z" fill="{{primary}}"/><path d="M120 160 L128 192 L142 188 L134 158 Z" fill="{{primary}}"/>'
    '<path d="M56 154 L56 166 M70 157 L70 169 M84 159 L84 171" stroke="{{secondary}}" stroke-width="3"/>'),
    z=35, tintable=True, colors={"primary": "#e0384c", "secondary": "#ffffff"}, mirrorable=True)
add("bowtie", "Bow Tie", "neck", svg('<path d="M100 160 L80 150 L80 172 Z M100 160 L120 150 L120 172 Z" fill="{{primary}}"/><circle cx="100" cy="161" r="5" fill="{{secondary}}"/>'),
    z=35, tintable=True, colors={"primary": "#7c3aed", "secondary": "#5b21b6"}, tags=["fancy"])
add("backpack", "Backpack", "back", svg('<rect x="150" y="96" width="30" height="50" rx="10" fill="{{primary}}"/><rect x="154" y="118" width="22" height="16" rx="4" fill="{{secondary}}"/>'),
    z=-8, tintable=True, colors={"primary": "#f08a3c", "secondary": "#c25e18"}, mirrorable=True)
add("cape", "Cape", "back", svg('<path d="M58 120 Q40 170 30 192 L170 192 Q160 170 142 120 Z" fill="{{primary}}"/><path d="M58 120 Q100 136 142 120" stroke="{{secondary}}" stroke-width="4" fill="none"/>'),
    z=-12, tintable=True, colors={"primary": "#b3123a", "secondary": "#ffcc33"}, tags=["hero"])
add("little_arms", "Little Arms", "arms", svg(
    '<g fill="{{primary}}"><ellipse cx="34" cy="140" rx="11" ry="16" transform="rotate(25 34 140)"/><ellipse cx="166" cy="140" rx="11" ry="16" transform="rotate(-25 166 140)">'
    '<animateTransform attributeName="transform" type="rotate" values="-25 166 140;-45 166 140;-25 166 140" dur="1.2s" repeatCount="indefinite"/></ellipse></g>'),
    z=38, tintable=True, colors={"primary": "#eef2f8"}, mirrorable=True)
add("little_feet", "Little Feet", "legs", svg('<g fill="{{primary}}"><ellipse cx="78" cy="176" rx="16" ry="9"/><ellipse cx="122" cy="176" rx="16" ry="9"/></g>'),
    z=5, tintable=True, colors={"primary": "#dfe5ee"})
add("tiny_ghost", "Tiny Ghost Pet", "pet", svg(
    '<g><path d="M170 40c0-10 7-16 14-16s14 6 14 16v14l-4-3-3 3-3-3-4 3-4-3-3 3-4-3z" fill="{{primary}}"/><circle cx="180" cy="38" r="2" fill="#1b1f2a"/><circle cx="188" cy="38" r="2" fill="#1b1f2a"/>'
    '<animateTransform attributeName="transform" type="translate" values="0 0;-6 6;0 0" dur="3s" repeatCount="indefinite"/></g>'),
    z=85, tintable=True, colors={"primary": "#ffffff"}, tags=["pet"])

# ------------------------------------------------------------------ auras, lighting
def aura(c1, c2):
    return svg('<circle cx="100" cy="112" r="92" fill="url(#a)"><animate attributeName="r" values="86;94;86" dur="3s" repeatCount="indefinite"/></circle>',
               '<radialGradient id="a"><stop offset="0.45" stop-color="{{primary}}" stop-opacity="0.55"/><stop offset="0.75" stop-color="{{secondary}}" stop-opacity="0.25"/><stop offset="1" stop-color="{{secondary}}" stop-opacity="0"/></radialGradient>')
add("purple_aura", "Purple Aura", "aura", aura(0, 0), z=-20, tintable=True, colors={"primary": "#8b5cf6", "secondary": "#c084fc"}, tags=["aura"])
add("blue_aura", "Blue Aura", "aura", aura(0, 0), z=-20, tintable=True, colors={"primary": "#3b82f6", "secondary": "#22d3ee"}, tags=["aura"])
add("golden_aura", "Golden Aura", "aura", aura(0, 0), z=-20, tintable=True, colors={"primary": "#fbbf24", "secondary": "#fde68a"}, tags=["aura"])
add("rim_light", "Rim Light", "lighting", svg('<circle cx="100" cy="112" r="70" fill="none" stroke="{{primary}}" stroke-width="6" opacity="0.35" filter="url(#b)"/>', '<filter id="b"><feGaussianBlur stdDeviation="4"/></filter>'),
    z=110, tintable=True, colors={"primary": "#8fd3ff"})

# ------------------------------------------------------------------ effects / particles
def twinkle(x, y, r, d, c="{{primary}}"):
    return f'<g opacity="0">{star(x, y, r, c)}<animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="{d}s" repeatCount="indefinite"/></g>'
add("stars", "Stars", "effects", svg(twinkle(30, 40, 7, 0) + twinkle(172, 52, 6, 0.6) + twinkle(160, 168, 5, 1.2) + twinkle(36, 160, 6, 1.8) + twinkle(100, 14, 5, 0.9)),
    z=90, tintable=True, colors={"primary": "#ffd34d"}, tags=["sparkle"])
add("sparkles", "Sparkles", "effects", svg(''.join(
    f'<circle cx="{x}" cy="{y}" r="2.5" fill="{{{{primary}}}}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="{d}s" repeatCount="indefinite"/><animate attributeName="cy" values="{y};{y-14}" dur="1.6s" begin="{d}s" repeatCount="indefinite"/></circle>'
    for x, y, d in [(40, 120, 0), (60, 160, 0.4), (150, 150, 0.8), (165, 100, 1.1), (30, 80, 1.3), (120, 180, 0.6)])),
    z=100, tintable=True, colors={"primary": "#ffffff"})
add("fire", "Fire", "effects", svg(
    '<g fill="url(#f)"><path d="M40 190 C30 170 44 156 40 140 C56 152 60 170 56 190 Z"><animate attributeName="d" values="M40 190 C30 170 44 156 40 140 C56 152 60 170 56 190 Z;M40 190 C34 168 40 150 46 136 C58 152 58 172 56 190 Z;M40 190 C30 170 44 156 40 140 C56 152 60 170 56 190 Z" dur="0.9s" repeatCount="indefinite"/></path>'
    '<path d="M150 190 C142 172 154 158 152 144 C166 156 168 174 164 190 Z"><animate attributeName="d" values="M150 190 C142 172 154 158 152 144 C166 156 168 174 164 190 Z;M150 190 C146 170 150 154 158 140 C168 156 166 176 164 190 Z;M150 190 C142 172 154 158 152 144 C166 156 168 174 164 190 Z" dur="1.1s" repeatCount="indefinite"/></path></g>',
    '<linearGradient id="f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="{{primary}}"/><stop offset="1" stop-color="{{secondary}}"/></linearGradient>'),
    z=90, tintable=True, colors={"primary": "#ff5a1f", "secondary": "#ffd34d"}, tags=["fire"])
add("hearts", "Hearts", "effects", svg(''.join(
    f'<path d="M{x} {y} c-4 -6 -12 -2 -10 4 c2 5 10 9 10 9 s8 -4 10 -9 c2 -6 -6 -10 -10 -4z" fill="{{{{primary}}}}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="2.2s" begin="{d}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -18" dur="2.2s" begin="{d}s" repeatCount="indefinite"/></path>'
    for x, y, d in [(34, 70, 0), (168, 80, 0.7), (150, 40, 1.4)])),
    z=90, tintable=True, colors={"primary": "#ff4d79"}, tags=["love"])
add("lightning", "Lightning", "effects", svg(
    '<path d="M28 30 L44 30 L34 58 L50 58 L24 98 L32 66 L18 66 Z" fill="{{primary}}" opacity="0"><animate attributeName="opacity" values="0;0;1;0;1;0" keyTimes="0;0.7;0.75;0.8;0.85;1" dur="2.5s" repeatCount="indefinite"/></path>'
    '<path d="M168 24 L182 24 L174 48 L188 48 L164 84 L171 56 L158 56 Z" fill="{{primary}}" opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.4;0.45;0.55" dur="3.1s" repeatCount="indefinite"/></path>'),
    z=90, tintable=True, colors={"primary": "#ffe14d"}, tags=["storm"])
add("snow", "Snow", "particles", svg(''.join(
    f'<circle cx="{x}" cy="-5" r="{r}" fill="{{{{primary}}}}" opacity="0.85"><animate attributeName="cy" values="-5;205" dur="{t}s" begin="{d}s" repeatCount="indefinite"/></circle>'
    for x, r, t, d in [(20, 2, 5, 0), (60, 3, 6, 1.5), (100, 2, 4.5, 0.8), (140, 2.5, 5.5, 2.2), (180, 2, 6.5, 0.3), (40, 1.5, 4, 3), (160, 3, 5, 3.6)])),
    z=100, tintable=True, colors={"primary": "#ffffff"}, tags=["winter"])

SLOTS = [
    {"id": "aura", "name": "Aura", "multiple": True, "zDefault": -20},
    {"id": "back", "name": "Back", "multiple": True, "zDefault": -12},
    {"id": "wings", "name": "Wings", "multiple": True, "zDefault": -10},
    {"id": "tail", "name": "Tail", "multiple": True, "zDefault": -5},
    {"id": "ears", "name": "Ears", "multiple": True, "zDefault": -2},
    {"id": "body", "name": "Body", "multiple": False, "required": True, "zDefault": 0},
    {"id": "legs", "name": "Legs", "multiple": True, "zDefault": 5},
    {"id": "shoes", "name": "Shoes", "multiple": True, "zDefault": 6},
    {"id": "body_accessories", "name": "Body accessories", "multiple": True, "zDefault": 30},
    {"id": "neck", "name": "Neck", "multiple": True, "zDefault": 35},
    {"id": "arms", "name": "Arms", "multiple": True, "zDefault": 38},
    {"id": "face", "name": "Face", "multiple": True, "zDefault": 55},
    {"id": "eyes", "name": "Eyes", "multiple": False, "expressive": True, "zDefault": 60},
    {"id": "mouth", "name": "Mouth", "multiple": False, "expressive": True, "zDefault": 62},
    {"id": "glasses", "name": "Glasses", "multiple": True, "zDefault": 70},
    {"id": "horns", "name": "Horns", "multiple": True, "zDefault": 75},
    {"id": "headwear", "name": "Headwear", "multiple": True, "zDefault": 80},
    {"id": "pet", "name": "Pet", "multiple": True, "zDefault": 85},
    {"id": "effects", "name": "Effects", "multiple": True, "zDefault": 90},
    {"id": "particles", "name": "Particles", "multiple": True, "zDefault": 100},
    {"id": "lighting", "name": "Lighting", "multiple": True, "zDefault": 110},
    {"id": "custom", "name": "Custom", "multiple": True, "zDefault": 50},
]

manifest = {"id": "builtin", "name": "NEXUS Base Pack", "version": "1.0.0", "slots": SLOTS, "assets": ASSETS}
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), indent=1)
print(f"{len(ASSETS)} assets, {len(os.listdir(OUT))} files")
