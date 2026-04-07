import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Comma-separated list of valid service API keys sourced from the environment.
 * Example: SERVICE_API_KEYS=key-abc,key-def
 */
const SERVICE_API_KEYS: Set<string> = new Set(
  (process.env["SERVICE_API_KEYS"] || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
);

if (SERVICE_API_KEYS.size === 0) {
  // Log once at module load so operators notice misconfiguration immediately.
  console.warn(
    "[apiKeyAuth] WARNING: SERVICE_API_KEYS is not set. " +
      "All service-to-service requests will be rejected with HTTP 403."
  );
}

/**
 * Fastify pre-handler that authenticates service-to-service requests.
 *
 * Clients must supply the key in the `X-Service-Api-Key` header.
 * Returns 401 when the header is absent and 403 when the key is invalid.
 *
 * Usage in a route:
 *   app.get('/internal/...', { preHandler: serviceApiKeyAuth }, handler);
 */
export async function serviceApiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const key = request.headers["x-service-api-key"];

  if (!key || typeof key !== "string") {
    return reply
      .code(401)
      .send({ error: "Service API key required (X-Service-Api-Key header)" });
  }

  if (SERVICE_API_KEYS.size === 0 || !SERVICE_API_KEYS.has(key)) {
    return reply.code(403).send({ error: "Invalid service API key" });
  }
}
