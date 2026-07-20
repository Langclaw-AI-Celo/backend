import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAlphaWatchlist,
  deleteAlphaWatchlistItem,
  upsertAlphaWatchlistItem,
  WatchlistHttpError,
  watchlistErrorResponse,
} from "./watchlist";

const walletUser = {
  id: "wallet-user-1",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

test("watchlist errors expose only actionable client messages", async () => {
  const invalid = watchlistErrorResponse(
    new WatchlistHttpError(400, "Watchlist item id is required."),
  );
  const storage = watchlistErrorResponse(
    new WatchlistHttpError(500, "relation langclaw_alpha_watchlist is missing"),
  );
  const unexpected = watchlistErrorResponse(new Error("connection refused"));

  assert.deepEqual(await invalid.json(), {
    configured: true,
    error: "Watchlist item id is required.",
  });
  assert.deepEqual(await storage.json(), {
    configured: true,
    error: "Watchlist request failed.",
  });
  assert.deepEqual(await unexpected.json(), {
    configured: true,
    error: "Watchlist request failed.",
  });
});

test("watchlist upserts normalize input and bind the authenticated wallet", async () => {
  let saved: Record<string, unknown> | undefined;
  let conflict = "";
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_alpha_watchlist");
      return {
        upsert(payload: Record<string, unknown>, options: { onConflict: string }) {
          saved = payload;
          conflict = options.onConflict;
          return {
            select(columns: string) {
              assert.equal(columns, "*");
              return {
                single: () =>
                  Promise.resolve({
                    data: {
                      ...payload,
                      created_at: "2026-07-17T05:00:00.000Z",
                      updated_at: "2026-07-17T05:00:00.000Z",
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

  const item = await upsertAlphaWatchlistItem(
    {
      account: {
        authMethod: "wallet",
        supabase: supabase as never,
        walletUser,
      },
    },
    {
      addedAt: "2026-07-17T12:00:00+07:00",
      caveat: "  Confirm   liquidity first. ",
      chain: "",
      evidenceUri: "e".repeat(750),
      gapCount: 0,
      id: "  proof:0xabc  ",
      intent: "  track   accumulation ",
      recommendation: "  Monitor the next block. ",
      signalType: " smart-money ",
      sourceCount: 3,
      subject: " CELO ",
      summary: "  Wallets   accumulated CELO. ",
      title: "  CELO   signal ",
    },
  );

  assert.equal(conflict, "wallet_user_id,id");
  assert.equal(saved?.wallet_user_id, walletUser.id);
  assert.equal(saved?.added_at, "2026-07-17T05:00:00.000Z");
  assert.equal(saved?.id, "proof:0xabc");
  assert.equal(saved?.chain, "celo");
  assert.equal(saved?.source_count, 3);
  assert.equal(saved?.gap_count, 0);
  assert.equal(saved?.evidence_uri, "e".repeat(750));
  assert.equal(saved?.title, "CELO signal");
  assert.equal(saved?.intent, "track accumulation");
  assert.equal(item.summary, "Wallets accumulated CELO.");

  await upsertAlphaWatchlistItem(
    {
      account: {
        authMethod: "wallet",
        supabase: supabase as never,
        walletUser,
      },
    },
    {
      caveat: "Verify the source.",
      id: "proof:omitted-counts",
      intent: "track activity",
      recommendation: "Review the evidence.",
      signalType: "smart-money",
      subject: "CELO",
      summary: "Omitted counts default to zero.",
      title: "CELO evidence",
    },
  );

  assert.equal(saved?.source_count, 0);
  assert.equal(saved?.gap_count, 0);

  await assert.rejects(
    upsertAlphaWatchlistItem(
      {
        account: {
          authMethod: "wallet",
          supabase: supabase as never,
          walletUser,
        },
      },
      {
        addedAt: "not-a-date",
        caveat: "Verify the source.",
        id: "proof:invalid-date",
        intent: "track activity",
        recommendation: "Review the evidence.",
        signalType: "smart-money",
        subject: "CELO",
        summary: "The timestamp must remain trustworthy.",
        title: "CELO evidence",
      },
    ),
    (error) =>
      error instanceof WatchlistHttpError &&
      error.status === 400 &&
      error.message === "Added at must be a valid date.",
  );
});

test("watchlist upserts reject malformed optional text fields", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };
  const baseInput = {
    caveat: "Verify the source.",
    id: "proof:optional-text",
    intent: "track activity",
    recommendation: "Review the evidence.",
    signalType: "smart-money",
    subject: "CELO",
    summary: "Optional metadata must keep its declared shape.",
    title: "CELO evidence",
  };

  for (const [field, value] of [
    ["agentId", 42],
    ["decisionHash", {}],
    ["decisionId", []],
    ["evidenceUri", false],
    ["explorerUrl", 7],
    ["proofTx", null],
  ] as const) {
    await assert.rejects(
      upsertAlphaWatchlistItem(account, { ...baseInput, [field]: value }),
      (error: unknown) =>
        error instanceof WatchlistHttpError &&
        error.status === 400 &&
        error.message === `${field} must be a string.`,
    );
  }
});

test("watchlist upserts reject overlong required text", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };

  await assert.rejects(
    upsertAlphaWatchlistItem(account, {
      caveat: "Verify the source.",
      id: "proof:overlong-title",
      intent: "track activity",
      recommendation: "Review the evidence.",
      signalType: "smart-money",
      subject: "CELO",
      summary: "Required metadata must not be silently truncated.",
      title: "x".repeat(501),
    }),
    (error: unknown) =>
      error instanceof WatchlistHttpError &&
      error.status === 400 &&
      error.message === "Title must be at most 500 characters.",
  );
});

test("watchlist upserts reject overlong optional text", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };

  await assert.rejects(
    upsertAlphaWatchlistItem(account, {
      caveat: "Verify the source.",
      evidenceUri: "e".repeat(1_001),
      id: "proof:overlong-evidence-uri",
      intent: "track activity",
      recommendation: "Review the evidence.",
      signalType: "smart-money",
      subject: "CELO",
      summary: "Optional metadata must not be silently truncated.",
      title: "CELO evidence",
    }),
    (error: unknown) =>
      error instanceof WatchlistHttpError &&
      error.status === 400 &&
      error.message === "evidenceUri must be at most 1000 characters.",
  );
});

test("watchlist upserts reject invalid on-chain identifiers", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };
  const baseInput = {
    caveat: "Verify the source.",
    id: "proof:invalid-identifier",
    intent: "track activity",
    recommendation: "Review the evidence.",
    signalType: "smart-money",
    subject: "CELO",
    summary: "On-chain identifiers must retain their uint256 meaning.",
    title: "CELO evidence",
  };

  for (const [field, value] of [
    ["agentId", "-1"],
    ["agentId", "01"],
    ["decisionId", "0x2"],
    ["decisionId", (1n << 256n).toString()],
  ] as const) {
    await assert.rejects(
      upsertAlphaWatchlistItem(account, { ...baseInput, [field]: value }),
      (error: unknown) =>
        error instanceof WatchlistHttpError &&
        error.status === 400 &&
        error.message ===
          `${field} must be a canonical unsigned 256-bit decimal integer.`,
    );
  }
});

test("watchlist upserts reject invalid on-chain hashes", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };
  const baseInput = {
    caveat: "Verify the source.",
    decisionHash: `0x${"a".repeat(64)}`,
    id: "proof:invalid-hash",
    intent: "track activity",
    proofTx: `0x${"b".repeat(64)}`,
    recommendation: "Review the evidence.",
    signalType: "smart-money",
    subject: "CELO",
    summary: "On-chain hashes must retain their bytes32 meaning.",
    title: "CELO evidence",
  };

  for (const [field, value] of [
    ["decisionHash", "0xabc"],
    ["proofTx", `0x${"g".repeat(64)}`],
  ] as const) {
    await assert.rejects(
      upsertAlphaWatchlistItem(account, { ...baseInput, [field]: value }),
      (error: unknown) =>
        error instanceof WatchlistHttpError &&
        error.status === 400 &&
        error.message === `${field} must be a 32-byte hexadecimal hash.`,
    );
  }
});

test("watchlist upserts reject unsafe explorer URLs", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };
  const baseInput = {
    caveat: "Verify the source.",
    id: "proof:unsafe-explorer-url",
    intent: "track activity",
    recommendation: "Review the evidence.",
    signalType: "smart-money",
    subject: "CELO",
    summary: "Explorer links are opened in a new browser tab.",
    title: "CELO evidence",
  };

  for (const explorerUrl of [
    "javascript:alert(1)",
    "https://user:secret@celoscan.io/tx/0xabc",
  ]) {
    await assert.rejects(
      upsertAlphaWatchlistItem(account, { ...baseInput, explorerUrl }),
      (error: unknown) =>
        error instanceof WatchlistHttpError &&
        error.status === 400 &&
        error.message ===
          "explorerUrl must be an HTTPS URL without credentials.",
    );
  }
});

test("watchlist upserts reject invalid evidence counts", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };
  const baseInput = {
    caveat: "Verify the source.",
    id: "proof:invalid-count",
    intent: "track activity",
    recommendation: "Review the evidence.",
    signalType: "smart-money",
    subject: "CELO",
    summary: "Evidence counts must be non-negative integers.",
    title: "CELO evidence",
  };

  for (const [field, value] of [
    ["gapCount", -1],
    ["gapCount", 1.5],
    ["gapCount", "2"],
    ["sourceCount", -1],
    ["sourceCount", 1.5],
    ["sourceCount", "3"],
  ] as const) {
    await assert.rejects(
      upsertAlphaWatchlistItem(account, { ...baseInput, [field]: value }),
      (error: unknown) =>
        error instanceof WatchlistHttpError &&
        error.status === 400 &&
        error.message === `${field} must be a non-negative integer.`,
    );
  }
});

test("watchlist upserts reject future added timestamps", async () => {
  const account = {
    account: {
      authMethod: "wallet" as const,
      supabase: {
        from() {
          throw new Error("validation should finish before querying storage");
        },
      } as never,
      walletUser,
    },
  };

  await assert.rejects(
    upsertAlphaWatchlistItem(account, {
      addedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      caveat: "Verify the source.",
      id: "proof:future-time",
      intent: "track activity",
      recommendation: "Review the evidence.",
      signalType: "smart-money",
      subject: "CELO",
      summary: "The watchlist timestamp must remain trustworthy.",
      title: "CELO evidence",
    }),
    (error: unknown) =>
      error instanceof WatchlistHttpError &&
      error.status === 400 &&
      error.message === "Added at cannot be in the future.",
  );
});

test("clearing a watchlist deletes only the authenticated wallet rows", async () => {
  const filters: Array<[string, string]> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "langclaw_alpha_watchlist");
      return {
        delete() {
          return {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  const result = await clearAlphaWatchlist({
    account: {
      authMethod: "wallet",
      supabase: supabase as never,
      walletUser,
    },
  });

  assert.deepEqual(result, { cleared: true });
  assert.deepEqual(filters, [["wallet_user_id", walletUser.id]]);
});

test("deleting a missing watchlist item returns not found", async () => {
  const supabase = {
    from() {
      const query = {
        eq() {
          return query;
        },
        select() {
          return {
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          };
        },
      };

      return {
        delete: () => query,
      };
    },
  };

  await assert.rejects(
    deleteAlphaWatchlistItem(
      {
        account: {
          authMethod: "wallet",
          supabase: supabase as never,
          walletUser,
        },
      },
      "missing-item"
    ),
    (error) =>
      error instanceof WatchlistHttpError &&
      error.status === 404 &&
      error.message === "Watchlist item was not found."
  );
});
