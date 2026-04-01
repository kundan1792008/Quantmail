/**
 * Master ID Propagation Utility
 *
 * Provides mechanisms for the biometric Master SSO identity to propagate
 * implicitly across all apps in the Infinity Trinity ecosystem.
 *
 * The Master ID is encoded as a signed token that each downstream app
 * can verify independently without a central auth server round-trip.
 */

import {
  generateMasterSSOToken,
  verifyMasterSSOToken,
} from "../utils/crypto";

/** Registry of apps that accept Master ID propagation. */
export const PROPAGATION_TARGETS = [
  "quantbrowse-ai",
  "quantpay",
  "quantcloud",
  "quantsocial",
  "quantvault",
  "quanthealth",
  "quantlearn",
  "quantwork",
  "quantedits",
] as const;

export type AppTarget = (typeof PROPAGATION_TARGETS)[number];

export interface PropagationPayload {
  token: string;
  targetApp: AppTarget;
  userId: string;
  issuedAt: number;
}

/**
 * Generates Master ID propagation payloads for all target apps.
 * Each app gets its own signed token scoped to that app.
 */
export function propagateMasterIdToAll(
  userId: string,
  secret: string
): PropagationPayload[] {
  const now = Date.now();
  return PROPAGATION_TARGETS.map((targetApp) => {
    const scopedSecret = `${secret}:${targetApp}`;
    const token = generateMasterSSOToken(userId, scopedSecret);
    return { token, targetApp, userId, issuedAt: now };
  });
}

/**
 * Verifies a Master ID token for a specific target app.
 * Returns the userId if valid, null otherwise.
 */
export function verifyPropagatedId(
  token: string,
  targetApp: AppTarget,
  secret: string
): string | null {
  const scopedSecret = `${secret}:${targetApp}`;
  return verifyMasterSSOToken(token, scopedSecret);
}
