import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemory,
  deleteManyMemories,
  deleteMemory,
  MemoryHttpError,
  memoryErrorResponse,
  readMemoryDashboard,
  updateManyMemoryStatuses,
  updateMemorySettings,
  writeAutomationRunMemory,
} from "./memory";

const walletUser = {
  id: "wallet-user-1",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

test("memory dashboards scope memories and settings to the authenticated wallet", async () => {
  const calls: Array<{ args: unknown[]; method: string; table: string }> = [];
  const memoryRow = {
    category: "Project",
    confidence: 90,
    created_at: "2026-07-17T10:00:00.000Z",
    id: "memory-1",
    last_used_at: "2026-07-17T11:00:00.000Z",
    memory: "Track CELO proof runs",
    metadata: {},
    scope: "Langclaw",
    source: "Manual",
    status: "active",
    updated_at: "2026-07-17T12:00:00.000Z",
    wallet_user_id: walletUser.id,
  };
  const settingsRow = {
    auto_disable_low_confidence: true,
    capture_enabled: true,
    created_at: "2026-07-17T10:00:00.000Z",
    cross_chat_recall: true,
    project_scoped_recall: true,
    retention_days: 90,
    updated_at: "2026-07-17T12:00:00.000Z",
    wallet_user_id: walletUser.id,
  };
  const supabase = {
    from(table: string) {
      if (table === "langclaw_memories") {
        return {
          select(...args: unknown[]) {
            calls.push({ args, method: "select", table });
            return {
              eq(...eqArgs: unknown[]) {
                calls.push({ args: eqArgs, method: "eq", table });
                return {
                  order(...orderArgs: unknown[]) {
                    calls.push({ args: orderArgs, method: "order", table });
                    return {
                      limit(...limitArgs: unknown[]) {
                        calls.push({ args: limitArgs, method: "limit", table });
                        return Promise.resolve({ data: [memoryRow], error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "langclaw_memory_settings") {
        return {
          upsert(...args: unknown[]) {
            calls.push({ args, method: "upsert", table });
            return {
              select(...selectArgs: unknown[]) {
                calls.push({ args: selectArgs, method: "select", table });
                return {
                  single: () => Promise.resolve({ data: settingsRow, error: null }),
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const dashboard = await readMemoryDashboard({
    account: {
      authMethod: "wallet",
      supabase: supabase as never,
      walletUser,
    },
  });

  assert.equal(dashboard.memories[0]?.id, "memory-1");
  assert.deepEqual(dashboard.stats, {
    active: 1,
    disabled: 0,
    projectScoped: 1,
    total: 1,
  });
  assert.ok(
    calls.some(
      (call) =>
        call.table === "langclaw_memories" &&
        call.method === "eq" &&
        call.args[0] === "wallet_user_id" &&
        call.args[1] === walletUser.id,
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.table === "langclaw_memory_settings" &&
        call.method === "upsert" &&
        (call.args[0] as { wallet_user_id?: string }).wallet_user_id === walletUser.id,
    ),
  );
});

test("bulk memory status validation rejects missing ids and unsupported states", async () => {
  const account = {
    authMethod: "wallet" as const,
    supabase: {
      from() {
        throw new Error("validation should finish before querying storage");
      },
    } as never,
    walletUser,
  };

  for (const [memoryIds, status, message] of [
    [undefined, "active", "memoryIds are required."],
    [[], "active", "At least one memory id is required."],
    [
      ["memory-1", 42],
      "active",
      "memoryIds must contain only non-empty strings.",
    ],
    [["memory-1"], "archived", "A valid memory status is required."],
  ] as const) {
    await assert.rejects(
      updateManyMemoryStatuses({ account }, memoryIds, status),
      (error: unknown) =>
        error instanceof MemoryHttpError &&
        error.status === 400 &&
        error.message === message,
    );
  }
});

test("bulk memory status updates trim and deduplicate ids", async () => {
  let updatedStatus = "";
  let scopedWallet = "";
  let selectedIds: string[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_memories");
      return {
        update(payload: { status: string }) {
          updatedStatus = payload.status;
          return {
            eq(column: string, value: string) {
              assert.equal(column, "wallet_user_id");
              scopedWallet = value;
              return {
                in(inColumn: string, ids: string[]) {
                  assert.equal(inColumn, "id");
                  selectedIds = ids;
                  return {
                    select: () => Promise.resolve({ data: [], error: null }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await updateManyMemoryStatuses(
    {
      account: {
        authMethod: "wallet",
        supabase: supabase as never,
        walletUser,
      },
    },
    [" memory-1 ", "memory-1", "memory-2"],
    "disabled",
  );

  assert.deepEqual(result, []);
  assert.equal(updatedStatus, "disabled");
  assert.equal(scopedWallet, walletUser.id);
  assert.deepEqual(selectedIds, ["memory-1", "memory-2"]);
});

test("single memory deletion includes the authenticated wallet scope", async () => {
  const filters: Array<[string, string]> = [];
  const query = {
    eq(column: string, value: string) {
      filters.push([column, value]);
      return query;
    },
    select(column: string) {
      assert.equal(column, "id");
      return {
        maybeSingle: () => Promise.resolve({ data: { id: "memory-1" }, error: null }),
      };
    },
  };
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_memories");
      return {
        delete: () => query,
      };
    },
  };

  const result = await deleteMemory(
    {
      account: {
        authMethod: "wallet",
        supabase: supabase as never,
        walletUser,
      },
    },
    " memory-1 ",
  );

  assert.deepEqual(result, { deleted: true, deletedIds: ["memory-1"] });
  assert.deepEqual(filters, [
    ["id", "memory-1"],
    ["wallet_user_id", walletUser.id],
  ]);
});

test("bulk memory deletion scopes ids to the authenticated wallet", async () => {
  const calls: Array<{ args: unknown[]; method: string }> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_memories");
      return {
        delete() {
          return {
            eq(...args: unknown[]) {
              calls.push({ args, method: "eq" });
              return {
                in(...inArgs: unknown[]) {
                  calls.push({ args: inArgs, method: "in" });
                  return {
                    select(column: string) {
                      calls.push({ args: [column], method: "select" });
                      return Promise.resolve({
                        data: [{ id: "memory-1" }, { id: "memory-2" }],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await deleteManyMemories(
    {
      account: {
        authMethod: "wallet",
        supabase: supabase as never,
        walletUser,
      },
    },
    ["memory-1", "memory-2", "memory-1"],
  );

  assert.deepEqual(result.deletedIds, ["memory-1", "memory-2"]);
  assert.deepEqual(calls, [
    { args: ["wallet_user_id", walletUser.id], method: "eq" },
    { args: ["id", ["memory-1", "memory-2"]], method: "in" },
    { args: ["id"], method: "select" },
  ]);
});

test("memory creation normalizes input and persists wallet ownership", async () => {
  let inserted: Record<string, unknown> | undefined;
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_memories");
      return {
        insert(payload: Record<string, unknown>) {
          inserted = payload;
          return {
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: {
                      ...payload,
                      created_at: "2026-07-18T10:00:00.000Z",
                      id: "memory-created",
                      updated_at: "2026-07-18T10:00:00.000Z",
                    },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  };

  const memory = await createMemory(buildMemoryAccount(supabase), {
    category: "API",
    confidence: 140,
    lastUsed: "2026-07-18T09:30:00.000Z",
    memory: "  Prefer Celo proof routes  ",
    scope: "  Langclaw  ",
    source: "  Manual test  ",
    status: "active",
  });

  assert.equal(memory.id, "memory-created");
  assert.equal(memory.memory, "Prefer Celo proof routes");
  assert.equal(memory.confidence, 100);
  assert.equal(memory.lastUsed, "2026-07-18");
  assert.equal(inserted?.wallet_user_id, walletUser.id);
  assert.deepEqual(inserted?.metadata, {});
});

test("memory creation rejects an unsupported category", async () => {
  const account = buildMemoryAccount({
    from() {
      throw new Error("validation should finish before querying storage");
    },
  });

  await assert.rejects(
    createMemory(account, {
      category: "Security",
      memory: "Keep proof records",
    }),
    (error: unknown) =>
      error instanceof MemoryHttpError &&
      error.status === 400 &&
      error.message === "A valid memory category is required.",
  );
});

test("memory creation rejects an unsupported status", async () => {
  const account = buildMemoryAccount({
    from() {
      throw new Error("validation should finish before querying storage");
    },
  });

  await assert.rejects(
    createMemory(account, {
      memory: "Keep proof records",
      status: "archived",
    }),
    (error: unknown) =>
      error instanceof MemoryHttpError &&
      error.status === 400 &&
      error.message === "A valid memory status is required.",
  );
});

test("memory creation rejects an invalid last-used timestamp", async () => {
  const account = buildMemoryAccount({
    from() {
      throw new Error("validation should finish before querying storage");
    },
  });

  await assert.rejects(
    createMemory(account, {
      lastUsed: "not-a-date",
      memory: "Keep proof records",
    }),
    (error: unknown) =>
      error instanceof MemoryHttpError &&
      error.status === 400 &&
      error.message === "lastUsed must be a valid timestamp.",
  );
});

test("memory settings surface persistence failures after normalization", async () => {
  let updatePayload: Record<string, unknown> | undefined;
  const settingsRow = buildMemorySettingsRow();
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_memory_settings");
      return {
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          const query = {
            eq() {
              return query;
            },
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: null,
                    error: { message: "settings write failed" },
                  }),
              };
            },
          };
          return query;
        },
        upsert() {
          return {
            select() {
              return {
                single: () => Promise.resolve({ data: settingsRow, error: null }),
              };
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    updateMemorySettings(buildMemoryAccount(supabase), {
      captureEnabled: false,
      retentionDays: 9999,
    }),
    (error: unknown) =>
      error instanceof MemoryHttpError &&
      error.status === 500 &&
      error.message === "settings write failed"
  );

  assert.equal(updatePayload?.capture_enabled, false);
  assert.equal(updatePayload?.retention_days, 3650);
  assert.equal(updatePayload?.cross_chat_recall, true);
});

test("memory settings reject malformed boolean fields", async () => {
  for (const field of [
    "autoDisableLowConfidence",
    "captureEnabled",
    "crossChatRecall",
    "projectScopedRecall",
  ] as const) {
    const settingsRow = buildMemorySettingsRow();
    const supabase = {
      from(table: string) {
        assert.equal(table, "langclaw_memory_settings");
        return {
          update() {
            throw new Error("validation should finish before updating storage");
          },
          upsert() {
            return {
              select() {
                return {
                  single: () =>
                    Promise.resolve({ data: settingsRow, error: null }),
                };
              },
            };
          },
        };
      },
    };

    await assert.rejects(
      updateMemorySettings(buildMemoryAccount(supabase), { [field]: "false" }),
      (error: unknown) =>
        error instanceof MemoryHttpError &&
        error.status === 400 &&
        error.message === `${field} must be a boolean.`,
    );
  }
});

test("automation memory persistence honors capture and confidence settings", async () => {
  const persisted: Record<string, unknown>[] = [];
  const settingsRow = buildMemorySettingsRow();
  const context = {
    authMethod: "wallet" as const,
    supabase: {
      from(table: string) {
        if (table === "langclaw_memory_settings") {
          return {
            upsert() {
              return {
                select() {
                  return {
                    single: () =>
                      Promise.resolve({ data: settingsRow, error: null }),
                  };
                },
              };
            },
          };
        }

        assert.equal(table, "langclaw_memories");
        return {
          insert(payload: Record<string, unknown>) {
            persisted.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as never,
    walletUser,
  };

  await writeAutomationRunMemory(context, {
    completedAt: "2026-07-18T10:00:00.000Z",
    error: "Provider timeout",
    project: "Langclaw",
    runId: "run-failed",
    status: "failed",
    taskName: "Celo scan",
  });

  assert.equal(persisted[0].confidence, 72);
  assert.equal(persisted[0].status, "disabled");
  assert.match(String(persisted[0].memory), /Provider timeout/);

  settingsRow.capture_enabled = false;
  await writeAutomationRunMemory(context, {
    completedAt: "2026-07-18T11:00:00.000Z",
    project: "Langclaw",
    runId: "run-complete",
    status: "completed",
    taskName: "Celo scan",
  });
  assert.equal(persisted.length, 1);
});

test("memory error responses distinguish configuration and generic failures", async () => {
  const unavailable = memoryErrorResponse(
    new MemoryHttpError(503, "Memory storage is not configured.")
  );
  const storage = memoryErrorResponse(
    new MemoryHttpError(500, "column langclaw_memories.secret does not exist"),
  );
  const exception = memoryErrorResponse(new Error("database connection failed"));
  const generic = memoryErrorResponse("unexpected");

  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    configured: false,
    error: "Memory storage is not configured.",
  });
  assert.deepEqual(await storage.json(), {
    configured: true,
    error: "Memory request failed.",
  });
  assert.deepEqual(await exception.json(), {
    configured: true,
    error: "Memory request failed.",
  });
  assert.deepEqual(await generic.json(), {
    configured: true,
    error: "Memory request failed.",
  });
});

function buildMemoryAccount(supabase: unknown) {
  return {
    account: {
      authMethod: "wallet" as const,
      supabase: supabase as never,
      walletUser,
    },
  };
}

function buildMemorySettingsRow() {
  return {
    auto_disable_low_confidence: true,
    capture_enabled: true,
    created_at: "2026-07-18T09:00:00.000Z",
    cross_chat_recall: true,
    project_scoped_recall: true,
    retention_days: 90,
    updated_at: "2026-07-18T09:00:00.000Z",
    wallet_user_id: walletUser.id,
  };
}
