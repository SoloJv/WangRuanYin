# make_icons.py - generate simple solid-color placeholder PNG icons for
# the Wangruanyin Safari build. These are dev placeholders; replace them with
# your own artwork before store submission.
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".")
# brand colour (bluish) with full alpha
RGBA = (30, 120, 190, 255)

def make_png(size, rgba):
    # colour type 6 = RGBA, bit depth 8
    raw = bytearray()
    for _ in range(size):
        raw.append(0)  # filter: none
        for _ in range(size):
            raw.extend(rgba)
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        sig
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )

for s in (16, 32, 48, 128):
    path = os.path.join(OUT, "icon%d.png" % s)
    with open(path, "wb") as f:
        f.write(make_png(s, RGBA))
    print("wrote", path, os.path.getsize(path), "bytes")
print("done")