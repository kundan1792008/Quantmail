import { describe, it, expect } from "vitest";
import { extractBearerToken } from "../middleware/authMiddleware";
import type { FastifyRequest } from "fastify";

/** Creates a minimal mock FastifyRequest with only the authorization header. */
function mockRequest(authorization?: string): FastifyRequest {
  return {
    headers: { authorization },
  } as unknown as FastifyRequest;
}

describe("extractBearerToken", () => {
  it("should extract a valid Bearer token", () => {
    const req = mockRequest("Bearer abc123");
    expect(extractBearerToken(req)).toBe("abc123");
  });

  it("should return null when Authorization header is absent", () => {
    const req = mockRequest(undefined);
    expect(extractBearerToken(req)).toBeNull();
  });

  it("should return null for non-Bearer schemes", () => {
    const req = mockRequest("Basic dXNlcjpwYXNz");
    expect(extractBearerToken(req)).toBeNull();
  });

  it("should return null for an empty Bearer value", () => {
    const req = mockRequest("Bearer ");
    expect(extractBearerToken(req)).toBeNull();
  });

  it("should handle tokens containing dots (SSO format)", () => {
    const req = mockRequest("Bearer header.signature");
    expect(extractBearerToken(req)).toBe("header.signature");
  });
});
