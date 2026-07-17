import assert from "node:assert/strict";
import test from "node:test";

import { readMemoryDashboard } from "./memory";

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
