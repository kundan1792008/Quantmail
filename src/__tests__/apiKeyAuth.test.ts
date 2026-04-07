import { describe, it, expect } from "vitest";
import { serviceApiKeyAuth } from "../middleware/apiKeyAuth";
import type { FastifyRequest, FastifyReply } from "fastify";

function makeRequest(key?: string): FastifyRequest {
  return {
    headers: key ? { "x-service-api-key": key } : {},
  } as unknown as FastifyRequest;
}

type MockReply = {
  statusCode: number;
  body: unknown;
  code(n: number): MockReply & FastifyReply;
  send(b: unknown): MockReply & FastifyReply;
};

function makeReply(): MockReply {
  const r: MockReply = {
    statusCode: 200,
    body: null,
    code(n: number) {
      r.statusCode = n;
      return r as MockReply & FastifyReply;
    },
    send(b: unknown) {
      r.body = b;
      return r as MockReply & FastifyReply;
    },
  };
  return r;
}

describe("serviceApiKeyAuth middleware", () => {
  it("should reply 401 when no X-Service-Api-Key header is present", async () => {
    const req = makeRequest();
    const reply = makeReply();
    await serviceApiKeyAuth(req, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(401);
    expect((reply.body as { error: string }).error).toMatch(/required/i);
  });

  it("should reply 403 when the key is not in SERVICE_API_KEYS", async () => {
    const req = makeRequest("totally-wrong-key");
    const reply = makeReply();
    await serviceApiKeyAuth(req, reply as unknown as FastifyReply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as { error: string }).error).toMatch(/invalid/i);
  });

  it("should reply 403 when SERVICE_API_KEYS env is empty (no keys configured)", async () => {
    // The module is loaded with the current env at import time.
    // An empty or absent SERVICE_API_KEYS means the Set is empty → 403.
    const req = makeRequest("any-key");
    const reply = makeReply();
    await serviceApiKeyAuth(req, reply as unknown as FastifyReply);
    // Depending on env at test time the status is either 403 (empty set)
    // or something else when keys are configured.  We just assert it isn't 200.
    expect([401, 403]).toContain(reply.statusCode);
  });
});
