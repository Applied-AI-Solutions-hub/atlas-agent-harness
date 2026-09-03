import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function matchesNamespace(pattern, namespace) {
  return pattern === "*" || pattern === namespace || (pattern?.endsWith("/*") && namespace.startsWith(pattern.slice(0, -1)));
}

export function loadPrincipals(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.principals)) throw new Error("principals must be an array");
  return parsed.principals;
}

export function authenticate(principals, authorization) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization || "");
  if (!match) return null;
  const presented = sha256(match[1]);
  return principals.find((principal) => {
    if (!/^[a-f0-9]{64}$/i.test(principal.tokenSha256 || "")) return false;
    const expected = Buffer.from(principal.tokenSha256, "hex");
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }) ?? null;
}

export function authorize(principal, action, namespace) {
  return Boolean(principal?.actions?.includes(action) && principal.namespaces?.some((pattern) => matchesNamespace(pattern, namespace)));
}
