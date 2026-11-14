'use strict';
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); label.copy(out, 4); bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([label, bytes])), out.length - 4); return out;
}
// Browsers resize uploads to RGBA PNG. Validate the actual bytes and strip all
// metadata; filenames, claimed MIME types and SVG content are never trusted.
function normalizeLogo(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > 420000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) throw new Error('Choose a PNG, JPEG or WebP image using the logo upload button.');
  const encoded = dataURL.slice(22), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length < 57 || !bytes.subarray(0, 8).equals(signature)) throw new Error('Invalid logo image.');
  let at = 8, header, ended = false; const images = [];
  while (at < bytes.length) {
    if (at + 12 > bytes.length) throw new Error('Incomplete logo image.');
    const length = bytes.readUInt32BE(at), end = at + length + 12;
    if (end > bytes.length) throw new Error('Incomplete logo image.');
    const type = bytes.toString('ascii', at + 4, at + 8), content = bytes.subarray(at + 8, end - 4);
    if (crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('The logo image is damaged.');
    if (at === 8 && type !== 'IHDR') throw new Error('Invalid logo image.');
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('Invalid logo image.');
      header = Buffer.from(content);
      const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
      if (!width || !height || width > 256 || height > 256 || header[8] !== 8 || header[9] !== 6 || header[10] || header[11] || header[12]) throw new Error('The logo must be resized through the upload button.');
    } else if (type === 'IDAT') images.push(content);
    else if (type === 'IEND') { if (length || end !== bytes.length) throw new Error('Invalid logo image.'); ended = true; }
    else if (!/^[a-z][A-Za-z]{3}$/.test(type)) throw new Error('Unsupported logo image.');
    at = end;
  }
  if (!header || !ended || !images.length) throw new Error('Incomplete logo image.');
  const stride = header.readUInt32BE(0) * 4 + 1, size = stride * header.readUInt32BE(4);
  let pixels;
  try { pixels = zlib.inflateSync(Buffer.concat(images), {maxOutputLength: size}); } catch { throw new Error('Invalid logo pixel data.'); }
  if (pixels.length !== size) throw new Error('Invalid logo pixel data.');
  for (let offset = 0; offset < size; offset += stride) if (pixels[offset] > 4) throw new Error('Invalid logo pixel filter.');
  const png = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return {id: crypto.createHash('sha256').update(png).digest('hex'), data: png.toString('base64')};
}
module.exports = {normalizeLogo};
