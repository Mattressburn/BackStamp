#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SVG = "{http://www.w3.org/2000/svg}"
VARIANTS = {
    "v3-cream-flowers": ("v2-cream-flowers", "#D8C9A6"),
    "v3-avocado-flowers": ("v2-avocado-flowers", "#3D4415"),
    "v3-banner": ("v2-banner", "#D8C9A6"),
}
BOWLS = (
    ("bowl-smallest", "#8A4B23"),
    ("bowl-medium", "#6E7A22"),
    ("bowl-large", "#D9A521"),
    ("bowl-largest", "#B0472A"),
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def fingerprint(node: ET.Element) -> tuple:
    return (
        node.tag,
        tuple(sorted(node.attrib.items())),
        (node.text or "").strip(),
        tuple(fingerprint(child) for child in node),
    )


def frame(root: ET.Element) -> tuple:
    children = list(root)
    background = next(node for node in children if node.tag == f"{SVG}rect")
    flowers = next(node for node in children if "dais" in node.get("aria-label", "").lower())
    rings = tuple(node for node in children if node.tag == f"{SVG}g" and node.findall(f"{SVG}circle"))
    wordmark = root.find(".//*[@id='wordmark']")
    banner = tuple(node for node in children if node.tag == f"{SVG}rect" and node is not background)
    require(wordmark is not None, "wordmark missing")
    return tuple(map(fingerprint, (background, flowers, *rings, *banner, wordmark)))


def svg_contract(name: str, v2_name: str, shadow_color: str) -> None:
    path = ROOT / f"{name}.svg"
    root = ET.parse(path).getroot()
    require(root.get("width") == "1024" and root.get("height") == "1024", f"{name}: wrong canvas")
    require(root.get("viewBox") == "0 0 1024 1024", f"{name}: wrong viewBox")
    require(frame(root) == frame(ET.parse(ROOT / f"{v2_name}.svg").getroot()), f"{name}: v2 frame changed")
    for forbidden in ("linearGradient", "radialGradient", "filter", "image"):
        require(not root.findall(f".//{SVG}{forbidden}"), f"{name}: forbidden {forbidden}")

    group = next(node for node in root.findall(f".//{SVG}g") if node.get("aria-label") == "Four plain round nesting bowls")
    for bowl_id, color in BOWLS:
        bowl = root.find(f".//*[@id='{bowl_id}']")
        require(bowl is not None and bowl.get("fill") == color, f"{name}: wrong {bowl_id} color")
        require(bowl.get("stroke") is None, f"{name}: bowl shading or outline found")
    rims = [node for node in group.findall(f"{SVG}use") if node.get("href", "").startswith("#rim-")]
    require(len(rims) == 4 and all(node.get("fill") == "#F1E7D3" for node in rims), f"{name}: four cream rims required")
    shadow = group.find(f"{SVG}g")
    require(shadow is not None and shadow.get("fill") == shadow_color, f"{name}: wrong ground shadow")
    require(shadow.get("transform") == "translate(0 18)", f"{name}: shadow must be a solid offset")
    require(len(shadow.findall(f"{SVG}use")) == 4, f"{name}: shadow must cover the whole nest")


def rendered_contract(output: Path) -> None:
    subprocess.run([str(ROOT / "build-icons.sh"), str(output)], check=True)
    for name in VARIANTS:
        for size in (1024, 180, 60):
            png = output / f"{name}-{size}.png"
            dimensions, channels = subprocess.check_output(
                ["identify", "-format", "%wx%h;%[channels]", str(png)], text=True
            ).split(";")
            require(dimensions == f"{size}x{size}", f"{png.name}: wrong dimensions")
            require("a" not in channels.lower(), f"{png.name}: output is not opaque")
        histogram = subprocess.check_output(
            ["magick", str(output / f"{name}-60.png"), "-format", "%c", "histogram:info:-"],
            text=True,
        ).upper()
        for _, color in BOWLS:
            require(color in histogram, f"{name}-60.png: {color} disappeared at 60 pixels")


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/backstamp-icon-v3-check")
    for name, (v2_name, shadow_color) in VARIANTS.items():
        svg_contract(name, v2_name, shadow_color)
    require(not any("PYREX" in path.read_text() for path in ROOT.glob("v3-*.svg")), "PYREX is forbidden")
    rendered_contract(output)
    print("v3 icon contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
