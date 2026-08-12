#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
IMAGES = ROOT.parent / "images"
SVG = "{http://www.w3.org/2000/svg}"
SOURCES = ("v3-foreground.svg", "v3-mono.svg", "v3-splash.svg", "v3-splash-dark.svg")
ASSETS = {
    "icon.png": (1024, False),
    "android-icon-background.png": (1024, False),
    "android-icon-foreground.png": (1024, True),
    "android-icon-monochrome.png": (1024, True),
    "splash-icon.png": (512, True),
    "splash-icon-dark.png": (512, True),
    "favicon.png": (96, False),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def wordmark(root: ET.Element) -> ET.Element:
    node = root.find(".//*[@id='wordmark']")
    if node is None:
        node = next(
            (item for item in root.findall(f".//{SVG}g") if item.get("aria-label") == "BACKSTAMP"),
            None,
        )
    require(node is not None, "BACKSTAMP wordmark missing")
    return node


def font_contract() -> None:
    bundled = ROOT / "fonts" / "VarelaRound-Regular.ttf"
    environment = os.environ | {"FONTCONFIG_FILE": str(ROOT / "fonts" / "fonts.conf")}
    matched = Path(
        subprocess.check_output(
            ["fc-match", "-f", "%{file}", "Varela Round"], env=environment, text=True
        ).strip()
    )
    require(bundled.is_file(), "bundled Varela Round font missing")
    require(matched.resolve() == bundled.resolve(), f"Fontconfig bypassed the bundled font: {matched}")
    require(hashlib.sha256(bundled.read_bytes()).digest() == hashlib.sha256(matched.read_bytes()).digest(),
            f"Fontconfig resolved unexpected Varela Round font: {matched}")
    match_details = subprocess.check_output(
        ["fc-match", "-v", "Varela Round:weight=900"], env=environment, text=True
    )
    require("embolden: True" in match_details, "v5 synthetic weight rule is missing")
    license_text = (ROOT / "fonts" / "OFL.txt").read_text()
    require("Varela Round Project Authors" in license_text, "Varela Round copyright missing")
    require("SIL OPEN FONT LICENSE Version 1.1" in license_text, "Varela Round OFL text missing")


def lettering_contract() -> None:
    reference = wordmark(ET.parse(ROOT / "v5-varela.svg").getroot())
    reference_letters = [
        (node.text, node.get("x"), node.get("y"), node.get("font-size"), node.get("data-angle"), node.get("transform"))
        for node in reference.findall(f"{SVG}text")
    ]
    require("".join(letter[0] or "" for letter in reference_letters) == "BACKSTAMP", "v5 wordmark changed")
    for source in SOURCES:
        mark = wordmark(ET.parse(ROOT / source).getroot())
        letters = [
            (node.text, node.get("x"), node.get("y"), node.get("font-size"), node.get("data-angle"), node.get("transform"))
            for node in mark.findall(f"{SVG}text")
        ]
        require(mark.get("font-family") == "Varela Round", f"{source}: wrong font family")
        require(mark.get("font-weight") == reference.get("font-weight"), f"{source}: wrong font weight")
        require(letters == reference_letters, f"{source}: lettering does not match v5-varela.svg")


def rendered_contract() -> None:
    background = IMAGES / "android-icon-background.png"
    background_before = hashlib.sha256(background.read_bytes()).digest()
    with tempfile.TemporaryDirectory() as work:
        subprocess.run([str(ROOT / "build-icons.sh")], cwd=work, check=True)
    require(hashlib.sha256(background.read_bytes()).digest() == background_before,
            "Android background changed during the production rebuild")

    for name, (size, transparent) in ASSETS.items():
        path = IMAGES / name
        dimensions, channels = subprocess.check_output(
            ["identify", "-format", "%wx%h;%[channels]", str(path)], text=True
        ).split(";")
        require(dimensions == f"{size}x{size}", f"{name}: wrong dimensions")
        require(("a" in channels.lower()) == transparent, f"{name}: wrong alpha channel")
        if transparent:
            alpha_min, alpha_max = subprocess.check_output(
                ["identify", "-format", "%[fx:minima.a],%[fx:maxima.a]", str(path)], text=True
            ).split(",")
            require(float(alpha_min) == 0 and float(alpha_max) == 1, f"{name}: transparency is not used")

    foreground = IMAGES / "android-icon-foreground.png"
    outside_safe_circle = subprocess.check_output(
        [
            "magick", str(foreground), "-alpha", "extract", "-fx",
            "hypot(i-(w-1)/2,j-(h-1)/2)>330?u:0", "-format", "%[fx:maxima]", "info:",
        ],
        text=True,
    )
    require(float(outside_safe_circle) == 0, "Android foreground exceeds the 660px safe circle")

    mono_error = subprocess.check_output(
        [
            "magick", str(IMAGES / "android-icon-monochrome.png"), "-fx",
            "a==0?0:max(max(abs(r-1),abs(g-1)),abs(b-1))", "-format", "%[fx:maxima]", "info:",
        ],
        text=True,
    )
    require(float(mono_error) == 0, "Android monochrome mark is not white on transparency")


def main() -> int:
    font_contract()
    lettering_contract()
    rendered_contract()
    print("production icon contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
