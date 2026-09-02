# make_icons.py — generate placeholder app icons for the Android (PWA) build.
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".")
RGBA = (30, 120, 190, 255)  # brand blue

def make_png(size, color):
    raw = bytearray()
    for _ in range(size):
        raw.append(0)  # filter: none
        for _ in range(size):
            raw.extend(color)
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

os.makedirs(OUT, exist_ok=True)
for s in (192, 512):
    path = os.path.join(OUT, "icon%d.png" % s)
    with open(path, "wb") as f:
        f.write(make_png(s, RGBA))
    print("wrote", path, os.path.getsize(path), "bytes")
print("done")