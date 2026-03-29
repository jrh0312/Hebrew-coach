#!/usr/bin/env python3
"""
create-icons.py — Generate placeholder PWA icons with zero dependencies.

Creates solid-colour PNG files in frontend/public/:
  icon-192.png       (192×192)
  icon-512.png       (512×512)
  apple-touch-icon.png (180×180)

All use the app's dark-navy background colour (#0d1117).
Replace these files with real artwork before publishing.

Run from the frontend/ directory:
    python3 create-icons.py
Or from the project root:
    python3 frontend/create-icons.py
"""

import os
import struct
import zlib
from pathlib import Path


def _solid_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    """
    Build a minimal valid PNG containing a solid-colour rectangle.
    Uses only the Python standard library (struct + zlib).
    """

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        crc  = zlib.crc32(body) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + body + struct.pack(">I", crc)

    # IHDR: width, height, bit-depth=8, colour-type=2 (RGB), compression=0, filter=0, interlace=0
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)

    # Raw image data: one filter byte (0 = None) followed by RGB pixels per row
    pixel  = bytes([r, g, b])
    row    = b"\x00" + pixel * width
    raw    = row * height
    idat_data = zlib.compress(raw, level=9)

    png = (
        b"\x89PNG\r\n\x1a\n"    # PNG signature
        + chunk(b"IHDR", ihdr_data)
        + chunk(b"IDAT", idat_data)
        + chunk(b"IEND", b"")
    )
    return png


def main() -> None:
    # Resolve output directory relative to this script's location
    script_dir = Path(__file__).parent
    public_dir = script_dir / "public"
    public_dir.mkdir(parents=True, exist_ok=True)

    # App background colour: #0d1117
    r, g, b = 0x0D, 0x11, 0x17

    icons = [
        ("icon-192.png",         192, 192),
        ("icon-512.png",         512, 512),
        ("apple-touch-icon.png", 180, 180),
    ]

    for filename, w, h in icons:
        path = public_dir / filename
        data = _solid_png(w, h, r, g, b)
        path.write_bytes(data)
        print(f"  ✓  {path}  ({w}×{h}px, {len(data):,} bytes)")

    print()
    print("Placeholder icons created in frontend/public/")
    print("Replace them with real artwork before shipping to production.")
    print("Recommended tool: https://www.pwabuilder.com/imageGenerator")


if __name__ == "__main__":
    main()
