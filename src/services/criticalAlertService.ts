export type AlertCategory = "PAYMENT" | "ECOSYSTEM_TOKEN" | "GENERAL";

const PAYMENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bpayment\b/i,
  /\bcharge\b/i,
  /\bdebit\b/i,
  /\bwire\b/i,
  /\binvoice\b/i,
  /\bsettlement\b/i,
  /\btransaction\b/i,
];

const TOKEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\becosystem token\b/i,
  /\becosystem[_-]?token\b/i,
  /\becosystemtoken\b/i,
  /\btoken\b/i,
  /\bx402\b/i,
  /\bquantpay\b/i,
  /\bqtoken\b/i,
  /\bwallet\b/i,
  /\btransfer\b/i,
  /\bstake\b/i,
  /\bmint\b/i,
  /\bliquidity\b/i,
];

const CRITICAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bcritical\b/i,
  /\burgent\b/i,
  /\bimmediate\b/i,
  /\bbreach\b/i,
  /\bfraud\b/i,
  /\bsecurity alert\b/i,
];

export interface CriticalAlertSignal {
  isCritical: boolean;
  category: AlertCategory;
  summary: string;
}

export function detectCriticalAlert(
  subject: string,
  body: string
): CriticalAlertSignal {
  const joined = `${subject} ${body}`.toLowerCase();
  const hasCriticalMarker = CRITICAL_PATTERNS.some((pattern) =>
    pattern.test(joined)
  );
  const isPayment = PAYMENT_PATTERNS.some((pattern) => pattern.test(joined));
  const isToken = TOKEN_PATTERNS.some((pattern) => pattern.test(joined));

  if (hasCriticalMarker && isPayment) {
    return {
      isCritical: true,
      category: "PAYMENT",
      summary: "Critical payment alert detected",
    };
  }

  if (hasCriticalMarker && isToken) {
    return {
      isCritical: true,
      category: "ECOSYSTEM_TOKEN",
      summary: "Critical ecosystem token alert detected",
    };
  }

  return {
    isCritical: false,
    category: "GENERAL",
    summary: "No critical signal detected",
  };
}
