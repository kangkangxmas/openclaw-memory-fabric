import { describe, it, expect, beforeAll, afterAll } from "./test-helpers.js";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("V2 API End-to-End", () => {
  let app: FastifyInstance;
  let createdEntryId: string;

  beforeAll(async () => {
    // Use temp directory for E2E tests
    process.env.OPENVIKING_BASE_PATH = "/tmp/e2e-v2-test/openviking";
    process.env.CARRIERS_ROOT = "/tmp/e2e-v2-test/carriers";
    const { app: server } = await buildServer();
    app = server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v2/memories — should create a memory", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/memories",
      payload: {
        content: "E2E test memory entry",
        agentId: "e2e-agent",
        type: "fact",
        tags: ["e2e", "test"],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entry.id).toBeDefined();
    expect(body.entry.content).toBe("E2E test memory entry");
    createdEntryId = body.entry.id;
  });

  it("GET /v2/memories/:id — should read a memory", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v2/memories/${createdEntryId}`,
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entry.id).toBe(createdEntryId);
  });

  it("PATCH /v2/memories/:id — should update a memory", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/v2/memories/${createdEntryId}`,
      payload: {
        content: "Updated E2E test memory",
        tags: ["e2e", "updated"],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("POST /v2/search — should search memories", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/search",
      payload: {
        text: "E2E test",
        limit: 10,
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entries.length).toBeGreaterThanOrEqual(0);
  });

  it("POST /v2/query — should query with filters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/query",
      payload: {
        text: "E2E",
        agentId: "e2e-agent",
        types: ["fact"],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("POST /v2/aggregate — should aggregate", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/aggregate",
      payload: {
        field: "id",
        op: "count",
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.value).toBeGreaterThanOrEqual(0);
  });

  it("POST /v2/facets — should generate facets", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/facets",
      payload: {
        fields: ["type", "agentId"],
      },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.facets.length).toBe(2);
  });

  it("GET /v2/stats — should return stats", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v2/stats",
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stats).toBeDefined();
    expect(body.cache).toBeDefined();
    expect(body.index).toBeDefined();
  });

  it("POST /v2/backup — should create backup", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/backup",
      payload: { description: "E2E backup test" },
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.backupId).toBeDefined();
  });

  it("POST /v2/cleanup — should cleanup", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v2/cleanup",
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("DELETE /v2/memories/:id — should delete a memory", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/v2/memories/${createdEntryId}`,
    });

    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });
});