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
const MAX_VIDEO_BYTES = 5 * 1024 * 1024;
function normalizeVideo(dataURL) {
  const invalid = message => { throw new Error(message || 'Invalid MP4 logo. Use an H.264 MP4 up to 5 MB and 60 seconds.'); };
  if (typeof dataURL !== 'string' || dataURL.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4 + 24 || !/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) invalid();
  const encoded = dataURL.slice(22), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length > MAX_VIDEO_BYTES) invalid();
  let boxCount = 0;
  function boxes(start, end) {
    const out = [];
    for (let at = start; at < end;) {
      if (++boxCount > 10000 || at + 8 > end) invalid();
      let size = bytes.readUInt32BE(at), header = 8;
      if (size === 1) {
        if (at + 16 > end) invalid();
        const large = bytes.readBigUInt64BE(at + 8); if (large > BigInt(MAX_VIDEO_BYTES)) invalid();
        size = Number(large); header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) invalid();
      out.push({type: bytes.toString('ascii', at + 4, at + 8), start: at + header, end: at + size}); at += size;
    }
    return out;
  }
  const child = (parent, name) => {
    const matches = boxes(parent.start, parent.end).filter(b => b.type === name);
    if (matches.length !== 1) invalid(); return matches[0];
  };
  const top = boxes(0, bytes.length), ftyp = top[0];
  if (ftyp?.type !== 'ftyp' || ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4 || !top.some(b => b.type === 'mdat' && b.end > b.start)) invalid();
  const brands = [bytes.toString('ascii', ftyp.start, ftyp.start + 4)];
  for (let at = ftyp.start + 8; at < ftyp.end; at += 4) brands.push(bytes.toString('ascii', at, at + 4));
  if (!brands.some(b => ['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(b))) invalid();
  const movie = child({start: 0, end: bytes.length}, 'moov'), mvhd = child(movie, 'mvhd');
  const version = bytes[mvhd.start], timeOffset = version === 0 ? 12 : version === 1 ? 20 : -1;
  if (timeOffset < 0 || mvhd.end - mvhd.start < timeOffset + (version ? 12 : 8)) invalid();
  const timescale = bytes.readUInt32BE(mvhd.start + timeOffset);
  const duration = version ? Number(bytes.readBigUInt64BE(mvhd.start + timeOffset + 4)) : bytes.readUInt32BE(mvhd.start + timeOffset + 4);
  if (!timescale || !duration || duration / timescale > 60) invalid('Video logos must be no longer than 60 seconds.');
  const tracks = boxes(movie.start, movie.end).filter(b => b.type === 'trak');
  let videos = 0;
  for (const track of tracks) {
    const media = child(track, 'mdia'), handler = child(media, 'hdlr');
    if (handler.end - handler.start < 12) invalid();
    const type = bytes.toString('ascii', handler.start + 8, handler.start + 12);
    if (!['vide', 'soun'].includes(type)) invalid('MP4 logos may contain only video and optional audio tracks.');
    const info = child(media, 'minf'), references = child(child(info, 'dinf'), 'dref');
    if (references.end - references.start < 8) invalid();
    const refs = boxes(references.start + 8, references.end);
    if (!refs.length || bytes.readUInt32BE(references.start + 4) !== refs.length) invalid();
    for (const ref of refs) if (ref.type !== 'url ' || ref.end - ref.start !== 4 || bytes.readUInt32BE(ref.start) !== 1) invalid('Video logos must be self-contained and cannot reference external files.');
    const description = child(child(info, 'stbl'), 'stsd');
    if (description.end - description.start < 8) invalid();
    const entries = boxes(description.start + 8, description.end);
    if (entries.length !== 1 || bytes.readUInt32BE(description.start + 4) !== 1) invalid();
    const entry = entries[0];
    if (entry.end - entry.start < 8 || bytes.readUInt16BE(entry.start + 6) !== 1) invalid();
    if (type === 'vide') {
      if (++videos > 1 || entry.type !== 'avc1' || entry.end - entry.start < 78) invalid('Use an H.264 MP4 video logo.');
      const width = bytes.readUInt16BE(entry.start + 24), height = bytes.readUInt16BE(entry.start + 26);
      if (!width || !height || width > 1920 || height > 1080) invalid('Video logo resolution must be at most 1920 x 1080.');
      if (entry.type === 'avc1') {
        const config = child({start: entry.start + 78, end: entry.end}, 'avcC');
        if (config.end - config.start < 7 || bytes[config.start] !== 1) invalid();
      }
    } else if (entry.type !== 'mp4a') invalid('Use MP4 with H.264 video and optional AAC audio.');
  }
  if (videos !== 1) invalid('The logo must contain one video track.');
  return {id: crypto.createHash('sha256').update(bytes).digest('hex'), data: encoded};
}
// Inspect bounded EBML metadata without decoding or rewriting the video. Alpha
// blocks and all uploaded bytes are retained exactly as supplied.
function normalizeWebm(dataURL) {
  const invalid = message => { throw new Error(message || 'Invalid WebM logo. Use VP8 or VP9 WebM up to 5 MB and 60 seconds.'); };
  if (typeof dataURL !== 'string' || dataURL.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4 + 24 || !/^data:video\/webm;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) invalid();
  const encoded = dataURL.slice(23), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.length > MAX_VIDEO_BYTES) invalid();
  let count = 0;
  function elements(start, end) {
    const out = [];
    for (let at = start; at < end;) {
      if (++count > 10000) invalid();
      let idLength = 1, marker = 128;
      while (idLength <= 4 && !(bytes[at] & marker)) { idLength++; marker >>= 1; }
      if (idLength > 4 || at + idLength >= end) invalid();
      const id = bytes.readUIntBE(at, idLength); at += idLength;
      let sizeLength = 1; marker = 128;
      while (sizeLength <= 8 && !(bytes[at] & marker)) { sizeLength++; marker >>= 1; }
      if (sizeLength > 8 || at + sizeLength > end) invalid();
      let size = BigInt(bytes[at] & (marker - 1));
      for (let i = 1; i < sizeLength; i++) size = (size << 8n) | BigInt(bytes[at + i]);
      at += sizeLength;
      const unknown = size === (1n << BigInt(sizeLength * 7)) - 1n;
      if (unknown && id !== 0x18538067 && id !== 0x1f43b675) invalid();
      if (!unknown && size > BigInt(end - at)) invalid();
      const last = unknown ? end : at + Number(size);
      out.push({id, start: at, end: last}); at = last;
    }
    return out;
  }
  const one = (list, id, required = true) => {
    const matches = list.filter(e => e.id === id);
    if (matches.length > 1 || (required && matches.length !== 1)) invalid();
    return matches[0];
  };
  const children = e => elements(e.start, e.end);
  const uint = e => {
    if (!e || e.end - e.start < 1 || e.end - e.start > 8) invalid();
    let value = 0n; for (let at = e.start; at < e.end; at++) value = (value << 8n) | BigInt(bytes[at]);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(); return Number(value);
  };
  const text = e => bytes.toString('utf8', e.start, e.end).replace(/\0+$/, '');
  const top = elements(0, bytes.length);
  if (top[0]?.id !== 0x1a45dfa3 || text(one(children(top[0]), 0x4282)) !== 'webm') invalid();
  const segment = children(one(top, 0x18538067)), info = children(one(segment, 0x1549a966));
  const scale = one(info, 0x2ad7b1, false), ticks = scale ? uint(scale) : 1000000;
  const duration = one(info, 0x4489, false);
  if (!duration || ![4, 8].includes(duration.end - duration.start)) invalid('Export a WebM with duration metadata (up to 60 seconds).');
  const value = duration.end - duration.start === 4 ? bytes.readFloatBE(duration.start) : bytes.readDoubleBE(duration.start);
  const seconds = value * ticks / 1e9;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) invalid('Video logos must be no longer than 60 seconds.');
  const tracks = children(one(segment, 0x1654ae6b)).filter(e => e.id === 0xae);
  let videos = 0;
  for (const track of tracks) {
    const fields = children(track), type = uint(one(fields, 0x83)), codec = text(one(fields, 0x86));
    if (one(fields, 0x6d80, false)) invalid('Encrypted or compressed WebM tracks are not supported.');
    if (type === 1) {
      if (++videos > 1 || !['V_VP8', 'V_VP9'].includes(codec)) invalid('Use VP8 or VP9 WebM video.');
      const video = children(one(fields, 0xe0)), width = uint(one(video, 0xb0)), height = uint(one(video, 0xba));
      if (!width || !height || width > 1920 || height > 1080) invalid('Video logo resolution must be at most 1920 x 1080.');
    } else if (type !== 2 || !['A_OPUS', 'A_VORBIS'].includes(codec)) invalid('WebM logos may contain video and optional Opus or Vorbis audio only.');
  }
  if (videos !== 1 || !segment.some(e => e.id === 0x1f43b675 && e.end > e.start)) invalid('The WebM must contain one video track and video data.');
  return {id: crypto.createHash('sha256').update(bytes).digest('hex'), data: encoded};
}
module.exports = {normalizeLogo, normalizeVideo, normalizeWebm, MAX_VIDEO_BYTES};
