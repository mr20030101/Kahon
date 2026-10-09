import { describe, expect, it } from 'vitest';
import { cleanFileName, fitWithin, matchesSignature } from '../uploads';

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('matchesSignature', () => {
  it('accepts files whose bytes match their extension', () => {
    expect(matchesSignature(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]), 'png')).toBe(true);
    expect(matchesSignature(bytes([0xff, 0xd8, 0xff, 0xe0]), 'jpg')).toBe(true);
    expect(matchesSignature(bytes('RIFF', [0, 0, 0, 0], 'WEBP'), 'webp')).toBe(true);
    expect(matchesSignature(bytes('GIF89a'), 'gif')).toBe(true);
    expect(matchesSignature(bytes('%PDF-1.7'), 'pdf')).toBe(true);
    expect(matchesSignature(bytes([0x50, 0x4b, 0x03, 0x04]), 'docx')).toBe(true);
    expect(matchesSignature(bytes('name,email\n'), 'csv')).toBe(true);
  });

  it('rejects renamed or disguised files', () => {
    expect(matchesSignature(bytes('<html><script>'), 'png')).toBe(false);
    expect(matchesSignature(bytes([0x4d, 0x5a, 0x90, 0x00]), 'pdf')).toBe(false); // a Windows .exe
    expect(matchesSignature(bytes('PK', [0, 0]), 'docx')).toBe(false);
    expect(matchesSignature(bytes('abc', [0], 'def'), 'txt')).toBe(false);
    expect(matchesSignature(bytes('anything'), 'exe')).toBe(false);
  });
});

describe('cleanFileName', () => {
  it('keeps ordinary names and sets the extension', () => {
    expect(cleanFileName('Site plan v2.jpeg', 'webp')).toBe('Site plan v2.webp');
    expect(cleanFileName('report.pdf', 'pdf')).toBe('report.pdf');
  });

  it('removes path parts, control and bidi characters', () => {
    expect(cleanFileName('../../etc/passwd', 'txt')).toBe('etcpasswd.txt');
    expect(cleanFileName('photo‮gnp.exe', 'png')).toBe('photognp.png');
    expect(cleanFileName('a\u0000b\nc.png', 'png')).toBe('abc.png');
  });

  it('falls back to "file" when nothing usable is left', () => {
    expect(cleanFileName('...', 'png')).toBe('file.png');
    expect(cleanFileName('', 'pdf')).toBe('file.pdf');
  });
});

describe('fitWithin', () => {
  it('shrinks the longest side to the limit, keeping the shape', () => {
    expect(fitWithin(6400, 4800, 3200)).toEqual({ width: 3200, height: 2400 });
    expect(fitWithin(1000, 8000, 3200)).toEqual({ width: 400, height: 3200 });
  });

  it('never enlarges small images', () => {
    expect(fitWithin(800, 600, 3200)).toEqual({ width: 800, height: 600 });
  });
});
