export type CriticalAlertCategory = "CRITICAL_PAYMENT" | "ECOSYSTEM_TOKEN";

export interface CriticalAlertDetectionResult {
  isCritical: boolean;
  category: CriticalAlertCategory | null;
  reason: string;
}

const PAYMENT_PATTERNS: readonly RegExp[] = [
  /\b(payment|payout|wire|settlement|invoice|chargeback)\b/i,
  /\b(fraud|unauthorized|failed payment|declined)\b/i,
  /\b(urgent transfer|wallet drained unexpectedly|unauthorized wallet drain)\b/i,
];

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\b(token|ecosystem token|staking|unstake|mint|burn)\b/i,
  /\b(private key|seed phrase|wallet breach)\b/i,
  /\b(liquidity|bridge exploit|governance attack)\b/i,
];

export function detectCriticalAlert(
  subject: string,
  body: string
): CriticalAlertDetectionResult {
  const content = `${subject}\n${body}`;

  if (PAYMENT_PATTERNS.some((pattern) => pattern.test(content))) {
    return {
      isCritical: true,
      category: "CRITICAL_PAYMENT",
      reason: "CRITICAL_PAYMENT_ALERT",
    };
  }

  if (TOKEN_PATTERNS.some((pattern) => pattern.test(content))) {
    return {
      isCritical: true,
      category: "ECOSYSTEM_TOKEN",
      reason: "ECOSYSTEM_TOKEN_ALERT",
    };
  }

  return {
    isCritical: false,
    category: null,
    reason: "NON_CRITICAL",
  };
}
