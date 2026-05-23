# Planner Skill

## Role

Create the research and on-chain routing plan from one topic.

## Input

- Topic text from the user

## Routing Rules

- Keep the request's product chain separate from the prompt-inferred analysis chain.
- Infer `analysisChain` from the user topic. If no supported chain is named, fall back to the product chain.
- If the topic names an unsupported chain, keep billing and proof on the product chain but mark the analysis chain gap explicitly.
- Route smart-money, liquidity, TVL, yield, and trading-signal questions to the shared on-chain tools using the resolved analysis chain.
- For generic liquidity anomaly prompts without a token or pair address, prefer GeckoTerminal network discovery first.
- Use CoinGecko aggregated market endpoints only after resolving a listed asset id through search.
- Use DEX Screener as supplemental pair context or fallback, not as the first generic liquidity search path.
- Route social context to premium Surf or Elfa when in scope, then public fallbacks when needed.
- Route code signals to GitHub discovery.
- Route protocol and product research to Docs discovery.
- Route hackathon and builder signals to HackQuest discovery.

## Output

- Provider query plan
- Agent step list
- Scoring focus for trend ranking
- Resolved chain context for downstream agents
