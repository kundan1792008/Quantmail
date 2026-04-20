import { analyzeAuthority } from "../services/AuthorityModel";
import { rewriteForAuthority } from "../services/DynamicRewriter";

export interface OutcomePredictorProps {
  draft: string;
}

export interface OutcomePredictorMetrics {
  confidenceScore: number; // 0..100
  expectedResponseTimeHours: number;
  delta: number;
  headline: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MAX_RESPONSE_TIME_HOURS = 72;
const MIN_RESPONSE_TIME_HOURS = 2;
// Heuristic: each +1 authority-confidence point reduces expected response time by ~30 minutes.
// This keeps the metric sensitive enough for draft improvements while bounded in a realistic range.
const RESPONSE_TIME_REDUCTION_PER_CONFIDENCE_POINT = 0.5;

export function predictOutcomeMetrics(draft: string): OutcomePredictorMetrics {
  const baseline = analyzeAuthority(draft);
  const rewritten = rewriteForAuthority(draft);
  const improved = analyzeAuthority(rewritten.rewrittenText);

  const confidenceScore = clamp(improved.score, 0, 100);
  const delta = improved.score - baseline.score;

  const predictedHours =
    Math.round(
      (MAX_RESPONSE_TIME_HOURS -
        confidenceScore * RESPONSE_TIME_REDUCTION_PER_CONFIDENCE_POINT) *
        10
    ) / 10;
  const expectedResponseTimeHours = clamp(
    predictedHours,
    MIN_RESPONSE_TIME_HOURS,
    MAX_RESPONSE_TIME_HOURS
  );

  const headline =
    delta > 0
      ? `Authority confidence +${delta} points`
      : delta < 0
        ? `Authority confidence ${delta} points`
        : "Authority confidence unchanged";

  return {
    confidenceScore,
    expectedResponseTimeHours,
    delta,
    headline,
  };
}

/**
 * Lightweight, framework-agnostic "component-like" renderer for environments
 * that may not have React runtime wiring enabled.
 */
export default function OutcomePredictor(
  props: OutcomePredictorProps
): { title: string; metrics: OutcomePredictorMetrics } {
  return {
    title: "Outcome Predictor HUD",
    metrics: predictOutcomeMetrics(props.draft),
  };
}
