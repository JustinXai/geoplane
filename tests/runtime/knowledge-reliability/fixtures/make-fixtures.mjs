/**
 * Deterministic generator for the REAL binary fixtures the KNOWLEDGE_INGESTION_RELIABILITY_V1
 * parser tests use. All fixtures are genuinely-valid documents (no stubs).
 *
 *   sample.pdf : a real, valid single-page PDF whose text is "Hello PDF". Sourced (copied
 *                verbatim) from the frozen-core fixture tests/runtime/knowledge/fixtures/sample.pdf
 *                (produced with reportlab; see that lane's make-fixtures.mjs header). unpdf's
 *                serverless pdf.js extracts "Hello PDF" from it under Node 22 (verified).
 *
 *   blank.pdf  : a real, valid single-page PDF with NO text operators -> unpdf extracts "".
 *                Built here from scratch with a correct xref table (fully reproducible in Node).
 *
 *   sample.docx: a minimal, valid OOXML wordprocessing document (a stored-method ZIP of the 3
 *                required parts) whose body text is "Hello DOCX from geoplane reliability".
 *                Built here from scratch - mammoth reads it. No external tools.
 *
 * Run:  node tests/runtime/knowledge-reliability/fixtures/make-fixtures.mjs
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// sample.pdf : copy the real reportlab PDF from the frozen-core knowledge lane.
// ---------------------------------------------------------------------------
const coreSamplePdf = join(here, "..", "..", "knowledge", "fixtures", "sample.pdf");
copyFileSync(coreSamplePdf, join(here, "sample.pdf"));

// ---------------------------------------------------------------------------
// blank.pdf : a valid single-page PDF with no text content (empty extraction).
// ---------------------------------------------------------------------------
function buildBlankPdf() {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  const trailer =
    `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1");
}
writeFileSync(join(here, "blank.pdf"), buildBlankPdf());

// ---------------------------------------------------------------------------
// sample.docx : minimal STORED (uncompressed) ZIP -> valid .docx that mammoth reads.
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
    local.writeUInt16LE(0, 8);
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
    <w:p><w:r><w:t>Hello DOCX from geoplane reliability</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const docx = makeZip([
  { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
  { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
  { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
]);
writeFileSync(join(here, "sample.docx"), docx);

console.log("wrote sample.pdf (copied), blank.pdf, sample.docx");
