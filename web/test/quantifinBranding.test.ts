// Quantifin addition, 2026-09-28: verify the presentation adapter leaves upstream branding intact.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveBranding } from "../src/lib/branding.js";
import { resolveQuantifinBranding } from "../src/lib/quantifinBranding.js";

test("Quantifin is the default report brand while the upstream resolver is unchanged", () => {
  const selection = { mode: "default", profiles: [] };
  assert.equal(resolveBranding(selection).brandName, "OpenTakeoff");
  assert.deepEqual(resolveQuantifinBranding(selection), {
    ...resolveBranding(selection),
    brandName: "Quantifin",
    coverTitle: "Quantifin · Marked Set",
    credit: "Based on OpenTakeoff",
  });
});

test("A chosen company name still brands the report", () => {
  const result = resolveQuantifinBranding({
    mode: "clearlabel",
    profileId: "company",
    profiles: [{ id: "company", name: "华建造价" }],
  });
  assert.equal(result.brandName, "华建造价");
  assert.equal(result.company?.name, "华建造价");
  assert.equal(result.credit, "Based on OpenTakeoff");
});
