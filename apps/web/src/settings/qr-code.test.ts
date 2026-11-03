import { describe, expect, it } from "vitest";
import { encodeQrMatrix, qrSvgPath } from "./qr-code";

describe("encodeQrMatrix", () => {
  it("encodes a 256-bit Tailscale pairing URL into a valid square QR matrix and SVG path", () => {
    const url = "https://macbook.tail123.ts.net:9443/remote/connect#pair=" + "a1b2c3d4".repeat(8);
    const matrix = encodeQrMatrix(url);
    // 120 bytes fits in Version 6 (size 41x41)
    expect(matrix.length).toBe(41);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    // Top-left, top-right, and bottom-left 7x7 finder corners are dark at (0,0), (0,size-1), (size-1,0)
    const size = matrix.length;
    expect(matrix[0]![0]).toBe(true);
    expect(matrix[0]![6]).toBe(true);
    expect(matrix[6]![0]).toBe(true);
    expect(matrix[3]![3]).toBe(true);
    expect(matrix[0]![size - 1]).toBe(true);
    expect(matrix[size - 1]![0]).toBe(true);

    const svg = qrSvgPath(matrix, 2);
    expect(svg.viewBox).toBe(`0 0 ${size + 4} ${size + 4}`);
    expect(svg.path).toContain("M2 2h1v1h-1z");
  });
});
