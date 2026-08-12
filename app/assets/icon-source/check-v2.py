#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SVG = "{http://www.w3.org/2000/svg}"
VARIANTS = {
    "v2-cream-flowers": ("#D9A521", "#8A4B23", "#6E7A22"),
    "v2-avocado-flowers": ("#D9A521", "#F1E7D3", "#8A4B23"),
    "v2-banner": ("#D9A521", "#8A4B23", "#6E7A22"),
}
ARC_ANGLES = [-64, -48, -32, -16, 0, 16, 32, 48, 64]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def svg_contract(name: str, bowl_colors: tuple[str, str, str]) -> None:
    path = ROOT / f"{name}.svg"
    require(path.is_file(), f"missing {path.name}")
    root = ET.parse(path).getroot()

    require(root.get("width") == "1024" and root.get("height") == "1024", f"{name}: wrong canvas")
    require(not root.findall(f".//{SVG}textPath"), f"{name}: textPath is forbidden")
    require(not root.findall(f".//{SVG}linearGradient"), f"{name}: gradients are forbidden")
    require(not root.findall(f".//{SVG}radialGradient"), f"{name}: gradients are forbidden")
    require(not root.findall(f".//{SVG}filter"), f"{name}: filters are forbidden")
    require(
        not any(node.get("rx") or node.get("ry") for node in root.findall(f".//{SVG}rect")),
        f"{name}: rounded rectangles are forbidden",
    )

    background = root.find(f"{SVG}rect")
    require(background is not None and background.get("width") == "1024" and background.get("height") == "1024", f"{name}: opaque field missing")

    bowls = tuple(root.find(f".//*[@id='bowl-{size}']") for size in ("small", "medium", "large"))
    require(all(bowl is not None for bowl in bowls), f"{name}: all three bowls need stable ids")
    fills = tuple(bowl.get("fill") for bowl in bowls if bowl is not None)
    require(fills == bowl_colors, f"{name}: wrong bowl order {fills}")
    require(len(set(fills)) == 3, f"{name}: bowl colors must be distinct")
    require(all(bowl.get("stroke") == "#F1E7D3" for bowl in bowls if bowl is not None), f"{name}: cream bowl separation missing")

    wordmark = root.find(".//*[@id='wordmark']")
    require(wordmark is not None, f"{name}: wordmark missing")
    require(wordmark.get("font-family") == "Rubik Black", f"{name}: wordmark must name Rubik Black")
    require(wordmark.get("font-weight") == "900", f"{name}: wordmark must use weight 900")

    if name == "v2-banner":
        require("".join(wordmark.itertext()).strip() == "BACKSTAMP", f"{name}: straight wordmark is wrong")
        require(float(wordmark.get("font-size", "0")) > 86, f"{name}: wordmark is not larger than v1")
        return

    letters = wordmark.findall(f"{SVG}text")
    require("".join(letter.text or "" for letter in letters) == "BACKSTAMP", f"{name}: arc letters are wrong")
    require(len(letters) == 9, f"{name}: each letter needs its own text element")
    require(all(float(letter.get("font-size", "0")) > 86 for letter in letters), f"{name}: arc text is not larger than v1")
    angles = [int(letter.get("data-angle", "999")) for letter in letters]
    require(angles == ARC_ANGLES, f"{name}: uneven arc angles {angles}")
    require(all(f"rotate({angle} 512 512)" in letter.get("transform", "") for letter, angle in zip(letters, angles)), f"{name}: letter rotation does not match its position")


def font_contract() -> None:
    bundled = ROOT.parent / "fonts" / "Rubik-Black.ttf"
    matched = Path(
        subprocess.check_output(
            ["fc-match", "-f", "%{file}", "Rubik Black:style=Black"], text=True
        ).strip()
    )
    require(matched.is_file(), "Fontconfig did not resolve Rubik Black")
    digest = lambda path: hashlib.sha256(path.read_bytes()).digest()
    require(digest(matched) == digest(bundled), f"Fontconfig resolved unexpected font: {matched}")


def rendered_contract(output: Path) -> None:
    subprocess.run([str(ROOT / "build-icons.sh"), str(output)], check=True)
    for name in VARIANTS:
        for size in (1024, 180, 60):
            png = output / f"{name}-{size}.png"
            require(png.is_file(), f"missing {png.name}")
            dimensions, channels = subprocess.check_output(
                ["identify", "-format", "%wx%h;%[channels]", str(png)], text=True
            ).split(";")
            require(dimensions == f"{size}x{size}", f"{png.name}: wrong dimensions")
            require("a" not in channels.lower(), f"{png.name}: output is not opaque")


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/backstamp-icon-check")
    for name, bowl_colors in VARIANTS.items():
        svg_contract(name, bowl_colors)
    font_contract()
    rendered_contract(output)
    print("v2 icon contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
