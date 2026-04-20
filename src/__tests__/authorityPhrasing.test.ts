import { describe, expect, it } from "vitest";

import { analyzeAuthority } from "../services/AuthorityModel";
import {
  rewriteForAuthority,
  suggestAuthorityRewrites,
} from "../services/DynamicRewriter";
import OutcomePredictor, {
  predictOutcomeMetrics,
} from "../components/OutcomePredictor";

describe("AuthorityModel", () => {
  it("detects uncertain language and passive constructions", () => {
    const result = analyzeAuthority(
      "I think the deck was reviewed yesterday and maybe we should send it ASAP"
    );

    expect(result.signals.some((s) => s.type === "uncertain-language")).toBe(true);
    expect(result.signals.some((s) => s.type === "passive-voice")).toBe(true);
  });

  it("returns high score for clear direct drafts", () => {
    const result = analyzeAuthority(
      "I recommend we approve this plan today. I will send next steps by EOD."
    );

    expect(result.score).toBeGreaterThan(70);
    expect(result.executiveAlignment).toBeGreaterThan(0);
  });
});

describe("DynamicRewriter", () => {
  it("rewrites uncertain words into direct alternatives", () => {
    const result = rewriteForAuthority(
      "I think we should maybe start now and do it now"
    );

    expect(result.rewrittenText).toContain("I recommend");
    expect(result.rewrittenText).toContain("I propose");
    expect(result.rewrittenText).toContain("please complete this by EOD today");
  });

  it("provides rewrite suggestions with reason metadata", () => {
    const suggestions = suggestAuthorityRewrites("This is just a quick update.");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.reason.length).toBeGreaterThan(0);
  });
});

describe("OutcomePredictor", () => {
  it("computes confidence and expected response time", () => {
    const metrics = predictOutcomeMetrics(
      "I think maybe the document was completed and please review immediately"
    );

    expect(metrics.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(metrics.confidenceScore).toBeLessThanOrEqual(100);
    expect(metrics.expectedResponseTimeHours).toBeGreaterThanOrEqual(2);
    expect(metrics.expectedResponseTimeHours).toBeLessThanOrEqual(72);
  });

  it("returns a component-like HUD payload", () => {
    const hud = OutcomePredictor({
      draft: "I recommend approval and I will send next steps by EOD.",
    });

    expect(hud.title).toBe("Outcome Predictor HUD");
    expect(hud.metrics.confidenceScore).toBeGreaterThan(0);
  });
});
