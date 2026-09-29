// Quantifin addition, 2026-09-28: presentation adapter for OpenTakeoff deliverables.
// Keep the upstream branding resolver and its persisted mode unchanged.
import { resolveBranding } from "./branding.js";

export function resolveQuantifinBranding(selection) {
  const upstream = resolveBranding(selection);
  return {
    ...upstream,
    brandName: upstream.clear ? upstream.brandName : "Quantifin",
    // The marked-set PDF currently embeds a WinAnsi font, so keep this ASCII.
    coverTitle: upstream.clear ? "Marked Set" : "Quantifin · Marked Set",
    credit: "Based on OpenTakeoff",
  };
}
