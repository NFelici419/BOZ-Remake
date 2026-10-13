type Extras = Record<string, unknown>;

export type GltfPrimitive = {
  positions: Float32Array;
  uv0?: Float32Array;
  uv1?: Float32Array;
  colors?: Uint8Array; // RGBA8 per vertex
  indices: Uint16Array | Uint32Array;
  material: number;
};
export type GltfNode = {
  name: string;
  mesh: number;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  extras: Extras;
};

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const GREY = [0.5, 0.5, 0.5, 1];
const SAMPLER = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }; // linear, linear-mipmap-linear, repeat

const copy = (a: ArrayBufferView) => Buffer.from(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
/** glTF arrays must not be empty, so empty ones are left out. */
const nonEmpty = <T>(key: string, items: T[]) => (items.length ? { [key]: items } : {});

/**
 * Minimal glTF 2.0 builder: one external .bin buffer, one bufferView per
 * accessor (4-byte aligned), one texture per image. Attribute arrays passed
 * again as the same object reuse their accessor.
 */
export class GltfBuilder {
  private images: { uri: string; extras?: Extras }[] = [];
  private materials: object[] = [];
  private meshes: object[] = [];
  private nodes: GltfNode[] = [];
  private accessors: object[] = [];
  private bufferViews: object[] = [];
  private chunks: Buffer[] = [];
  private byteLength = 0;
  private attributeAccessors = new Map<ArrayBufferView, number>();

  /** Returns the existing index when the uri was added before. */
  addImage(uri: string, extras?: Extras): number {
    const found = this.images.findIndex((i) => i.uri === uri);
    if (found >= 0) return found;
    return this.images.push(extras ? { uri, extras } : { uri }) - 1;
  }

  /** The lightmap becomes an occlusion texture on TEXCOORD_1; no base image gives flat grey. */
  addMaterial(name: string, baseColorImage: number | null, lightmapImage: number | null, extras?: Extras, alphaMask = false): number {
    const pbr = baseColorImage === null ? { baseColorFactor: GREY } : { baseColorTexture: { index: baseColorImage } };
    return (
      this.materials.push({
        name,
        pbrMetallicRoughness: { ...pbr, metallicFactor: 0, roughnessFactor: 1 },
        ...(lightmapImage !== null && { occlusionTexture: { index: lightmapImage, texCoord: 1 } }),
        ...(alphaMask && { alphaMode: "MASK", alphaCutoff: 0.5 }),
        ...(extras && { extras }),
      }) - 1
    );
  }

  addMesh(name: string, primitives: GltfPrimitive[], extras?: Extras): number {
    const prims = primitives.map((p) => ({
      attributes: {
        POSITION: this.attribute(p.positions, "VEC3"),
        ...(p.uv0 && { TEXCOORD_0: this.attribute(p.uv0, "VEC2") }),
        ...(p.uv1 && { TEXCOORD_1: this.attribute(p.uv1, "VEC2") }),
        ...(p.colors && { COLOR_0: this.colorAttribute(p.colors) }),
      },
      indices: this.indexAccessor(p.indices),
      material: p.material,
      mode: TRIANGLES,
    }));
    return this.meshes.push({ name, primitives: prims, ...(extras && { extras }) }) - 1;
  }

  addNode(node: GltfNode): number {
    return this.nodes.push(node) - 1;
  }

  toFiles(baseName: string): { json: string; bin: Buffer } {
    const bin = Buffer.concat(this.chunks);
    const doc = {
      asset: { version: "2.0", generator: "boz-converter" },
      scene: 0,
      scenes: [{ ...nonEmpty("nodes", this.nodes.map((_, i) => i)) }],
      ...nonEmpty("nodes", this.nodes),
      ...nonEmpty("meshes", this.meshes),
      ...nonEmpty("materials", this.materials),
      ...nonEmpty("images", this.images),
      ...nonEmpty("textures", this.images.map((_, i) => ({ sampler: 0, source: i }))),
      ...nonEmpty("samplers", this.images.length ? [SAMPLER] : []),
      ...nonEmpty("accessors", this.accessors),
      ...nonEmpty("bufferViews", this.bufferViews),
      buffers: [{ uri: `${baseName}.bin`, byteLength: bin.length }],
    };
    return { json: JSON.stringify(doc), bin };
  }

  private view(data: Buffer, target: number): number {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    this.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: data.length, target });
    this.chunks.push(data);
    this.byteLength += data.length;
    return this.bufferViews.length - 1;
  }

  /** VEC3 attributes are positions and get the min/max glTF requires. */
  private attribute(a: Float32Array, type: "VEC2" | "VEC3"): number {
    const cached = this.attributeAccessors.get(a);
    if (cached !== undefined) return cached;
    const n = type === "VEC3" ? 3 : 2;
    const accessor: Record<string, unknown> = { bufferView: this.view(copy(a), ARRAY_BUFFER), componentType: FLOAT, count: a.length / n, type };
    if (type === "VEC3") {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < a.length; i++) {
        min[i % 3] = Math.min(min[i % 3], a[i]);
        max[i % 3] = Math.max(max[i % 3], a[i]);
      }
      Object.assign(accessor, { min, max });
    }
    const index = this.accessors.push(accessor) - 1;
    this.attributeAccessors.set(a, index);
    return index;
  }

  /** Normalized unsigned-byte RGBA, the compact glTF vertex colour form. */
  private colorAttribute(colors: Uint8Array): number {
    const cached = this.attributeAccessors.get(colors);
    if (cached !== undefined) return cached;
    const accessor = { bufferView: this.view(copy(colors), ARRAY_BUFFER), componentType: UNSIGNED_BYTE, normalized: true, count: colors.length / 4, type: "VEC4" };
    const index = this.accessors.push(accessor) - 1;
    this.attributeAccessors.set(colors, index);
    return index;
  }

  /** 16-bit indices unless an index needs 32 bits (65535 is reserved). */
  private indexAccessor(indices: Uint16Array | Uint32Array): number {
    let max = 0;
    for (const v of indices) if (v > max) max = v;
    const wide = max >= 0xffff;
    const data = wide ? Uint32Array.from(indices) : Uint16Array.from(indices);
    return (
      this.accessors.push({
        bufferView: this.view(copy(data), ELEMENT_ARRAY_BUFFER),
        componentType: wide ? UNSIGNED_INT : UNSIGNED_SHORT,
        count: indices.length,
        type: "SCALAR",
      }) - 1
    );
  }
}
