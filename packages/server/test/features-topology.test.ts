import { describe, expect, it } from 'vitest';
import {
  buildFaceAnalysisPrompt,
  FACE_ANALYSIS_PROMPT_VERSION,
  FACE_SCHEMA,
  normalizeFaceFeatures,
  type HeadwearType,
} from '../src/likeness/features';

describe('canonical face topology', () => {
  it('upgrades a legacy payload with deterministic hair, geometry, and region defaults', () => {
    const normalized = normalizeFaceFeatures({
      skinTone: '#c98f6b',
      hairColor: '#201810',
      hairStyle: 'long',
      facialHair: 'stubble',
      glasses: true,
      headwear: false,
    });

    expect(normalized).toMatchObject({
      hairStyle: 'long',
      hairLength: 'long',
      hairTexture: 'straight',
      hairPart: 'none',
      glassesColor: '#1b1622',
      faceShape: 'oval',
      chin: 'round',
      noseSize: 'medium',
      eyeSpacing: 'average',
      eyeShape: 'almond',
      eyebrows: 'medium',
      eyebrowShape: 'straight',
      ears: 'average',
      topology: {
        scalpHair: { crown: true, temples: true, belowEars: true },
        headwear: { crown: 'none', projection: 'none' },
        glasses: { frame: 'thin', lensShape: 'rectangular', lensTint: 'clear' },
        facialHair: {
          upperLip: 'stubble',
          chin: 'stubble',
          jaw: 'stubble',
          cheeks: 'stubble',
        },
      },
    });
  });

  it('keeps length and texture orthogonal and preserves supplied visible topology', () => {
    const normalized = normalizeFaceFeatures({
      hairColor: '#503020',
      hairStyle: 'curly',
      hairLength: 'long',
      hairTexture: 'coily',
      hairPart: 'center',
      glasses: true,
      glassesColor: 'ABC',
      facialHair: 'beard',
      headwear: false,
      topology: {
        scalpHair: { crown: false, temples: true, belowEars: true },
        headwear: { crown: 'panelled', projection: 'front-bill' },
        glasses: { frame: 'thick', lensShape: 'round', lensTint: 'dark' },
        facialHair: { upperLip: 'stubble', chin: 'solid', jaw: 'solid', cheeks: 'none' },
      },
    });

    expect(normalized.hairStyle).toBe('long');
    expect(normalized.hairLength).toBe('long');
    expect(normalized.hairTexture).toBe('coily');
    expect(normalized.hairPart).toBe('center');
    expect(normalized.glassesColor).toBe('#aabbcc');
    expect(normalized.topology.scalpHair).toEqual({ crown: false, temples: true, belowEars: true });
    expect(normalized.topology.glasses).toEqual({ frame: 'thick', lensShape: 'round', lensTint: 'dark' });
    expect(normalized.topology.facialHair).toEqual({
      upperLip: 'stubble',
      chin: 'solid',
      jaw: 'solid',
      cheeks: 'none',
    });
    // Explicit coarse booleans remain authoritative when providers conflict.
    expect(normalized.topology.headwear).toEqual({ crown: 'none', projection: 'none' });
  });

  it('keeps hair visible below a hat even when the coarse crown style is hidden', () => {
    const normalized = normalizeFaceFeatures({
      hairColor: '#5a3a28',
      hairStyle: 'hidden',
      hairLength: 'long',
      hairTexture: 'wavy',
      hairPart: 'none',
      headwear: true,
      headwearType: 'cap',
      facialHair: 'none',
      glasses: false,
      topology: {
        scalpHair: { crown: false, temples: true, belowEars: true },
      },
    });

    expect(normalized.hairStyle).toBe('long');
    expect(normalized.hairLength).toBe('long');
    expect(normalized.hairTexture).toBe('wavy');
    expect(normalized.topology.scalpHair).toEqual({ crown: false, temples: true, belowEars: true });
  });

  it('derives the legacy silhouette from canonical hair when hairStyle is absent', () => {
    expect(normalizeFaceFeatures({
      hairColor: '#332211',
      hairLength: 'tied',
      hairTexture: 'wavy',
      hairPart: 'right',
    })).toMatchObject({
      hairStyle: 'ponytail',
      hairLength: 'tied',
      hairTexture: 'wavy',
      hairPart: 'right',
    });

    const bald = normalizeFaceFeatures({
      hairColor: 'none',
      hairStyle: 'bald',
      hairLength: 'long',
      hairTexture: 'curly',
      topology: { scalpHair: { crown: true, temples: true, belowEars: true } },
    });
    expect(bald).toMatchObject({
      hairStyle: 'bald',
      hairLength: 'none',
      hairTexture: 'none',
      hairPart: 'none',
      topology: { scalpHair: { crown: false, temples: false, belowEars: false } },
    });
  });

  it('preserves explicit afro and horseshoe silhouettes through canonical normalization', () => {
    const afro = normalizeFaceFeatures({
      hairColor: '#30241f',
      hairStyle: 'afro',
      hairLength: 'short',
      hairTexture: 'coily',
      topology: { scalpHair: { crown: true, temples: true, belowEars: false } },
    });
    expect(afro).toMatchObject({
      hairStyle: 'afro',
      hairLength: 'short',
      hairTexture: 'coily',
      topology: { scalpHair: { crown: true, temples: true, belowEars: false } },
    });

    const horseshoe = normalizeFaceFeatures({
      hairColor: '#332820',
      hairStyle: 'horseshoe',
      hairLength: 'short',
      hairTexture: 'straight',
      topology: { scalpHair: { crown: true, temples: true, belowEars: false } },
    });
    expect(horseshoe).toMatchObject({
      hairStyle: 'horseshoe',
      hairLength: 'short',
      hairTexture: 'straight',
      topology: { scalpHair: { crown: false, temples: true, belowEars: false } },
    });
  });

  it('advertises afro and horseshoe as distinct model-facing hair silhouettes', () => {
    const properties = FACE_SCHEMA['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['hairStyle']!['enum']).toEqual(expect.arrayContaining(['afro', 'horseshoe']));

    const prompt = buildFaceAnalysisPrompt().system;
    expect(prompt).toContain('"afro" is a rounded, outward-volume coily silhouette');
    expect(prompt).toContain('"horseshoe" is an exposed crown with visible hair around the sides/back');
    expect(FACE_ANALYSIS_PROMPT_VERSION).toBe('face-topology-v6');
  });

  it.each<[HeadwearType, string, string]>([
    ['cap', 'panelled', 'front-bill'],
    ['beanie', 'knit', 'none'],
    ['brim', 'structured', 'full-brim'],
    ['flatCap', 'structured', 'front-bill'],
    ['beret', 'structured', 'none'],
    ['topHat', 'structured', 'full-brim'],
    ['wideBrim', 'structured', 'full-brim'],
  ])('maps legacy/expanded %s headwear to canonical geometry', (headwearType, crown, projection) => {
    const normalized = normalizeFaceFeatures({ headwear: true, headwearType });
    expect(normalized.headwearType).toBe(headwearType);
    expect(normalized.topology.headwear).toEqual({ crown, projection });
  });

  it('requires every canonical field in new model calls while documenting legacy normalization', () => {
    const required = FACE_SCHEMA['required'] as string[];
    expect(required).toEqual(expect.arrayContaining([
      'hairLength',
      'hairTexture',
      'hairPart',
      'glassesColor',
      'topology',
    ]));

    const properties = FACE_SCHEMA['properties'] as Record<string, Record<string, unknown>>;
    const topology = properties['topology']!;
    expect(topology['required']).toEqual(['scalpHair', 'headwear', 'glasses', 'facialHair']);

    const prompt = buildFaceAnalysisPrompt().system;
    expect(prompt).toContain('long curly hair');
    expect(prompt).toContain('topology.facialHair.upperLip');
    expect(prompt).toContain('never silently omit the moustache region');
    expect(prompt).toContain('upperLip "solid", chin/jaw "stubble"');
  });

  it('forces boolean accessories off while preserving explicit regional facial hair', () => {
    const normalized = normalizeFaceFeatures({
      glasses: false,
      glassesColor: '#ffffff',
      headwear: false,
      facialHair: 'none',
      facialHairColor: '#ffffff',
      topology: {
        glasses: { frame: 'thick', lensShape: 'round', lensTint: 'dark' },
        facialHair: { upperLip: 'solid', chin: 'solid', jaw: 'solid', cheeks: 'solid' },
      },
    });
    expect(normalized.glassesColor).toBe('none');
    expect(normalized.topology.glasses).toEqual({ frame: 'none', lensShape: 'none', lensTint: 'none' });
    expect(normalized.facialHair).toBe('beard');
    expect(normalized.facialHairColor).toBe('#ffffff');
    expect(normalized.topology.facialHair).toEqual({
      upperLip: 'solid',
      chin: 'solid',
      jaw: 'solid',
      cheeks: 'solid',
    });
  });

  it('lets mixed regional topology override an unrepresentative coarse label', () => {
    const normalized = normalizeFaceFeatures({
      facialHair: 'goatee',
      facialHairColor: '#3d352f',
      topology: {
        facialHair: { upperLip: 'solid', chin: 'stubble', jaw: 'stubble', cheeks: 'none' },
      },
    });
    expect(normalized.facialHair).toBe('stubble');
    expect(normalized.topology.facialHair).toEqual({
      upperLip: 'solid',
      chin: 'stubble',
      jaw: 'stubble',
      cheeks: 'none',
    });
  });
});
