import assert from "node:assert/strict";
import test from "node:test";

import { runProviderDiscovery } from "./providers";
import { runLangclawWorkflow } from "./workflow";
import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";

test("Mantle workflow exposes Surf and Elfa provider trace when premium discovery is enabled", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.asksurf.ai" &&
      parsed.pathname === "/gateway/v1/search/web"
    ) {
      assert.equal(parsed.searchParams.get("q"), "Mantle AI agent market signal");

      return jsonResponse({
        data: [
          {
            content: "Mantle AI agent launches are attracting market attention.",
            title: "Mantle market signal",
            url: "https://surf.test/mantle-market-signal",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.elfa.ai" &&
      parsed.pathname === "/v2/data/trending-narratives"
    ) {
      return jsonResponse({
        data: {
          trending_narratives: [
            {
              mention_count: 42,
              name: "AI agents on Mantle",
              narrative: "AI agents on Mantle",
              sentiment: "bullish",
              source_links: ["https://x.com/example/status/1"],
            },
          ],
        },
        success: true,
      });
    }

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Mantle Turing Test Hackathon</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({ data: [] });
  });

  try {
    await withEnv(
      {
        ELFA_API_KEY: "elfa-test-key",
        ELFA_ENABLED: "true",
        MANTLE_CHAIN_ENABLED: "false",
        OPENAI_API_KEY: "",
        OPENCLAW_ENABLED: "false",
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const payload = await runLangclawWorkflow(
          "Mantle AI agent market signal",
          { chain: "mantle" }
        );

        assert.ok(payload.sources.some((source) => source.provider === "Surf"));
        assert.ok(payload.sources.some((source) => source.provider === "Elfa"));
        assert.ok(
          payload.providerTrace?.some(
            (entry) => entry.provider === "Surf" && entry.status === "success"
          )
        );
        assert.ok(
          payload.providerTrace?.some(
            (entry) => entry.provider === "Elfa" && entry.status === "success"
          )
        );
      }
    );
  } finally {
    restore();
  }
});

test("premium research providers are skipped outside Mantle scope", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Celo builders</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({ data: [] });
  });

  try {
    const result = await runProviderDiscovery("Find smart money on Celo", {
      chain: "celo",
    });

    assert.ok(
      result.providerTrace.some(
        (entry) =>
          entry.provider === "Surf" &&
          entry.status === "skipped" &&
          entry.scope === "out-of-scope"
      )
    );
    assert.ok(
      result.providerTrace.some(
        (entry) =>
          entry.provider === "Elfa" &&
          entry.status === "skipped" &&
          entry.scope === "out-of-scope"
      )
    );
  } finally {
    restore();
  }
});

test("Mantle workflow returns combined live signals for broad prompts that now run on-chain enrichment", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.asksurf.ai" &&
      parsed.pathname === "/gateway/v1/search/web"
    ) {
      return jsonResponse({
        data: [
          {
            content: "Mantle AI agent market narratives are active.",
            title: "Mantle market context",
            url: "https://surf.test/mantle-market-context-1",
          },
          {
            content: "Mantle liquidity is improving across major pools.",
            title: "Mantle liquidity context",
            url: "https://surf.test/mantle-market-context-2",
          },
          {
            content: "Mantle builders are shipping new agent tooling.",
            title: "Mantle builder context",
            url: "https://surf.test/mantle-market-context-3",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.elfa.ai" &&
      parsed.pathname === "/v2/data/trending-narratives"
    ) {
      return jsonResponse({
        data: {
          trending_narratives: [
            {
              mention_count: 18,
              name: "Mantle AI agents",
              narrative: "Mantle AI agents",
              sentiment: "bullish",
              source_links: ["https://x.com/example/status/2"],
            },
          ],
        },
        success: true,
      });
    }

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/latest/dex/search"
    ) {
      return jsonResponse({
        pairs: [
          {
            baseToken: { symbol: "MNT" },
            chainId: "mantle",
            dexId: "agni",
            liquidity: { usd: 245000 },
            priceUsd: "1.03",
          },
        ],
      });
    }

    if (parsed.hostname === "www.hackquest.io") {
      return new Response("<html><body>Mantle Turing Test Hackathon</body></html>", {
        headers: {
          "Content-Type": "text/html",
        },
      });
    }

    return jsonResponse({
      data: [],
      pairs: [],
      results: [],
      web: { results: [] },
    });
  });

  try {
    await withEnv(
      {
        ELFA_API_KEY: "elfa-test-key",
        ELFA_ENABLED: "true",
        MANTLE_CHAIN_ENABLED: "false",
        OPENAI_API_KEY: "",
        OPENCLAW_ENABLED: "false",
        SURF_API_KEY: "surf-test-key",
        SURF_ENABLED: "true",
      },
      async () => {
        const payload = await runLangclawWorkflow(
          "Mantle AI agent market narrative",
          { chain: "mantle" }
        );

        assert.ok(payload.onChain);
        assert.equal(payload.onChainSkippedReason, undefined);
        assert.equal(payload.signals.social.status, "success");
        assert.equal(payload.signals.onchain.status, "success");
        assert.equal(payload.signals.combined.status, "success");
        assert.ok(payload.signals.social.providers.includes("Elfa"));
        assert.ok(payload.signals.onchain.providers.includes("Surf"));
        assert.ok(payload.signals.onchain.toolIds.length > 0);
        assert.match(payload.signals.combined.summary, /converg/i);
      }
    );
  } finally {
    restore();
  }
});
