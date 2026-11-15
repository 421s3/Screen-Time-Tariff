"""Pillow artwork for the desktop app: Tariff Tom in four moods, backdrops, cards, buttons.

Tom is redrawn from the dashboard's SVG (web/src/components/Mascot.tsx, 120x120 viewBox) so the
app and the website show the same character. Everything is drawn at 4x and scaled down, which is
how we get smooth edges out of Pillow.
"""

from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersampling factor

# Dark, calm palette (Ahead-like softness, Screen Time Tariff violet)
INK = "#1c1c2e"
SKIN = "#f2c9a0"
SKIN_ANGRY = "#f4a78c"
VIOLET = "#7c3aed"
GOLD = "#d4a017"
MUSTACHE = "#3b2a20"
MOUTH = "#7a3b2e"
COIN = "#facc15"
COIN_EDGE = "#b45309"

MOODS = ("happy", "angry", "worried", "sleepy")


def _hex(c, alpha=255):
    c = c.lstrip("#")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha)


def _quad(p0, p1, p2, n=24):
    """Points on a quadratic Bezier (the SVG's Q commands)."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


@lru_cache(maxsize=32)
def tom(mood: str = "happy", size: int = 160) -> Image.Image:
    """Tariff Tom as an RGBA image. Moods: happy, angry, worried, sleepy."""
    assert mood in MOODS, mood
    k = size * SS / 120  # SVG units -> supersampled pixels
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return (x * k, y * k)

    def box(x0, y0, x1, y1):
        return [x0 * k, y0 * k, x1 * k, y1 * k]

    def circle(cx, cy, r, **kw):
        d.ellipse(box(cx - r, cy - r, cx + r, cy + r), **kw)

    def path(points, width, fill):
        d.line([P(*p) for p in points], fill=fill, width=max(1, int(width * k)), joint="curve")
        for p in (points[0], points[-1]):  # round caps
            circle(*p, width / 2, fill=fill)

    # Steam when angry (behind the hat)
    if mood == "angry":
        for sx, sy in ((22, 30), (98, 30)):
            for i, r in enumerate((5, 4, 3)):
                circle(sx + (i * 3 if sx > 60 else -i * 3), sy - i * 8, r, fill=_hex("#ffffff", 200))

    # Top hat (with a soft violet rim so it doesn't vanish on the dark app background)
    rim = _hex("#a78bfa", 170)
    d.rounded_rectangle(box(34, 8, 86, 46), radius=4 * k, fill=INK, outline=rim, width=int(1.4 * k))
    d.rectangle(box(35.5, 34, 84.5, 42), fill=VIOLET)
    d.line([P(39, 12), P(39, 31)], fill=_hex("#ffffff", 50), width=int(2.5 * k))  # sheen
    d.rounded_rectangle(box(20, 44, 100, 52), radius=4 * k, fill=INK, outline=rim, width=int(1.4 * k))
    if mood == "angry":  # hat tips forward a little: brim shadow
        d.rectangle(box(24, 50, 96, 53), fill=_hex(INK, 120))

    # Face
    circle(60, 72, 32, fill=SKIN_ANGRY if mood == "angry" else SKIN)
    if mood == "angry":
        circle(41, 82, 6, fill=_hex("#ef4444", 90))  # flushed cheeks
        circle(79, 82, 6, fill=_hex("#ef4444", 90))

    # Eyes and brows
    if mood == "sleepy":
        path(_quad((43, 66), (48, 70), (53, 66)), 2.4, INK)
        path(_quad((67, 66), (72, 70), (77, 66)), 2.4, INK)
    else:
        r = 3.5 if mood == "angry" else 4
        circle(48, 66, r, fill=INK)
        circle(72, 66, r, fill=INK)
        if mood in ("happy", "worried"):  # catchlights
            circle(49.3, 64.7, 1.1, fill="white")
            circle(73.3, 64.7, 1.1, fill="white")
    if mood == "angry":
        path([(40, 55), (53, 60)], 3.2, INK)
        path([(80, 55), (67, 60)], 3.2, INK)
    elif mood == "worried":
        path([(41, 59), (53, 56)], 2.4, INK)
        path([(79, 59), (67, 56)], 2.4, INK)

    # Monocle + chain
    d.ellipse(box(63, 57, 81, 75), outline=GOLD, width=int(2.5 * k))
    path(_quad((81, 70), (92, 82), (88, 96)), 1.5, GOLD)

    # Mustache
    d.polygon([P(*p) for p in _quad((36, 82), (48, 74), (60, 82)) + _quad((60, 82), (72, 74), (84, 82))
               + _quad((84, 82), (72, 92), (60, 86)) + _quad((60, 86), (48, 92), (36, 82))], fill=MUSTACHE)
    if mood == "angry":  # bristling ends
        path([(36, 82), (31, 78)], 2.2, MUSTACHE)
        path([(84, 82), (89, 78)], 2.2, MUSTACHE)

    # Mouth
    if mood == "happy":
        path(_quad((50, 94), (60, 102), (70, 94)), 3, MOUTH)
    elif mood == "angry":
        path(_quad((50, 99), (60, 92), (70, 99)), 3.2, MOUTH)
    elif mood == "worried":
        path([(51, 97), (55, 95), (60, 97), (65, 95), (69, 97)], 2.6, MOUTH)
    else:  # sleepy
        circle(60, 96, 2.6, fill=MOUTH)

    # Extras
    if mood == "worried":  # sweat drop
        d.polygon([P(90, 52), P(86, 61), P(94, 61)], fill=_hex("#7dd3fc"))
        circle(90, 61.5, 4, fill=_hex("#7dd3fc"))
    if mood == "sleepy":
        for i, (zx, zy, zs) in enumerate(((90, 40, 7), (99, 28, 5), (106, 19, 4))):
            path([(zx, zy), (zx + zs, zy), (zx, zy + zs), (zx + zs, zy + zs)], 1.6, _hex("#c4b5fd"))

    # Coin (the tariff)
    circle(100, 100, 14, fill=COIN)
    d.ellipse(box(86, 86, 114, 114), outline=COIN_EDGE, width=int(3 * k))
    d.ellipse(box(94, 94, 106, 106), outline=COIN_EDGE, width=int(2.4 * k))
    if mood == "angry":
        path([(100, 82), (100, 79)], 1.6, COIN_EDGE)  # coin "bounce" marks
        path([(110, 85), (113, 82)], 1.6, COIN_EDGE)

    return img.resize((size, size), Image.LANCZOS)


def tom_face_icon(mood: str = "happy", size: int = 64) -> Image.Image:
    """Square, tightly cropped Tom for the tray/taskbar."""
    full = tom(mood, size * 2)
    return full.crop((0, 0, int(size * 2 * 0.95), int(size * 2 * 0.95))).resize((size, size), Image.LANCZOS)


def _rounded(size, radius, fill, outline=None, width=0):
    w, h = size
    img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, w * SS - 1, h * SS - 1], radius=radius * SS, fill=fill,
                                          outline=outline, width=width * SS)
    return img.resize((w, h), Image.LANCZOS)


@lru_cache(maxsize=16)
def backdrop(width: int, height: int, top: str, bottom: str, glow: str, glow_center: tuple,
             card_box: tuple, card_fill: str, card_edge: str) -> Image.Image:
    """Window background: vertical gradient, a soft mood glow behind Tom, and the main card with
    a layered shadow. Cached per state, so mood changes are just an image swap."""
    t, b = _hex(top), _hex(bottom)
    grad = Image.new("RGBA", (1, height))
    for y in range(height):
        f = y / max(1, height - 1)
        grad.putpixel((0, y), tuple(int(t[i] + (b[i] - t[i]) * f) for i in range(4)))
    img = grad.resize((width, height))

    glow_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gx, gy, gr = glow_center
    ImageDraw.Draw(glow_layer).ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=_hex(glow, 120))
    img = Image.alpha_composite(img, glow_layer.filter(ImageFilter.GaussianBlur(gr * 0.55)))

    x0, y0, x1, y1 = card_box
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([x0 + 2, y0 + 10, x1 - 2, y1 + 14], radius=26, fill=(5, 3, 20, 150))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(14)))
    img.alpha_composite(_rounded((x1 - x0, y1 - y0), 24, _hex(card_fill, 236), _hex(card_edge), 1), (x0, y0))
    return img


@lru_cache(maxsize=64)
def pill(width: int, height: int, fill: str, edge: str = "", alpha: int = 255) -> Image.Image:
    """Rounded pill (buttons, tags, status chip)."""
    return _rounded((width, height), height // 2, _hex(fill, alpha), _hex(edge) if edge else None, 1 if edge else 0)


@lru_cache(maxsize=16)
def rounded_box(width: int, height: int, fill: str, edge: str, radius: int = 14) -> Image.Image:
    return _rounded((width, height), radius, _hex(fill), _hex(edge), 1)


@lru_cache(maxsize=8)
def switch(on: bool, accent: str, off: str = "#3b3466", scale: float = 1.0) -> Image.Image:
    """iOS-style toggle, 40x22 at 100% display scaling."""
    w, h = round(40 * scale), round(22 * scale)
    img = _rounded((w, h), h // 2, _hex(accent if on else off))
    knob = Image.new("RGBA", (h * SS, h * SS), (0, 0, 0, 0))
    m = round(3 * scale) * SS
    ImageDraw.Draw(knob).ellipse([m, m, h * SS - m, h * SS - m], fill=_hex("#ffffff"))
    img.alpha_composite(knob.resize((h, h), Image.LANCZOS), (w - h if on else 0, 0))
    return img


@lru_cache(maxsize=8)
def dot(color: str, size: int = 10) -> Image.Image:
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse([0, 0, size * SS - 1, size * SS - 1], fill=_hex(color))
    return img.resize((size, size), Image.LANCZOS)


# ---- Buttons: a solid face on a darker 3D edge (matches the website's buttons) -------------
@lru_cache(maxsize=256)
def button(width: int, height: int, face: str, edge: str, radius: int, edge_h: int, offset: int) -> Image.Image:
    """Button image `height + edge_h` tall. `offset` = how far the face has sunk into the edge:
    0 = lifted (hover), edge_h = fully pressed."""
    W, H, E, o, r = width * SS, height * SS, edge_h * SS, offset * SS, radius * SS
    img = Image.new("RGBA", (W, H + E + 2 * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, E + 2 * SS, W - 1, H + E + 2 * SS - 1], radius=r, fill=(5, 3, 20, 90))  # soft shadow
    d.rounded_rectangle([0, E, W - 1, H + E - 1], radius=r, fill=_hex(edge))
    d.rounded_rectangle([0, o, W - 1, H + o - 1], radius=r, fill=_hex(face))
    d.line([(r, o + SS), (W - r, o + SS)], fill=(255, 255, 255, 46), width=SS)  # top highlight
    return img.resize((width, height + edge_h + 2), Image.LANCZOS)


@lru_cache(maxsize=32)
def icon(name: str, size: int, color: str) -> Image.Image:
    """Stroke icons for the desktop buttons (same shapes as web/src/components/Icon.tsx)."""
    k = size * SS / 24
    img = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = max(1, int(2.2 * k))
    c = _hex(color)

    def line(*pts):
        d.line([(x * k, y * k) for x, y in pts], fill=c, width=w, joint="curve")
        for x, y in (pts[0], pts[-1]):
            d.ellipse([x * k - w / 2, y * k - w / 2, x * k + w / 2, y * k + w / 2], fill=c)

    if name == "key":
        d.ellipse([3 * k, 3 * k, 13 * k, 13 * k], outline=c, width=w)
        line((11.8, 11.8), (20, 20))
        line((17, 17), (15, 19))
        line((20, 20), (18, 22))
    elif name == "chart":
        line((5, 20), (5, 11))
        line((11, 20), (11, 4))
        line((17, 20), (17, 13))
        line((3, 21), (21, 21))
    elif name == "plug":
        line((9, 3), (9, 7))
        line((15, 3), (15, 7))
        d.rounded_rectangle([6.5 * k, 7 * k, 17.5 * k, 15 * k], radius=int(4 * k), outline=c, width=w)
        line((12, 15), (12, 21))
    return img.resize((size, size), Image.LANCZOS)
