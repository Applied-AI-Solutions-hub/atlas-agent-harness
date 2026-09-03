import assert from "node:assert/strict";
import test from "node:test";
import { authenticate, authorize } from "../src/auth.mjs";
import { sha256 } from "../src/text.mjs";

const principals = [{
  id: "sparky",
  tokenSha256: sha256("secret-token"),
  actions: ["search"],
  namespaces: ["personal/owner", "agent/sparky/*", "public"]
}];

test("bearer tokens are compared by hash", () => {
  assert.equal(authenticate(principals, "Bearer secret-token")?.id, "sparky");
  assert.equal(authenticate(principals, "Bearer wrong"), null);
  assert.equal(authenticate(principals, ""), null);
});

test("authorization requires both an action and every requested namespace", () => {
  const sparky = principals[0];
  assert.equal(authorize(sparky, "search", ["personal/owner", "public"]), true);
  assert.equal(authorize(sparky, "search", ["agent/sparky/session"]), true);
  assert.equal(authorize(sparky, "search", ["business/applied-ai-solutions"]), false);
  assert.equal(authorize(sparky, "ingest", ["personal/owner"]), false);
  assert.equal(authorize(sparky, "search", []), false);
});
