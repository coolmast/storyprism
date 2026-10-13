#!/usr/bin/env python3
"""Extract the OpenType fonts Saal Design Software renders text with.

Saal ships each font as an LZMA-compressed Flash SWF ("ZWS" header, *.sswa)
holding DefineFont4 tags with embedded CFF OpenType data - one per style.
This pulls them out as plain .otf files (regular/bold/italic/bolditalic) so
Storyprism can size text with Saal's exact glyph widths and show the
identical fonts in its live preview.

The fonts are licensed with Saal's software: extract them from your own
installation, keep them local (the output folder is git-ignored).

Usage: python3 tools/extract_saal_fonts.py <Saal fonts/files dir> [out dir]
  macOS: ~/Library/Application Support/SaalDesignSoftware/Local Store/fonts/files
"""
import json
import lzma
import os
import struct
import sys


def swf_body(data):
    sig = data[:3]
    if sig == b"FWS":
        return data[8:]
    if sig == b"CWS":
        import zlib
        return zlib.decompress(data[8:])
    if sig == b"ZWS":
        ulen = struct.unpack("<I", data[4:8])[0]
        props = data[12:17]
        dec = lzma.LZMADecompressor(
            format=lzma.FORMAT_RAW,
            filters=[{
                "id": lzma.FILTER_LZMA1,
                "dict_size": struct.unpack("<I", props[1:5])[0],
                "lc": props[0] % 9,
                "lp": (props[0] // 9) % 5,
                "pb": props[0] // 45,
            }],
        )
        return dec.decompress(data[17:], max_length=ulen - 8)
    raise ValueError("not a SWF file")


def tags(body):
    nbits = body[0] >> 3
    p = (5 + 4 * nbits + 7) // 8 + 4  # RECT + frame rate + frame count
    while p < len(body):
        code_len = struct.unpack("<H", body[p:p + 2])[0]
        p += 2
        code, length = code_len >> 6, code_len & 0x3F
        if length == 0x3F:
            length = struct.unpack("<I", body[p:p + 4])[0]
            p += 4
        yield code, body[p:p + length]
        p += length
        if code == 0:
            break


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = os.path.expanduser(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "server", "data", "saal-fonts")
    os.makedirs(out, exist_ok=True)
    count = 0
    index = []
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".sswa"):
            continue
        with open(os.path.join(src, fn), "rb") as fh:
            body = swf_body(fh.read())
        for code, data in tags(body):
            if code != 91:  # DefineFont4
                continue
            flags = data[2]
            if not flags & 0x04:  # FontFlagsHasFontData
                continue
            end = data.index(b"\0", 3)
            family = data[3:end].decode("utf-8", "replace")  # name Saal uses in TLF
            style = ("Bold" if flags & 0x01 else "") + ("Italic" if flags & 0x02 else "") or "Regular"
            file = f"{fn[:-5]}-{style}.otf"
            with open(os.path.join(out, file), "wb") as fh:
                fh.write(data[end + 1:])
            index.append({"key": fn[:-5], "family": family, "style": style, "file": file})
            count += 1
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, indent=1)
    print(f"extracted {count} fonts to {os.path.abspath(out)}")


if __name__ == "__main__":
    main()
