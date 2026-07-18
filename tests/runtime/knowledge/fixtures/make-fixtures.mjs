/**
 * Deterministic generator for the tiny REAL binary fixtures the ingestion parser tests use.
 *
 *   sample.docx : built here from scratch as a minimal, valid OOXML wordprocessing document
 *                 (a stored-method ZIP of the 3 required parts). mammoth reads it and extracts
 *                 "Hello DOCX from geoplane". Fully reproducible in Node - no external tools.
 *
 *   sample.pdf  : a minimal, genuinely-valid PDF (single page, text "Hello PDF"). It is a real
 *                 PDF committed as a binary fixture. It was produced with reportlab:
 *                     python -c "from reportlab.pdfgen import canvas; \
 *                       c=canvas.Canvas('sample.pdf'); c.setFont('Helvetica',24); \
 *                       c.drawString(72,700,'Hello PDF'); c.showPage(); c.save()"
 *                 NOTE: pdf-parse@1.1.4 (bundled pdf.js 1.10.100) throws "bad XRef entry" on
 *                 every valid PDF under Node 22 in this environment (verified against this real
 *                 reportlab PDF, whose xref offsets are correct). The PDF PARSER is therefore
 *                 exercised via the injected-extractor seam, plus a runtime-probed skipIf test
 *                 that runs real pdf-parse when the environment can. See ingestion.test.ts.
 *
 * Run:  node tests/runtime/knowledge/fixtures/make-fixtures.mjs   (regenerates sample.docx)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal STORED (uncompressed) ZIP writer -> valid .docx
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ name, data:Buffer }] -> a Buffer of a valid stored-method zip. */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(locals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, end]);
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello DOCX from geoplane</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const docx = makeZip([
  { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
  { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
  { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
]);
writeFileSync(join(here, "sample.docx"), docx);

console.log("wrote sample.docx (sample.pdf is a committed reportlab binary; see header)");
