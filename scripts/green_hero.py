"""Recolour the hero video: pink blossoms become green leaves, the red trunk and ground become warm brown earth.

The blossoms and falling petals are pink (hue about 345 to 358 degrees) and softly saturated; the trunk and ground
are red-orange (hue 1 to 12 degrees) and strongly saturated. Each pixel gets a weight from both, and weighted
pixels are moved to a leaf-green hue with the same saturation and brightness, so the glow and shading survive.
The remaining red pixels are turned a little towards brown, so green leaves do not sit on bright red ground.

Run once: python scripts/green_hero.py <input.mp4> <output.mp4> [--frame N preview.png]
Needs: pip install imageio-ffmpeg numpy pillow
"""

import argparse

import numpy as np

GREEN_HUE = 128 / 360
SATURATION_BOOST = 1.15
EARTH_HUE = 24 / 360
EARTH_SATURATION = 0.72


def ramp(x, start, end):
    """0 below start, 1 above end, linear in between (start may be greater than end for a falling ramp)."""
    return np.clip((x - start) / (end - start), 0, 1)


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    high = rgb.max(-1)
    low = rgb.min(-1)
    delta = high - low
    safe = np.where(delta == 0, 1, delta)
    hue = np.where(high == r, ((g - b) / safe) % 6, np.where(high == g, (b - r) / safe + 2, (r - g) / safe + 4)) / 6
    hue = np.where(delta == 0, 0, hue)
    saturation = np.where(high == 0, 0, delta / np.where(high == 0, 1, high))
    return hue, saturation, high


def hsv_to_rgb(hue, saturation, value):
    i = np.floor(hue * 6).astype(int) % 6
    f = hue * 6 - np.floor(hue * 6)
    p = value * (1 - saturation)
    q = value * (1 - f * saturation)
    t = value * (1 - (1 - f) * saturation)
    choices = [(value, t, p), (q, value, p), (p, value, t), (p, q, value), (t, p, value), (value, p, q)]
    out = np.zeros(hue.shape + (3,))
    for index, (r, g, b) in enumerate(choices):
        mask = i == index
        out[mask] = np.stack([r[mask], g[mask], b[mask]], -1)
    return out


def recolour(frame):
    rgb = frame.astype(np.float32) / 255
    hue, saturation, value = rgb_to_hsv(rgb)
    degrees = hue * 360
    # Pink and magenta: full from 315 to 357 degrees, fading out by 300 and by 2 degrees (the trunk starts there).
    pink = np.where(degrees >= 180, ramp(degrees, 300, 315) * ramp(degrees, 361, 357), ramp(degrees, 2, 0))
    # The trunk and ground are more saturated than the blossoms.
    soft = ramp(saturation, 0.78, 0.62)
    weight = (pink * soft)[..., None]
    green = hsv_to_rgb(np.full_like(hue, GREEN_HUE), np.clip(saturation * SATURATION_BOOST, 0, 1), value)
    # Red to orange that is not a blossom: the trunk, the ground and its glow.
    red = np.where(degrees >= 180, ramp(degrees, 340, 352), ramp(degrees, 26, 16))
    earth_weight = (red * (1 - pink * soft))[..., None]
    earth = hsv_to_rgb(np.full_like(hue, EARTH_HUE), saturation * EARTH_SATURATION, value * 0.92)
    out = rgb * (1 - weight - earth_weight) + green * weight + earth * earth_weight
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def main():
    import imageio_ffmpeg

    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--frame", nargs=2, metavar=("N", "PNG"), help="Write one recoloured frame as a preview and stop")
    args = parser.parse_args()

    reader = imageio_ffmpeg.read_frames(args.source)
    meta = next(reader)
    width, height = meta["size"]
    frames = (np.frombuffer(raw, np.uint8).reshape(height, width, 3) for raw in reader)

    if args.frame:
        from PIL import Image

        wanted, png = int(args.frame[0]), args.frame[1]
        for index, frame in enumerate(frames):
            if index == wanted:
                Image.fromarray(recolour(frame)).save(png)
                break
        reader.close()
        return

    writer = imageio_ffmpeg.write_frames(
        args.target, (width, height), fps=meta["fps"], codec="libx264", quality=None, macro_block_size=8,
        output_params=["-crf", "26", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"],
    )
    writer.send(None)
    count = 0
    for frame in frames:
        writer.send(np.ascontiguousarray(recolour(frame)))
        count += 1
    writer.close()
    print(f"Wrote {count} frames to {args.target}")


if __name__ == "__main__":
    main()
