import { prisma } from "../db";

export const AI_FREE_LIMIT = 50;

export interface PaywallCheckResult {
  allowed: boolean;
  aiCount: number;
  role: string;
  limit: number;
  message?: string;
}

/**
 * Checks whether a user is allowed to perform an AI action.
 * If the user's aiCount exceeds AI_FREE_LIMIT and they are not PRO, the action is blocked.
 */
export async function checkPaywall(userId: string): Promise<PaywallCheckResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, aiCount: true },
  });

  if (!user) {
    return { allowed: false, aiCount: 0, role: "FREE", limit: AI_FREE_LIMIT, message: "User not found" };
  }

  if (user.role === "PRO") {
    return { allowed: true, aiCount: user.aiCount, role: user.role, limit: AI_FREE_LIMIT };
  }

  if (user.aiCount >= AI_FREE_LIMIT) {
    return {
      allowed: false,
      aiCount: user.aiCount,
      role: user.role,
      limit: AI_FREE_LIMIT,
      message: "Upgrade to Quant Premium. Unlimited AI power for $20/mo.",
    };
  }

  return { allowed: true, aiCount: user.aiCount, role: user.role, limit: AI_FREE_LIMIT };
}

/**
 * Increments the user's aiCount after a successful AI action.
 */
export async function incrementAiCount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { aiCount: { increment: 1 } },
  });
}
