import { FastifyInstance } from "fastify";
import { executeOrchestratorAction, type OrchestratorApp } from "../services/orchestratorService";
import { checkPaywall, incrementAiCount } from "../services/paywallService";

export async function orchestratorRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /orchestrator/action
   * Executes a cross-app AI orchestration action.
   * Checks the user's AI paywall before proceeding.
   *
   * Body: { userId, sourceApp, targetApp, action, payload }
   */
  app.post<{
    Body: {
      userId: string;
      sourceApp: string;
      targetApp: string;
      action: string;
      payload?: Record<string, unknown>;
    };
  }>("/orchestrator/action", async (request, reply) => {
    const { userId, sourceApp, targetApp, action, payload = {} } = request.body;

    if (!userId || !sourceApp || !targetApp || !action) {
      return reply.code(400).send({ error: "userId, sourceApp, targetApp, and action are required" });
    }

    // Check paywall
    const paywall = await checkPaywall(userId);
    if (!paywall.allowed) {
      return reply.code(402).send({
        error: "paywall",
        message: paywall.message,
        aiCount: paywall.aiCount,
        limit: paywall.limit,
        upgradeUrl: "/upgrade",
      });
    }

    const result = await executeOrchestratorAction({
      userId,
      sourceApp: sourceApp as OrchestratorApp,
      targetApp: targetApp as OrchestratorApp,
      action,
      payload,
    });

    if (!result.success) {
      return reply.code(422).send({ error: result.error });
    }

    // Increment AI usage counter on success
    await incrementAiCount(userId);

    return reply.code(200).send({ result });
  });

  /**
   * GET /paywall/check/:userId
   * Returns paywall status for a user.
   */
  app.get<{
    Params: { userId: string };
  }>("/paywall/check/:userId", async (request, reply) => {
    const { userId } = request.params;
    const status = await checkPaywall(userId);
    return reply.send(status);
  });
}
