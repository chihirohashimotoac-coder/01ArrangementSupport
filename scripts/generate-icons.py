"""
アプリアイコン（favicon / apple-touch-icon / PWA / maskable）を原本から書き出すスクリプト。

原本は assets/app-icon-source.webp（正式なアプリアイコン。1254x1254, RGBA, sRGB）。
デザインは描き変えず、縮小と余白の付加だけを行う。

  npm run icons        # = python3 scripts/generate-icons.py（要 Pillow）

出力（public/icons/）
  favicon-32.png / favicon-48.png   原本をそのまま縮小（外周の透明を保つ）
  icon-192.png / icon-512.png       同上。manifest の purpose: "any"
  apple-touch-icon-180.png          角丸の外側を塗って不透明にしたもの（下記）
  icon-maskable-192.png / -512.png  safe zone へ収めたもの（下記）

不透明が必要な 2 種類について
  - iOS はホーム画面アイコンの透明部分を黒で表示し、角丸は OS 側で切り抜く。
    そのため apple-touch-icon は原本の角丸四角形の外接正方形へ切り詰め、
    角丸の外側だけを周囲のネイビーの延長で塗る。
  - maskable は OS が円や squircle で切り抜くため、主要部分を中心から半径 40% の
    safe zone に収める必要がある。原本の前景（ターゲットとダーツ）の最遠点は
    外接正方形の半辺の約 0.95 倍にあるので、外接正方形を一辺の 80% へ縮めて中央に置き
    （最遠点は約 38%）、周囲をネイビーの延長で塗る。
  塗りは、角丸四角形の縁のすぐ内側の細い帯を、中心から放射方向へ引き伸ばして作る
  （各画素は、中心と結んだ線が縁と交わる位置の色になる）。境目に継ぎ目が出ず、
  ターゲットやダーツの色は混ざらない。
  原本の本体は alpha が 252〜253（約 99%）なので、不透明にする際は alpha >= 250 を
  255 とみなす（周囲の塗りが 1% 透けて色が変わるのを避ける）。
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets' / 'app-icon-source.webp'
OUT_DIR = ROOT / 'public' / 'icons'

# 高品質な縮小。Pillow は RGBA を内部で premultiply してから縮小するため、
# 透明との境界に暗いフリンジは出ない。シャープネス処理は加えない。
RESAMPLE = Image.Resampling.LANCZOS

# maskable で外接正方形が占める割合。safe zone は中心から半径 40%。
MASKABLE_ART_RATIO = 0.8
SAFE_ZONE_RADIUS = 0.4


def body_bbox(image):
    """角丸四角形（アイコン本体）の外接矩形。半透明の縁は alpha >= 128 で判定する。"""
    return image.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()


def scaled_mask(mask, ratio):
    """mask を中心基準で ratio 倍に縮めたもの（元と同じ大きさのキャンバス）。"""
    w, h = mask.size
    small = mask.resize((round(w * ratio), round(h * ratio)), Image.Resampling.BILINEAR)
    canvas = Image.new('L', mask.size, 0)
    canvas.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return canvas


# 縁の帯（本体の外接正方形に対する倍率）。外側 2% はアンチエイリアスの縁なので使わない。
EDGE_BAND = (0.96, 0.98)
# 帯を引き伸ばす倍率の刻み。帯の幅より細かくして隙間を作らない。
EDGE_STEP = 1.01


def edge_band(body):
    """角丸四角形の縁のすぐ内側の細い帯だけを残した画像。"""
    solid = body.getchannel('A').point(lambda a: 255 if a >= 200 else 0)
    outer = scaled_mask(solid, EDGE_BAND[1]).point(lambda a: 255 if a == 255 else 0)
    inner = scaled_mask(solid, EDGE_BAND[0]).point(lambda a: 255 if a > 0 else 0)
    band = body.copy()
    band.putalpha(ImageChops.subtract(outer, inner))
    return band


def assert_band_is_background(body, band):
    """帯に白・シルバー・ターコイズ（前景）の画素が混ざっていないこと。"""
    pixels = body.load()
    alpha = band.getchannel('A').load()
    w, h = body.size
    for y in range(h):
        for x in range(w):
            if alpha[x, y] and (pixels[x, y][0] > 90 or pixels[x, y][1] > 90):
                raise SystemExit(f'塗りの帯に前景の画素が含まれています: ({x}, {y}) {pixels[x, y]}')


def radial_extension(body, canvas_size):
    """縁の帯を中心から放射方向へ引き伸ばし、canvas_size の正方形を埋めた画像。"""
    band = edge_band(body)
    size = body.width
    # キャンバスの角まで届く倍率。帯の内側の縁（EDGE_BAND[0]）が角を越えるまで広げる。
    limit = (canvas_size * 2 ** 0.5 / 2) / (size * EDGE_BAND[0] / 2)
    scales = [1.0]
    while scales[-1] < limit:
        scales.append(scales[-1] * EDGE_STEP)
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    # 大きい倍率から順に重ね、小さい倍率（縁に近い色）を上にする。
    for scale in reversed(scales):
        side = round(size * scale)
        layer = band.resize((side, side), Image.Resampling.BILINEAR)
        offset = (canvas_size - side) // 2
        # キャンバスからはみ出す分は切り取ってから重ねる。
        crop_from = max(0, -offset)
        visible = layer.crop((crop_from, crop_from, side - crop_from, side - crop_from))
        placed = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        placed.paste(visible, (max(0, offset),) * 2)
        canvas = Image.alpha_composite(canvas, placed)
    # 内側（本体に隠れる部分）の穴は本体を置けば埋まる。ここでは継ぎ目をならすだけ。
    return canvas.filter(ImageFilter.GaussianBlur(radius=size * 0.002))


def opaque_on_extended_background(body, canvas_size):
    """body を中央に置いた canvas_size の不透明画像（周囲はネイビーの延長）。"""
    offset = ((canvas_size - body.width) // 2,) * 2
    solid_body = body.copy()
    solid_body.putalpha(body.getchannel('A').point(lambda a: 255 if a >= 250 else a))
    result = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 255))
    result = Image.alpha_composite(result, radial_extension(body, canvas_size))
    art_canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    art_canvas.paste(solid_body, offset)
    return Image.alpha_composite(result, art_canvas)


def foreground_reach(body):
    """前景の最遠点までの距離（外接正方形の半辺を 1 とする）。"""
    pixels = body.load()
    w, h = body.size
    cx, cy, half = (w - 1) / 2, (h - 1) / 2, w / 2
    reach = 0.0
    for y in range(h):
        for x in range(w):
            r, g, _, a = pixels[x, y]
            if a > 128 and (r > 90 or g > 90):
                reach = max(reach, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / half)
    return reach


def save(image, name, size):
    resized = image if image.width == size else image.resize((size, size), RESAMPLE)
    resized.save(OUT_DIR / name, optimize=True)
    print(f'wrote {name} ({size}x{size}, {resized.mode})')


def main():
    source = Image.open(SOURCE)
    source.load()
    source = source.convert('RGBA')
    if source.width != source.height:
        raise SystemExit(f'原本が正方形ではありません: {source.size}')

    body = source.crop(body_bbox(source))
    if body.width != body.height:
        raise SystemExit(f'アイコン本体が正方形ではありません: {body.size}')
    assert_band_is_background(body, edge_band(body))

    reach = foreground_reach(body) * MASKABLE_ART_RATIO / 2
    if reach > SAFE_ZONE_RADIUS:
        raise SystemExit(f'maskable の前景が safe zone を超えます: 半径 {reach:.3f}')
    print(f'maskable: 前景の最遠点は中心から {reach:.1%}（safe zone {SAFE_ZONE_RADIUS:.0%}）')

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, size in [
        ('favicon-32.png', 32),
        ('favicon-48.png', 48),
        ('icon-192.png', 192),
        ('icon-512.png', 512),
    ]:
        save(source, name, size)

    apple = opaque_on_extended_background(body, body.width)
    save(apple.convert('RGB'), 'apple-touch-icon-180.png', 180)

    canvas = round(body.width / MASKABLE_ART_RATIO)
    maskable = opaque_on_extended_background(body, canvas)
    for name, size in [('icon-maskable-192.png', 192), ('icon-maskable-512.png', 512)]:
        save(maskable.convert('RGB'), name, size)


if __name__ == '__main__':
    main()
