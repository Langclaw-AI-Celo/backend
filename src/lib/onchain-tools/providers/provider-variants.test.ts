import assert from "node:assert/strict";
import test from "node:test";

import { jsonResponse, mockFetch, withEnv } from "../../../test/helpers";
import {
  getCoinMarkets,
  searchCoin,
  summarizeCoinGeckoPayload,
} from "./coingecko";
import {
  getAccountBalance,
  getCode,
  getTokenBalance,
  getTokenTransfers,
  getTxList,
} from "./etherscan";
import {
  getNetworkNewPools,
  getNetworkTrendingPools,
  getPoolData,
  getTokenData,
  getTokenInfo,
  getTokenTopHolders,
  summarizeGeckoTerminalPayload,
} from "./geckoterminal";
import {
  getChains,
  getProtocol,
  getProtocols,
  getStablecoins,
  getYieldPools,
  normalizeProtocolSlug,
} from "./defillama";
import {
  getLatestBoostedTokens,
  getLatestTokenProfiles,
  getPaidOrders,
  getPairSnapshot,
  getTokenPairs,
  getTokenSnapshot,
  getTopBoostedTokens,
  searchPairs,
} from "./dexscreener";
import { getAddressSecurity, getTokenSecurity } from "./goplus";
import {
  getAssetTransfers,
  getTokenBalances,
  getTokenMetadata as getAlchemyTokenMetadata,
} from "./alchemy";

const walletAddress = "0x1111111111111111111111111111111111111111";
const tokenAddress = "0x2222222222222222222222222222222222222222";

test("Etherscan adapters validate inputs and summarize response variants", async () => {
  const seenSourceKeys: string[] = [];
  const restoreFetch = mockFetch((url) => {
    const parsed = new URL(url);
    const action = parsed.searchParams.get("action") ?? "";
    seenSourceKeys.push(action);
    assert.equal(parsed.searchParams.get("apikey"), "etherscan-test-key");
    assert.equal(parsed.searchParams.get("chainid"), "42220");

    const payloads: Record<string, unknown> = {
      balance: { message: "OK", result: "123456789", status: "1" },
      eth_getCode: null,
      tokenbalance: { message: "OK", result: ["unexpected-array"] },
      tokentx: {
        result: [
          {
            from: walletAddress,
            hash: `0x${"a".repeat(64)}`,
            to: tokenAddress,
            tokenDecimal: "6",
            tokenSymbol: "USDT",
            value: "1500000",
          },
          {
            from: tokenAddress,
            to: walletAddress,
            tokenDecimal: "99",
            tokenSymbol: "CELO",
            value: "5000000",
          },
          {
            from: walletAddress,
            to: tokenAddress,
            tokenDecimal: "invalid",
            value: "not-a-number",
          },
          { from: walletAddress, value: "1" },
        ],
      },
      txlist: { result: [{ hash: "0x1" }, { hash: "0x2" }] },
    };

    assert.ok(action in payloads);
    return jsonResponse(payloads[action]);
  });

  try {
    await withEnv({ ETHERSCAN_API_KEY: "etherscan-test-key" }, async () => {
      await assert.rejects(
        getAccountBalance({ chain: "celo" }),
        /wallet address is required/
      );
      await assert.rejects(
        getTokenTransfers({ chain: "celo" }),
        /wallet address or token address is required/
      );
      await assert.rejects(
        getTokenBalance({ chain: "celo", walletAddress }),
        /token address is required/
      );
      await assert.rejects(getCode({ chain: "celo" }), /token address is required/);

      const balance = await getAccountBalance({ chain: "celo", walletAddress });
      const transfers = await getTokenTransfers({
        chain: "celo",
        tokenAddress,
        walletAddress,
      });
      const txs = await getTxList({ chain: "celo", walletAddress });
      const token = await getTokenBalance({
        chain: "celo",
        tokenAddress,
        walletAddress,
      });
      const code = await getCode({ chain: "celo", tokenAddress });

      assert.match(balance.summary, /OK: 123456789/);
      assert.match(transfers.summary, /3 records returned/);
      assert.match(transfers.summary, /latest 1\.5 USDT/);
      assert.match(transfers.summary, /unique sender/);
      assert.match(txs.summary, /2 records returned/);
      assert.match(token.summary, /1 records returned/);
      assert.equal(code.data, null);
      assert.ok(balance.sourceUrl.includes("apikey=redacted"));
      assert.deepEqual(seenSourceKeys.sort(), [
        "balance",
        "eth_getCode",
        "tokenbalance",
        "tokentx",
        "txlist",
      ]);
    });
  } finally {
    restoreFetch();
  }
});

test("CoinGecko adapters resolve tickers, cleaned names, empty matches, and markets", async () => {
  const restoreFetch = mockFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(
      new Headers(init?.headers).get("x-cg-demo-api-key"),
      "coingecko-test-key"
    );

    if (parsed.pathname.endsWith("/search")) {
      const query = parsed.searchParams.get("query");

      if (query === "UNKNOWN") {
        return jsonResponse({ coins: [] });
      }

      return jsonResponse({
        coins: [
          null,
          { id: "missing-fields" },
          {
            id: "celo",
            market_cap_rank: 120,
            name: "Celo",
            symbol: "celo",
          },
          {
            id: "celo-dollar",
            market_cap_rank: 900,
            name: "Celo Dollar",
            symbol: "cusd",
          },
        ],
      });
    }

    assert.equal(parsed.pathname, "/api/v3/coins/markets");
    return jsonResponse([
      {
        current_price: 0.42,
        id: "celo",
        market_cap: 250000000,
        symbol: "celo",
      },
    ]);
  });

  try {
    await withEnv(
      {
        CG_API_KEY: "coingecko-test-key",
        COINGECKO_API_KEY: undefined,
      },
      async () => {
        await assert.rejects(searchCoin({ query: "   " }), /coin name or symbol/);

        const ticker = await searchCoin({ query: "Analyze CELO price" });
        const cleaned = await searchCoin({ query: "find Celo token market" });
        const empty = await searchCoin({ query: "UNKNOWN" });
        const market = await getCoinMarkets({ query: "CELO" });

        assert.match(ticker.summary, /coin id celo/);
        assert.equal((ticker.data as { query: string }).query, "CELO");
        assert.equal((cleaned.data as { query: string }).query, "Celo");
        assert.match(empty.summary, /no listed asset match/);
        assert.match(market.summary, /market data for Celo/);
        assert.equal(
          (market.data as { market: { current_price: number } }).market
            .current_price,
          0.42
        );
        assert.match(summarizeCoinGeckoPayload({ coin: "CELO" }), /CELO/);
      }
    );
  } finally {
    restoreFetch();
  }
});

test("GeckoTerminal adapters resolve network aliases and pool response variants", async () => {
  const restoreFetch = mockFetch((url, init) => {
    const parsed = new URL(url);
    assert.equal(
      new Headers(init?.headers).get("x-cg-demo-api-key"),
      "gecko-test-key"
    );

    if (parsed.pathname.endsWith("/networks")) {
      return jsonResponse({
        data: [
          null,
          { id: "missing-name", attributes: {} },
          { id: "celo", attributes: { name: "Celo" } },
          {
            id: "mantle-network",
            attributes: {
              coingecko_asset_platform_id: "mantle",
              name: "Mantle Network",
            },
          },
          {
            id: "ethereum-network",
            attributes: { name: "Ethereum" },
          },
        ],
      });
    }

    if (parsed.pathname.endsWith("/trending_pools")) {
      return jsonResponse({
        data: [
          {
            attributes: {
              name: "CELO / USDT",
              reserve_in_usd: "250000",
              volume_usd: "50000",
            },
          },
        ],
      });
    }

    if (parsed.pathname.endsWith("/new_pools")) {
      return jsonResponse({ data: [] });
    }

    return jsonResponse({ data: { id: "provider-data" } });
  });

  try {
    await withEnv(
      {
        CG_API_KEY: undefined,
        COINGECKO_API_KEY: "gecko-test-key",
      },
      async () => {
        await assert.rejects(
          getPoolData({ chain: "celo" }),
          /pool address is required/
        );
        await assert.rejects(
          getTokenData({ chain: "celo" }),
          /token address is required/
        );

        const trending = await getNetworkTrendingPools({ chain: "celo" });
        const newPools = await getNetworkNewPools({ chain: "mantle" });
        const pool = await getPoolData({
          chain: "ethereum",
          pairAddress: walletAddress,
        });
        const token = await getTokenData({ chain: "celo", tokenAddress });
        const info = await getTokenInfo({ chain: "celo", tokenAddress });
        const holders = await getTokenTopHolders({ chain: "celo", tokenAddress });

        assert.match(trending.summary, /Top pool: CELO \/ USDT/);
        assert.match(trending.summary, /reserve \$250000/);
        assert.match(newPools.summary, /No pools returned/);
        assert.match(pool.sourceUrl, /ethereum-network/);
        assert.match(token.summary, /token data/);
        assert.match(info.summary, /token info/);
        assert.match(holders.summary, /holder concentration/);
        assert.match(summarizeGeckoTerminalPayload(["celo"]), /celo/);

        await assert.rejects(
          getTokenData({ chain: "arbitrum", tokenAddress }),
          /network mapping was not found/
        );
      }
    );
  } finally {
    restoreFetch();
  }
});

test("DeFiLlama adapters cover lists, protocol slugs, pools, and stablecoins", async () => {
  const payloads: unknown[] = [
    [{ name: "Aave" }, { name: "Uniswap" }],
    { chain: "Celo", tvl: 10 },
    { name: "Aave V3", tvl: 20 },
    { data: [{ chain: "Celo" }, { chain: "Ethereum" }] },
    { data: [{ chain: "Ethereum" }] },
    {
      peggedAssets: [
        { symbol: "USDT" },
        { name: "USD Coin" },
        {},
        { symbol: "DAI" },
      ],
    },
    { peggedAssets: [] },
    { peggedAssets: [{}] },
  ];
  const urls: string[] = [];
  let index = 0;
  const restoreFetch = mockFetch((url) => {
    urls.push(url);
    const payload = payloads[index];
    index += 1;
    return jsonResponse(payload);
  });

  try {
    await assert.rejects(
      getProtocol({ chain: "celo", query: "protocol list" }),
      /protocol slug or query is required/
    );

    const protocols = await getProtocols({ chain: "celo" });
    const chains = await getChains({ chain: "celo" });
    const protocol = await getProtocol({
      chain: "celo",
      protocolSlug: "aave-v3",
    });
    const matchingPools = await getYieldPools({ chain: "celo" });
    const unfilteredPools = await getYieldPools({ chain: "celo" });
    const stablecoins = await getStablecoins({ chain: "celo" });
    const emptyStablecoins = await getStablecoins({ chain: "celo" });
    const unnamedStablecoins = await getStablecoins({ chain: "celo" });

    assert.match(protocols.summary, /2 records returned/);
    assert.match(chains.summary, /Celo/);
    assert.match(protocol.summary, /aave-v3/);
    assert.match(matchingPools.summary, /1 yield pools matching celo/);
    assert.deepEqual(unfilteredPools.data, { data: [{ chain: "Ethereum" }] });
    assert.match(stablecoins.summary, /4 pegged asset records/);
    assert.match(stablecoins.summary, /USDT, USD Coin/);
    assert.match(emptyStablecoins.summary, /No pegged asset records/);
    assert.match(unnamedStablecoins.summary, /1 pegged asset records returned\./);
    assert.equal(urls.length, payloads.length);
    assert.equal(normalizeProtocolSlug("Aave protocol"), "aave");
    assert.equal(normalizeProtocolSlug("protocol tvl aave-v3"), "aave-v3");
    assert.equal(normalizeProtocolSlug("for uniswap-v3"), "uniswap-v3");
    assert.equal(normalizeProtocolSlug("AAVE-V3"), "aave-v3");
    assert.equal(normalizeProtocolSlug(undefined), "");
    assert.equal(normalizeProtocolSlug("mantle"), "");
  } finally {
    restoreFetch();
  }
});

test("DEX Screener adapters validate addresses and normalize response shapes", async () => {
  const payloads: unknown[] = [
    [{ tokenAddress }],
    { boosts: 1 },
    [{ tokenAddress }, { tokenAddress: walletAddress }],
    {
      pairs: [
        {
          baseToken: { symbol: "CELO" },
          chainId: "celo",
          dexId: "ubeswap",
          liquidity: { usd: 125000.4 },
          priceUsd: "0.42",
        },
        { chainId: "mantle" },
        null,
      ],
    },
    [
      { chainId: "celo", dexId: "uniswap" },
      { chainId: "mantle" },
    ],
    "unexpected",
    [{ chainId: "celo" }],
    { pairs: [{ chainId: "celo" }] },
    { pairs: [] },
    [{ type: "tokenProfile" }],
    [{}],
  ];
  let index = 0;
  const restoreFetch = mockFetch(() => {
    const payload = payloads[index];
    index += 1;
    return jsonResponse(payload);
  });

  try {
    await assert.rejects(searchPairs({ chain: "celo" }), /search query is required/);
    await assert.rejects(getTokenPairs({ chain: "celo" }), /token address is required/);
    await assert.rejects(getTokenSnapshot({ chain: "celo" }), /token address is required/);
    await assert.rejects(getPaidOrders({ chain: "celo" }), /token address is required/);
    await assert.rejects(getPairSnapshot({ chain: "celo" }), /pair address is required/);

    const profiles = await getLatestTokenProfiles({ chain: "celo" });
    const latestBoosts = await getLatestBoostedTokens({ chain: "celo" });
    const topBoosts = await getTopBoostedTokens({ chain: "celo" });
    const objectSearch = await searchPairs({ chain: "celo", query: "CELO" });
    const arraySearch = await searchPairs({ chain: "celo", query: "USDT" });
    const primitiveSearch = await searchPairs({ chain: "celo", query: "empty" });
    const tokenPairs = await getTokenPairs({ chain: "celo", tokenAddress });
    const tokenSnapshot = await getTokenSnapshot({ chain: "celo", tokenAddress });
    const pairSnapshot = await getPairSnapshot({
      chain: "celo",
      pairAddress: "short-pair",
    });
    const paidOrders = await getPaidOrders({ chain: "celo", tokenAddress });
    const metadataFreePair = await getPairSnapshot({
      chain: "celo",
      pairAddress: "tiny",
    });

    assert.match(profiles.summary, /1 records returned/);
    assert.match(latestBoosts.summary, /boosts/);
    assert.match(topBoosts.summary, /2 records returned/);
    assert.equal((objectSearch.data as { pairs: unknown[] }).pairs.length, 1);
    assert.equal((arraySearch.data as unknown[]).length, 1);
    assert.equal(primitiveSearch.data, "unexpected");
    assert.match(objectSearch.summary, /CELO on ubeswap price 0.42 liquidity \$125,000/);
    assert.match(tokenPairs.summary, /1 pairs returned/);
    assert.match(tokenSnapshot.summary, /1 pairs returned/);
    assert.match(pairSnapshot.summary, /No pairs returned/);
    assert.match(paidOrders.summary, /1 records returned/);
    assert.match(metadataFreePair.summary, /token on DEX/);
    assert.equal(index, payloads.length);
  } finally {
    restoreFetch();
  }
});

test("GoPlus adapters summarize flags and honor optional credentials", async () => {
  const payloads: unknown[] = [
    {
      result: {
        [tokenAddress]: {
          buy_tax: "0.01",
          can_take_back_ownership: "0",
          is_blacklisted: 1,
          is_honeypot: "1",
          is_mintable: true,
          is_proxy: 0,
          sell_tax: "0.02",
        },
      },
    },
    { result: {} },
    "clean",
    { result: "safe" },
    { result: { short: {} } },
  ];
  const headers: Headers[] = [];
  let index = 0;
  const restoreFetch = mockFetch((_url, init) => {
    headers.push(new Headers(init?.headers));
    const payload = payloads[index];
    index += 1;
    return jsonResponse(payload);
  });

  try {
    await assert.rejects(getTokenSecurity({ chain: "ethereum" }), /token address is required/);
    await assert.rejects(getAddressSecurity({ chain: "ethereum" }), /wallet address is required/);
    await assert.rejects(
      getTokenSecurity({ chain: "celo", tokenAddress }),
      /GoPlus is not configured/
    );

    await withEnv(
      {
        GOPLUS_API_KEY: "goplus-key",
        GOPLUS_API_SECRET: "goplus-secret",
      },
      async () => {
        const flagged = await getTokenSecurity({ chain: "ethereum", tokenAddress });
        const missing = await getTokenSecurity({ chain: "ethereum", tokenAddress });
        const primitive = await getTokenSecurity({ chain: "ethereum", tokenAddress });
        assert.match(flagged.summary, /honeypot, blacklist, mintable/);
        assert.match(flagged.summary, /buy tax 0.01 sell tax 0.02/);
        assert.match(missing.summary, /result/);
        assert.match(primitive.summary, /clean/);
      }
    );
    await withEnv(
      { GOPLUS_API_KEY: undefined, GOPLUS_API_SECRET: undefined },
      async () => {
        const address = await getAddressSecurity({
          chain: "ethereum",
          walletAddress,
        });
        const unflagged = await getTokenSecurity({
          chain: "ethereum",
          tokenAddress: "short",
        });
        assert.match(address.summary, /safe/);
        assert.match(unflagged.summary, /No critical flag summary returned/);
      }
    );
    assert.equal(headers[0].get("X-API-KEY"), "goplus-key");
    assert.equal(headers[0].get("X-API-SECRET"), "goplus-secret");
    assert.equal(headers[3].get("X-API-KEY"), null);
  } finally {
    restoreFetch();
  }
});

test("Alchemy adapters validate configuration and emit each RPC method", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const restoreFetch = mockFetch((_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return jsonResponse({ result: { ok: true } });
  });

  try {
    await assert.rejects(getTokenBalances({ chain: "celo" }), /wallet address is required/);
    await assert.rejects(getAlchemyTokenMetadata({ chain: "celo" }), /token address is required/);
    await assert.rejects(
      getTokenBalances({ chain: "bnb", walletAddress }),
      /Alchemy is not configured/
    );
    await withEnv({ ALCHEMY_API_KEY: undefined }, async () => {
      await assert.rejects(
        getTokenBalances({ chain: "celo", walletAddress }),
        /ALCHEMY_API_KEY is not configured/
      );
    });

    await withEnv({ ALCHEMY_API_KEY: "alchemy-key" }, async () => {
      const balances = await getTokenBalances({ chain: "celo", walletAddress });
      const transfers = await getAssetTransfers({ chain: "celo", walletAddress });
      const metadata = await getAlchemyTokenMetadata({ chain: "celo", tokenAddress });
      const shortMetadata = await getAlchemyTokenMetadata({
        chain: "celo",
        tokenAddress: "short",
      });
      assert.match(balances.sourceUrl, /redacted/);
      assert.match(transfers.summary, /inbound transfers/);
      assert.match(metadata.summary, /token metadata/);
      assert.match(shortMetadata.summary, /short/);
    });

    assert.deepEqual(
      requests.map((request) => request.method),
      [
        "alchemy_getTokenBalances",
        "alchemy_getAssetTransfers",
        "alchemy_getTokenMetadata",
        "alchemy_getTokenMetadata",
      ]
    );
  } finally {
    restoreFetch();
  }
});
