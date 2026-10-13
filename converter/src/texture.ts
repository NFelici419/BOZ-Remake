import { FormatError } from "./bin-reader.ts";

export type Texture =
  | { kind: "image"; width: number; height: number; rgba: Buffer } // mip 0 decoded to RGBA8
  | { kind: "cubemap"; width: number; height: number; faces: Buffer[] } // 6 RGBA8 faces
  | { kind: "unsupported"; reason: string };

const DXT1 = 0x83f1;
const DXT3 = 0x83f2;
const FORMAT_RAW = 0x06;
const FORMAT_COMPRESSED = 0x2b;
const RAW_RGBA4444 = 5;
const HEADER = 31; // CIwTexture fields before the pixel payload
const GL_HEADER = 72; // tag, recordSize, glFormat, mipCount, width, height, mipSize[12]

const hex = (n: number) => `0x${n.toString(16)}`;

function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/**
 * Decodes S3TC DXT1 or DXT3 data to RGBA8. DXT1 uses 3 colours plus
 * transparent black when c0 <= c1; DXT3 colour blocks are always 4-colour and
 * carry an explicit 4-bit alpha block first. Edge blocks are clipped.
 */
export function decodeDxt(data: Buffer, width: number, height: number, format: 0x83f1 | 0x83f2): Buffer {
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const blockSize = format === DXT3 ? 16 : 8;
  if (data.length < bw * bh * blockSize) throw new FormatError(`DXT data needs ${bw * bh * blockSize} bytes, has ${data.length}`, 0);
  const out = Buffer.alloc(width * height * 4);
  const palette = new Uint8Array(16);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let p = (by * bw + bx) * blockSize;
      const alphaAt = p;
      if (format === DXT3) p += 8;
      const c0 = data.readUInt16LE(p);
      const c1 = data.readUInt16LE(p + 2);
      const indices = data.readUInt32LE(p + 4);
      const a = rgb565(c0);
      const b = rgb565(c1);
      const fourColour = format === DXT3 || c0 > c1;
      for (let k = 0; k < 3; k++) {
        palette[k] = a[k];
        palette[4 + k] = b[k];
        palette[8 + k] = fourColour ? Math.floor((2 * a[k] + b[k]) / 3) : Math.floor((a[k] + b[k]) / 2);
        palette[12 + k] = fourColour ? Math.floor((a[k] + 2 * b[k]) / 3) : 0;
      }
      palette[3] = palette[7] = palette[11] = 255;
      palette[15] = fourColour ? 255 : 0;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3);
        const y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const o = (y * width + x) * 4;
        const c = ((indices >>> (2 * i)) & 3) * 4;
        out[o] = palette[c];
        out[o + 1] = palette[c + 1];
        out[o + 2] = palette[c + 2];
        out[o + 3] = palette[c + 3];
        if (format === DXT3) out[o + 3] = ((data[alphaAt + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
      }
    }
  }
  return out;
}

function decodeRgba4444(res: Buffer, width: number, height: number, pitch: number): Buffer {
  if (pitch < width * 2) throw new FormatError(`pitch ${pitch} is narrower than ${width} 16-bit pixels`, 25);
  if (res.length !== HEADER + pitch * height + 1) throw new FormatError(`raw texture is ${res.length} bytes, expected ${HEADER + pitch * height + 1}`, 0);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = res.readUInt16LE(HEADER + y * pitch + x * 2);
      const o = (y * width + x) * 4;
      out[o] = (v >> 12) * 17;
      out[o + 1] = ((v >> 8) & 15) * 17;
      out[o + 2] = ((v >> 4) & 15) * 17;
      out[o + 3] = (v & 15) * 17;
    }
  }
  return out;
}

/**
 * Decodes one CIwTexture resource (including its size field). Format byte
 * @13 selects raw 16-bit (@18 = 5 is RGBA4444) or a GL record @31 holding a
 * DXT image, or a cubemap of 6 such records after the outer header.
 */
export function decodeTexture(res: Buffer): Texture {
  if (res.length < HEADER + 1) throw new FormatError(`texture is ${res.length} bytes, shorter than its header`, 0);
  const format = res[13];
  if (format === FORMAT_RAW) {
    if (res[18] !== RAW_RGBA4444) return { kind: "unsupported", reason: `raw pixel format ${hex(res[18])}` };
    const width = res.readUInt16LE(21);
    const height = res.readUInt16LE(23);
    return { kind: "image", width, height, rgba: decodeRgba4444(res, width, height, res.readUInt16LE(25)) };
  }
  if (format !== FORMAT_COMPRESSED) return { kind: "unsupported", reason: `format byte ${hex(format)}` };

  const recordSize = res.readUInt32LE(27);
  if (res.length !== HEADER + recordSize + 1) throw new FormatError(`texture is ${res.length} bytes, record says ${recordSize}`, 27);
  const gl = res.subarray(HEADER, HEADER + recordSize);
  const glFormat = gl.readUInt32LE(8);
  if (glFormat !== DXT1 && glFormat !== DXT3) return { kind: "unsupported", reason: `glFormat ${hex(glFormat)}` };
  const mipCount = gl.readUInt32LE(12);
  if (mipCount < 1 || mipCount > 12) throw new FormatError(`mip count ${mipCount}`, HEADER + 12);
  const width = gl.readUInt32LE(16);
  const height = gl.readUInt32LE(20);
  let data = 0;
  for (let m = 0; m < mipCount; m++) data += gl.readUInt32LE(24 + 4 * m);
  const mip0 = gl.readUInt32LE(24);

  if (gl.readUInt32LE(4) === GL_HEADER + data && recordSize === GL_HEADER + data) {
    return { kind: "image", width, height, rgba: decodeDxt(gl.subarray(GL_HEADER, GL_HEADER + mip0), width, height, glFormat) };
  }
  const face = GL_HEADER + data;
  if (recordSize === GL_HEADER + 6 * face) {
    const faces: Buffer[] = [];
    for (let f = 0; f < 6; f++) {
      const at = GL_HEADER + f * face;
      if (gl.readUInt32LE(at + 4) !== face) throw new FormatError(`cubemap face ${f} record size ${gl.readUInt32LE(at + 4)}, expected ${face}`, HEADER + at + 4);
      faces.push(decodeDxt(gl.subarray(at + GL_HEADER, at + GL_HEADER + mip0), width, height, glFormat));
    }
    return { kind: "cubemap", width, height, faces };
  }
  throw new FormatError(`GL record size ${recordSize} matches neither an image (${GL_HEADER + data}) nor a cubemap (${GL_HEADER + 6 * face})`, HEADER + 4);
}
