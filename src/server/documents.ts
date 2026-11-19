import path from 'path';

export interface ParsedDocument { text: string; pages?: number; kind: 'pdf' | 'docx' | 'text' }

const MAX_CHARS = 60_000;

function clean(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, MAX_CHARS);
}

export async function parseDocument(buf: Buffer, fileName: string): Promise<ParsedDocument> {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === '.pdf' || buf.subarray(0, 4).toString() === '%PDF') {
    // Import the inner module: pdf-parse's index.js runs a debug routine on require()
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string; numpages: number }>;
    const out = await pdfParse(buf);
    return { text: clean(out.text), pages: out.numpages, kind: 'pdf' };
  }

  if (ext === '.docx' || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const mammoth = require('mammoth') as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };
    const out = await mammoth.extractRawText({ buffer: buf });
    return { text: clean(out.value), kind: 'docx' };
  }

  if (ext === '.doc') throw new Error('Legacy .doc is not supported — save as .docx or PDF');
  return { text: clean(buf.toString('utf8')), kind: 'text' };
}
