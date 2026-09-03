import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { sha256 } from "./text.mjs";

function matchesNamespace(pattern, namespace) {
  if (typeof pattern !== "string" || typeof namespace !== "string" || !namespace) return false;
  return pattern === "*" || pattern === namespace || (pattern.endsWith("/*") && namespace.startsWith(pattern.slice(0, -1)));
}

export function loadPrincipals(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed.principals)) throw new Error("principals must be an array");
  return parsed.principals;
}

export function authenticate(principals, authorization) {
  const match = /^Bearer\s+(.+)$/i.exec(authorization || "");
  if (!match) return null;
  const presented = Buffer.from(sha256(match[1]), "hex");
  for (const principal of principals) {
    if (!/^[a-f0-9]{64}$/i.test(principal.tokenSha256 || "")) continue;
    const expected = Buffer.from(principal.tokenSha256, "hex");
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) return principal;
  }
  return null;
}

export function authorize(principal, action, namespaces) {
  if (!principal || !principal.actions?.includes(action) || !Array.isArray(namespaces) || namespaces.length === 0) return false;
  return namespaces.every(namespace => principal.namespaces?.some(pattern => matchesNamespace(pattern, namespace)));
}
