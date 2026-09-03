import { createHash } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value).length / 4));
}

export function tokenize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(token => token.length > 1);
}

export function chunkText(text, { targetChars = 1200, overlapChars = 160 } = {}) {
  const normalized = String(text).replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (!current.trim()) return;
    chunks.push(current.trim());
    current = overlapChars > 0 ? current.slice(-overlapChars).trimStart() : "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > targetChars * 1.5) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current && current.length + sentence.length + 1 > targetChars) flush();
        current += `${current ? " " : ""}${sentence}`;
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > targetChars) flush();
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current.trim()) chunks.push(current.trim());
  return [...new Set(chunks)];
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
