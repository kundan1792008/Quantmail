/**
 * Master ID Propagation Middleware
 *
 * Ensures the biometric Master ID hash is attached to every authenticated
 * request and can be forwarded to other apps in the ecosystem.
 *
 * The Master ID is resolved from the x-master-id header or from the
 * authenticated user's record and propagated via response headers so
 * downstream apps can consume it implicitly.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "../generated/prisma/client/index.js";

const MASTER_ID_HEADER = "x-master-id";
const PROPAGATION_HEADER = "x-quantmail-master-id";

/**
 * List of app endpoints in the Infinity Trinity ecosystem that accept
 * the Master ID for SSO propagation.
 */
export const ECOSYSTEM_APPS = [
  "quantbrowse-ai",
  "quantvault",
  "quantpay",
  "quantdocs",
  "quantchat",
  "quantcloud",
  "quantboard",
  "quantsync",
] as const;

export type EcosystemApp = (typeof ECOSYSTEM_APPS)[number];

/**
 * Resolves the Master ID hash for the current request, either from the
 * header or by looking up the user in the database.
 */
export async function resolveMasterId(
  prisma: PrismaClient,
  request: FastifyRequest
): Promise<string | null> {
  // Check header first
  const headerValue = request.headers[MASTER_ID_HEADER];
  if (typeof headerValue === "string" && headerValue.length > 0) {
    // Validate that this Master ID exists in our database
    const user = await prisma.user.findUnique({
      where: { masterIdHash: headerValue },
    });
    return user ? headerValue : null;
  }
  return null;
}

/**
 * Attaches the Master ID to the response for downstream propagation.
 */
export function propagateMasterId(
  reply: FastifyReply,
  masterIdHash: string
): void {
  void reply.header(PROPAGATION_HEADER, masterIdHash);
}

/**
 * Builds the propagation headers that should be forwarded when making
 * requests to other ecosystem apps.
 */
export function buildPropagationHeaders(masterIdHash: string): Record<string, string> {
  return {
    [MASTER_ID_HEADER]: masterIdHash,
    [PROPAGATION_HEADER]: masterIdHash,
  };
}

export { MASTER_ID_HEADER, PROPAGATION_HEADER };
