/**
 * Pure, dependency-free QR Code generator (Byte mode, ECC Level L, Versions 1–10, up to 271 bytes)
 * for rendering local SVG pairing QR codes without external libraries or network calls.
 */

interface VersionSpec {
  readonly version: number;
  readonly size: number;
  readonly totalDataCodewords: number;
  readonly ecCodewordsPerBlock: number;
  readonly blocksGroup1: number;
  readonly dataCodewordsGroup1: number;
  readonly blocksGroup2: number;
  readonly dataCodewordsGroup2: number;
  readonly alignment: readonly number[];
}

// ISO/IEC 18004 ECC Level L specifications for versions 1..10.
const VERSIONS: readonly VersionSpec[] = [
  {
    version: 1,
    size: 21,
    totalDataCodewords: 19,
    ecCodewordsPerBlock: 7,
    blocksGroup1: 1,
    dataCodewordsGroup1: 19,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [],
  },
  {
    version: 2,
    size: 25,
    totalDataCodewords: 34,
    ecCodewordsPerBlock: 10,
    blocksGroup1: 1,
    dataCodewordsGroup1: 34,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 18],
  },
  {
    version: 3,
    size: 29,
    totalDataCodewords: 55,
    ecCodewordsPerBlock: 15,
    blocksGroup1: 1,
    dataCodewordsGroup1: 55,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 22],
  },
  {
    version: 4,
    size: 33,
    totalDataCodewords: 80,
    ecCodewordsPerBlock: 20,
    blocksGroup1: 1,
    dataCodewordsGroup1: 80,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 26],
  },
  {
    version: 5,
    size: 37,
    totalDataCodewords: 108,
    ecCodewordsPerBlock: 26,
    blocksGroup1: 1,
    dataCodewordsGroup1: 108,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 30],
  },
  {
    version: 6,
    size: 41,
    totalDataCodewords: 136,
    ecCodewordsPerBlock: 18,
    blocksGroup1: 2,
    dataCodewordsGroup1: 68,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 34],
  },
  {
    version: 7,
    size: 45,
    totalDataCodewords: 156,
    ecCodewordsPerBlock: 20,
    blocksGroup1: 2,
    dataCodewordsGroup1: 78,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 22, 38],
  },
  {
    version: 8,
    size: 49,
    totalDataCodewords: 194,
    ecCodewordsPerBlock: 24,
    blocksGroup1: 2,
    dataCodewordsGroup1: 97,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 24, 42],
  },
  {
    version: 9,
    size: 53,
    totalDataCodewords: 232,
    ecCodewordsPerBlock: 30,
    blocksGroup1: 2,
    dataCodewordsGroup1: 116,
    blocksGroup2: 0,
    dataCodewordsGroup2: 0,
    alignment: [6, 26, 46],
  },
  {
    version: 10,
    size: 57,
    totalDataCodewords: 274,
    ecCodewordsPerBlock: 18,
    blocksGroup1: 2,
    dataCodewordsGroup1: 68,
    blocksGroup2: 2,
    dataCodewordsGroup2: 69,
    alignment: [6, 28, 50],
  },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]!;
  }
}

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;

function reedSolomonGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, factor);
    }
    poly = next;
  }
  return poly;
}

function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = reedSolomonGenerator(degree);
  const rem = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < degree; j++) {
        rem[j] = (rem[j] ?? 0) ^ gfMul(gen[j + 1]!, factor);
      }
    }
  }
  return rem;
}

function pickVersion(byteLength: number): VersionSpec {
  for (const spec of VERSIONS) {
    const countBits = spec.version <= 9 ? 8 : 16;
    const capacity = Math.floor((spec.totalDataCodewords * 8 - 4 - countBits) / 8);
    if (byteLength <= capacity) return spec;
  }
  throw new Error("QR payload exceeds Version 10 capacity");
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  // Byte mode indicator (0100)
  pushBits(0b0100, 4);
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const totalBits = spec.totalDataCodewords * 8;
  pushBits(0, Math.min(4, totalBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.totalDataCodewords);
  const byteLen = bits.length / 8;
  for (let i = 0; i < byteLen; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!;
    codewords[i] = b;
  }
  const padBytes = [0xec, 0x11];
  for (let i = byteLen; i < spec.totalDataCodewords; i++) {
    codewords[i] = padBytes[(i - byteLen) % 2]!;
  }
  return codewords;
}

function interleaveCodewords(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < spec.blocksGroup1; i++) {
    const block = data.subarray(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonRemainder(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.blocksGroup2; i++) {
    const block = data.subarray(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonRemainder(block, spec.ecCodewordsPerBlock));
  }
  const maxDataLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  const out: number[] = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) out.push(block[i]!);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) {
      out.push(block[i]!);
    }
  }
  return new Uint8Array(out);
}

// Format information bits for ECC Level L (01), masks 0..7, BCH-encoded and XORed with 0x5412.
const FORMAT_BITS_L: readonly number[] = [
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
];

// Version information bits for versions 7..10.
const VERSION_BITS: Readonly<Record<number, number>> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

/** Encodes `text` into a square boolean matrix (`true` = dark module). */
export function encodeQrMatrix(text: string): readonly (readonly boolean[])[] {
  const bytes = new TextEncoder().encode(text);
  const spec = pickVersion(bytes.length);
  const size = spec.size;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  const setFunction = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunction(top + dr, left + dc, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const align = spec.alignment;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0)
      )
        continue;
      const cr = align[i]!;
      const cc = align[j]!;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunction(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format info areas & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunction(8, i, false);
      setFunction(i, 8, false);
    }
    if (i < 8) {
      setFunction(8, size - 1 - i, false);
      setFunction(size - 1 - i, 8, false);
    }
  }
  setFunction(size - 8, 8, true);

  // Version info for versions >= 7
  const vBits = VERSION_BITS[spec.version];
  if (vBits !== undefined) {
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, bit);
      setFunction(b, a, bit);
    }
  }

  // Place data bits in zigzag
  const codewords = interleaveCodewords(encodeDataCodewords(bytes, spec), spec);
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const upward = ((right + 1) & 2) === 0;
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (isFunction[r]![c]) continue;
        const dark =
          bitIdx < totalBits
            ? ((codewords[bitIdx >>> 3]! >>> (7 - (bitIdx & 7))) & 1) !== 0
            : false;
        modules[r]![c] = dark;
        bitIdx++;
      }
    }
  }

  // Apply mask 0: (r + c) % 2 === 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r]![c] && (r + c) % 2 === 0) {
        modules[r]![c] = !modules[r]![c];
      }
    }
  }

  // Write format info for mask 0
  const formatBits = FORMAT_BITS_L[0]!;
  for (let i = 0; i <= 5; i++) setFunction(8, i, ((formatBits >>> i) & 1) !== 0);
  setFunction(8, 7, ((formatBits >>> 6) & 1) !== 0);
  setFunction(8, 8, ((formatBits >>> 7) & 1) !== 0);
  setFunction(7, 8, ((formatBits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, ((formatBits >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, ((formatBits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, ((formatBits >>> i) & 1) !== 0);

  return modules;
}

/** Builds an SVG `<path d="...">` string for all dark modules in `matrix`. */
export function qrSvgPath(
  matrix: readonly (readonly boolean[])[],
  margin = 2,
): {
  readonly viewBox: string;
  readonly path: string;
} {
  const size = matrix.length;
  const total = size + margin * 2;
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c]) {
        parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
      }
    }
  }
  return { viewBox: `0 0 ${total} ${total}`, path: parts.join("") };
}
