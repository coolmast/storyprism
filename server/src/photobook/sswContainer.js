import { open } from "node:fs/promises";
import { crc32 } from "node:zlib";

// Writer for Saal Design Software project containers (.sswprm / .sswpm).
//
// The format is a plain ZIP64 archive with every entry STORED (no
// compression) and the "PK" magic replaced by "SW" in three record types:
// local file headers (SW 03 04), central directory headers (SW 01 02) and
// the ZIP64 end-of-central-directory record (SW 06 06). The ZIP64 locator
// and the classic end record keep "PK". Every size field uses the ZIP64
// extra field (sizes in the fixed headers are 0xFFFFFFFF), version 4.5.
// A Python port of this writer reproduced a Saal-written project byte for
// byte, and files written this way import into the real software.
//
// Entries are streamed to disk one by one; only the central directory is
// kept in memory.

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export async function createSswWriter(path) {
  const fh = await open(path, "w");
  let offset = 0;
  const central = [];
  const { time, day } = dosDateTime();

  async function write(buf) {
    await fh.write(buf, 0, buf.length, offset);
    offset += buf.length;
  }

  return {
    async add(name, data) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
      const nameBuf = Buffer.from(name, "utf8");
      const crc = crc32(buf) >>> 0;
      const localOffset = offset;

      const header = Buffer.alloc(30);
      header.write("SW", 0, "latin1");
      header.writeUInt16LE(0x0403, 2);
      header.writeUInt16LE(45, 4); // version needed
      header.writeUInt16LE(0, 6); // flags
      header.writeUInt16LE(0, 8); // method: stored
      header.writeUInt16LE(time, 10);
      header.writeUInt16LE(day, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(0xffffffff, 18);
      header.writeUInt32LE(0xffffffff, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(20, 28);
      const extra = Buffer.alloc(20);
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(buf.length), 4);
      extra.writeBigUInt64LE(BigInt(buf.length), 12);
      await write(Buffer.concat([header, nameBuf, extra]));
      await write(buf);
      central.push({ nameBuf, crc, size: buf.length, localOffset });
    },

    async close() {
      const cdStart = offset;
      for (const e of central) {
        const h = Buffer.alloc(46);
        h.write("SW", 0, "latin1");
        h.writeUInt16LE(0x0201, 2);
        h.writeUInt16LE(45, 4); // made by
        h.writeUInt16LE(45, 6); // needed
        h.writeUInt16LE(0, 8);
        h.writeUInt16LE(0, 10);
        h.writeUInt16LE(time, 12);
        h.writeUInt16LE(day, 14);
        h.writeUInt32LE(e.crc, 16);
        h.writeUInt32LE(0xffffffff, 20);
        h.writeUInt32LE(0xffffffff, 24);
        h.writeUInt16LE(e.nameBuf.length, 28);
        h.writeUInt16LE(32, 30); // extra length
        h.writeUInt16LE(0, 32); // comment
        h.writeUInt16LE(0, 34); // disk
        h.writeUInt16LE(0, 36); // internal attrs
        h.writeUInt32LE(128, 38); // external attrs
        h.writeUInt32LE(0xffffffff, 42);
        const x = Buffer.alloc(32);
        x.writeUInt16LE(1, 0);
        x.writeUInt16LE(28, 2);
        x.writeBigUInt64LE(BigInt(e.size), 4);
        x.writeBigUInt64LE(BigInt(e.size), 12);
        x.writeBigUInt64LE(BigInt(e.localOffset), 20);
        x.writeUInt32LE(0, 28);
        await write(Buffer.concat([h, e.nameBuf, x]));
      }
      const cdSize = offset - cdStart;
      const z64Offset = offset;

      const z64 = Buffer.alloc(56);
      z64.write("SW", 0, "latin1");
      z64.writeUInt16LE(0x0606, 2);
      z64.writeBigUInt64LE(44n, 4);
      z64.writeUInt16LE(45, 12);
      z64.writeUInt16LE(45, 14);
      z64.writeUInt32LE(0, 16);
      z64.writeUInt32LE(0, 20);
      z64.writeBigUInt64LE(BigInt(central.length), 24);
      z64.writeBigUInt64LE(BigInt(central.length), 32);
      z64.writeBigUInt64LE(BigInt(cdSize), 40);
      z64.writeBigUInt64LE(BigInt(cdStart), 48);

      const loc = Buffer.alloc(20);
      loc.write("PK", 0, "latin1");
      loc.writeUInt16LE(0x0706, 2);
      loc.writeUInt32LE(0, 4);
      loc.writeBigUInt64LE(BigInt(z64Offset), 8);
      loc.writeUInt32LE(0, 16);

      const eocd = Buffer.alloc(22);
      eocd.write("PK", 0, "latin1");
      eocd.writeUInt16LE(0x0605, 2);
      eocd.writeUInt16LE(0, 4);
      eocd.writeUInt16LE(0, 6);
      eocd.writeUInt16LE(0xffff, 8);
      eocd.writeUInt16LE(0xffff, 10);
      eocd.writeUInt32LE(cdSize, 12);
      eocd.writeUInt32LE(cdStart, 16);
      eocd.writeUInt16LE(0, 20);

      await write(Buffer.concat([z64, loc, eocd]));
      await fh.close();
      return offset;
    },
  };
}
