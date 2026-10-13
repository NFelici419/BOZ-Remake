import fs from "node:fs";
import path from "node:path";
import { classHash } from "./class-names.ts";
import { readDzIndex, readGroups } from "./dz.ts";
import { entityTransform, parseEntitySpec, type Transform } from "./entity.ts";
import { GltfBuilder, type GltfNode } from "./gltf.ts";
import { decodeMaterial, type Material } from "./material.ts";
import { decodeModel, type Model } from "./model.ts";
import { encodePng } from "./png.ts";
import { listResources, resourceBytes, type ResourceRef } from "./resources.ts";
import { isKinoEntry } from "./selection.ts";
import { decodeTexture } from "./texture.ts";

/** Game units to metres. Provisional: confirmed by eye in milestone 2b. */
export const POSITION_SCALE = 0.01;
/** Reflect the map across X (handedness). Provisional: confirmed by eye in milestone 2b. */
export const MIRROR_X = false;

const ROOM_DIR = "levels/kino/";
/** Kino groups whose models are not static room geometry. */
const NOT_ROOMS = new Set(["kino_dynamics", "kino_skyboxes_shared", "effects_shared"]);
const MODEL = classHash("CIwModel");
const MATERIAL = classHash("CIwMaterial");
const TEXTURE = classHash("CIwTexture");
const ENTITY = classHash("CIsEntitySpec");

export type ExportStats = {
  models: number; // static room models found
  placed: number; // exported as nodes
  unplaced: string[]; // models with no entity placing them
  textures: number; // PNGs written
  unsupportedTextures: number;
  missingMaterials: number; // distinct material hashes with no usable material
  missingTextures: number; // distinct materials with no usable base texture
  failed: string[]; // resources that failed to decode, with the error
};

type Group = { path: string; base: string; data: Buffer; refs: ResourceRef[] };
type Located = { group: Group; ref: ResourceRef };

const hex = (n: number) => `0x${n.toString(16)}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function nodePlacement(t: Transform, scale = POSITION_SCALE, mirrorX = MIRROR_X): Pick<GltfNode, "translation" | "rotation" | "scale"> {
  const [x, y, z] = t.position;
  const [qx, qy, qz, qw] = t.rotation;
  // Reflecting across X maps rotation q to (qx, -qy, -qz, qw) and flips the X scale.
  return mirrorX
    ? { translation: [-x * scale, y * scale, z * scale], rotation: [qx, -qy, -qz, qw], scale: [-scale, scale, scale] }
    : { translation: [x * scale, y * scale, z * scale], rotation: [qx, qy, qz, qw], scale: [scale, scale, scale] };
}

function loadGroups(dzPath: string, failed: string[]): Group[] {
  const entries = readDzIndex(dzPath).entries.filter((e) => isKinoEntry(e) && e.name.endsWith(".group.bin"));
  const fd = fs.openSync(dzPath, "r");
  const groups: Group[] = [];
  try {
    for (const { entry, data } of readGroups(fd, entries)) {
      try {
        if (data instanceof Error) throw data;
        groups.push({ path: entry.path, base: path.basename(entry.path, ".group.bin"), data, refs: listResources(data) });
      } catch (e) {
        failed.push(`${entry.path}: ${message(e)}`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return groups.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Writes `outDir/kino/kino.gltf`, `kino.bin` and `textures/*.png`: one node per
 * static Kino room model that an entity places. A resource that fails to
 * decode is recorded in `failed` and skipped; unknown materials and unusable
 * textures become flat grey.
 */
export function exportKino(dzPath: string, outDir: string): ExportStats {
  const stats: ExportStats = { models: 0, placed: 0, unplaced: [], textures: 0, unsupportedTextures: 0, missingMaterials: 0, missingTextures: 0, failed: [] };
  const groups = loadGroups(dzPath, stats.failed);
  const out = path.join(outDir, "kino");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "textures"), { recursive: true });

  // First resource wins when a name hash occurs more than once (groups are in path order).
  const materials = new Map<number, Located>();
  const textures = new Map<number, Located>();
  const entities = new Map<number, Located & { transform: Transform }>();
  for (const group of groups) {
    for (const ref of group.refs) {
      if (ref.classHash === MATERIAL && !materials.has(ref.nameHash)) materials.set(ref.nameHash, { group, ref });
      if (ref.classHash === TEXTURE && !textures.has(ref.nameHash)) textures.set(ref.nameHash, { group, ref });
      if (ref.classHash === ENTITY && group.path.startsWith(ROOM_DIR) && !entities.has(ref.nameHash)) {
        try {
          const transform = entityTransform(parseEntitySpec(resourceBytes(group.data, ref)));
          if (transform) entities.set(ref.nameHash, { group, ref, transform });
        } catch (e) {
          stats.failed.push(`${group.base} CIsEntitySpec#${ref.index}: ${message(e)}`);
        }
      }
    }
  }

  const gltf = new GltfBuilder();
  const images = new Map<number, number | null>();
  const image = (hash: number): number | null => {
    if (images.has(hash)) return images.get(hash)!;
    let index: number | null = null;
    const loc = textures.get(hash);
    if (loc) {
      try {
        const t = decodeTexture(resourceBytes(loc.group.data, loc.ref));
        if (t.kind === "image") {
          const file = `${loc.group.base}_${loc.ref.index}.png`;
          fs.writeFileSync(path.join(out, "textures", file), encodePng(t.width, t.height, t.rgba));
          index = gltf.addImage(`textures/${file}`, { source: loc.group.path, resource: `CIwTexture#${loc.ref.index}` });
          stats.textures++;
        } else {
          stats.unsupportedTextures++; // cubemaps are not room textures in 2a
        }
      } catch (e) {
        stats.failed.push(`${loc.group.base} CIwTexture#${loc.ref.index}: ${message(e)}`);
      }
    }
    images.set(hash, index);
    return index;
  };

  const decoded = new Map<number, Material | null>();
  const gltfMaterials = new Map<string, number>();
  const noBaseTexture = new Set<number>();
  const missing = new Set<number>();
  const material = (hash: number, hasUv0: boolean, hasUv1: boolean): number => {
    const loc = materials.get(hash);
    if (loc && !decoded.has(hash)) {
      try {
        decoded.set(hash, decodeMaterial(resourceBytes(loc.group.data, loc.ref)));
      } catch (e) {
        decoded.set(hash, null);
        stats.failed.push(`${loc.group.base} CIwMaterial#${loc.ref.index}: ${message(e)}`);
      }
    }
    const mat = decoded.get(hash);
    if (!loc || !mat) {
      const name = `missing:${hex(hash)}`;
      missing.add(hash);
      if (!gltfMaterials.has(name)) gltfMaterials.set(name, gltf.addMaterial(name, null, null));
      return gltfMaterials.get(name)!;
    }
    const base = mat.texture0 === null ? null : image(mat.texture0);
    if (base === null) noBaseTexture.add(hash);
    // A texture slot needs its UV set on the primitive, so models without one get a variant.
    const useBase = hasUv0 ? base : null;
    const lightmap = hasUv1 && mat.texture1 !== null ? image(mat.texture1) : null;
    const key = `${hash}|${useBase}|${lightmap}`;
    if (!gltfMaterials.has(key)) {
      const dropped = (base !== null && useBase === null) || (mat.texture1 !== null && !hasUv1);
      const name = `mat:${loc.group.base}#${loc.ref.index}${dropped ? " (no uv)" : ""}`;
      gltfMaterials.set(key, gltf.addMaterial(name, useBase, lightmap, { source: loc.group.path, resource: `CIwMaterial#${loc.ref.index}` }));
    }
    return gltfMaterials.get(key)!;
  };

  for (const group of groups) {
    if (!group.path.startsWith(ROOM_DIR) || NOT_ROOMS.has(group.base)) continue;
    for (const ref of group.refs) {
      if (ref.classHash !== MODEL) continue;
      stats.models++;
      const label = `${group.base}#${ref.index}`;
      const placement = entities.get(ref.nameHash);
      if (!placement) {
        stats.unplaced.push(label);
        continue;
      }
      let model: Model;
      try {
        model = decodeModel(resourceBytes(group.data, ref));
      } catch (e) {
        stats.failed.push(`${label}: ${message(e)}`);
        continue;
      }
      const primitives = model.meshes
        .filter((m) => m.indices.length > 0)
        .map((m) => ({
          positions: model.positions,
          uv0: model.uv0 ?? undefined,
          uv1: model.uv1 ?? undefined,
          indices: m.indices,
          material: material(model.materialHashes[m.materialIndex], model.uv0 !== null, model.uv1 !== null),
        }));
      if (primitives.length === 0) {
        stats.failed.push(`${label}: no triangles`);
        continue;
      }
      const source = { source: group.path, resource: `CIwModel#${ref.index}` };
      const mesh = gltf.addMesh(label, primitives, source);
      gltf.addNode({
        name: label,
        mesh,
        ...nodePlacement(placement.transform),
        extras: { ...source, entitySource: placement.group.path, entityResource: `CIsEntitySpec#${placement.ref.index}` },
      });
      stats.placed++;
    }
  }

  stats.missingMaterials = missing.size;
  stats.missingTextures = noBaseTexture.size;
  const { json, bin } = gltf.toFiles("kino");
  fs.writeFileSync(path.join(out, "kino.gltf"), json);
  fs.writeFileSync(path.join(out, "kino.bin"), bin);
  return stats;
}
