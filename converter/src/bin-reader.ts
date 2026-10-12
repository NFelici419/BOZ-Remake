/** A structural problem in an input file, located at a byte offset. */
export class FormatError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} @0x${offset.toString(16)}`);
    this.name = "FormatError";
    this.offset = offset;
  }
}

/** Bounds-checked little-endian cursor over a Buffer. */
export class BinReader {
  readonly buf: Buffer;
  pos: number;

  constructor(buf: Buffer, offset = 0) {
    this.buf = buf;
    this.pos = offset;
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new FormatError(`need ${n} bytes, ${this.remaining()} left`, this.pos);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  /** Latin-1 string up to (and consuming) the next NUL. */
  cstring(): string {
    const end = this.buf.indexOf(0, this.pos);
    if (end < 0) throw new FormatError("unterminated string", this.pos);
    const s = this.buf.toString("latin1", this.pos, end);
    this.pos = end + 1;
    return s;
  }

  bytes(n: number): Buffer {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}
