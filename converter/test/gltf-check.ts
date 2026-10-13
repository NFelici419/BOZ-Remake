import assert from "node:assert/strict";

type Doc = Record<string, any>;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };

/** Structural glTF 2.0 checks the converter relies on (no external validator is a dependency). */
export function assertValidGltf(doc: Doc, bin: Buffer): void {
  assert.equal(doc.asset?.version, "2.0");
  assert.equal(doc.buffers.length, 1);
  assert.equal(doc.buffers[0].byteLength, bin.length);
  for (const v of doc.bufferViews ?? []) {
    assert.equal(v.byteOffset % 4, 0, "bufferView 4-byte aligned");
    assert.ok(v.byteOffset + v.byteLength <= bin.length, "bufferView inside buffer");
  }
  const read = (a: Doc, i: number) => {
    const v = doc.bufferViews[a.bufferView];
    const at = v.byteOffset + (a.byteOffset ?? 0) + i * BYTES[a.componentType];
    return a.componentType === 5123 ? bin.readUInt16LE(at) : a.componentType === 5125 ? bin.readUInt32LE(at) : bin.readFloatLE(at);
  };
  for (const a of doc.accessors ?? []) {
    assert.ok(a.count >= 1, "accessor count >= 1");
    assert.ok(a.componentType in BYTES, `componentType ${a.componentType}`);
    const v = doc.bufferViews[a.bufferView];
    assert.ok((a.byteOffset ?? 0) + a.count * COMPONENTS[a.type] * BYTES[a.componentType] <= v.byteLength, "accessor inside bufferView");
  }
  const textureCount = doc.textures?.length ?? 0;
  for (const t of doc.textures ?? []) assert.ok(t.source < doc.images.length && t.sampler < doc.samplers.length);
  for (const mesh of doc.meshes ?? []) {
    for (const p of mesh.primitives) {
      const pos = doc.accessors[p.attributes.POSITION];
      assert.equal(pos.type, "VEC3");
      assert.equal(pos.min?.length, 3, "POSITION min");
      assert.equal(pos.max?.length, 3, "POSITION max");
      for (const uv of ["TEXCOORD_0", "TEXCOORD_1", "COLOR_0"]) if (uv in p.attributes) assert.equal(doc.accessors[p.attributes[uv]].count, pos.count);
      const idx = doc.accessors[p.indices];
      assert.ok(idx.componentType === 5123 || idx.componentType === 5125);
      assert.equal(idx.count % 3, 0, "triangle list");
      for (let i = 0; i < idx.count; i++) assert.ok(read(idx, i) < pos.count, "index < vertex count");
      const m = doc.materials[p.material];
      assert.ok(m, "primitive material exists");
      const base = m.pbrMetallicRoughness?.baseColorTexture;
      if (base) assert.ok(base.index < textureCount && `TEXCOORD_${base.texCoord ?? 0}` in p.attributes);
      if (m.occlusionTexture) assert.ok(m.occlusionTexture.index < textureCount && `TEXCOORD_${m.occlusionTexture.texCoord ?? 0}` in p.attributes);
    }
  }
  for (const n of doc.nodes ?? []) assert.ok(n.mesh < doc.meshes.length);
  for (const n of doc.scenes[doc.scene].nodes ?? []) assert.ok(n < doc.nodes.length);
}
