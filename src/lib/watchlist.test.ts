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
      gapCount: -3,
      id: "  proof:0xabc  ",
      intent: "  track   accumulation ",
      recommendation: "  Monitor the next block. ",
      signalType: " smart-money ",
      sourceCount: "3" as never,
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
      gapCount: "2.5" as never,
      id: "proof:malformed-counts",
      intent: "track activity",
      recommendation: "Review the evidence.",
      signalType: "smart-money",
      sourceCount: "3sources" as never,
      subject: "CELO",
      summary: "Malformed counts must not inflate evidence.",
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
