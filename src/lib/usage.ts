import { randomUUID } from "node:crypto";

import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";

import {
  AccountAuthError,
  createVerifiedWalletAccount,
  requireAccountAuth,
  requireWalletAccount,
  type AccountAuthInput,
} from "./server/account-auth";
import {
  getProductChain,
  readChainEnv,
  type ProductChainConfig,
  type ProductChainId,
} from "./chain-config";
import {
  createWalletSessionForVerifiedAddress,
  type WalletAuthInput,
} from "./server/wallet-auth";
import { getSupabaseAdmin } from "./supabase/server";
import type {
  ModelUsageReceipt,
  ZeroGComputeStatus,
  ZeroGTokenUsage,
} from "./langclaw/types";
import { getDefaultOpenAIModel, getOpenAIBaseUrl } from "./openai/responses";
import {
  applyMarkupNeuron,
  buildUsageMeter,
  calculateMarkupNeuron,
  calculateTokenCostNeuron,
  mapUiTokenUsage,
  type ProviderUsageTrace,
  readUsageMarkupBps,
  selectUsageCost,
} from "./usage-pricing";

type UsageWallet = {
  address: string;
};

type UsageAccountRow = {
  available_neuron: string | number;
  chain_id?: string | number;
  chain_slug?: string;
  reserved_neuron: string | number;
  native_symbol?: string;
  lifetime_charged_neuron: string | number;
  lifetime_deposited_neuron: string | number;
  wallet_address: string;
  wallet_user_id: string;
};

type UsageRpcRow = Record<string, unknown>;

export type UsageQuoteInput = {
  chain?: ProductChainId;
  estimatedCompletionTokens?: number;
  estimatedPromptTokens?: number;
  imageCount?: number;
  model?: string;
  service?: "audio" | "chat" | "image";
};

export type UsageQuote = {
  chain: ProductChainId;
  chainId: number;
  chainName: string;
  model: string;
  nativeSymbol: string;
  endpoint: string;
  promptPriceNeuron: string;
  completionPriceNeuron: string;
  imagePriceNeuron?: string;
  promptPriceUsd?: string;
  completionPriceUsd?: string;
  imagePriceUsd?: string;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedCostNeuron: string;
  estimatedCost0G: string;
  estimatedCostMnt: string;
  estimatedCostNative: string;
  priceFetchedAt: string;
};

export type UsageReservation = {
  chain: ProductChainId;
  chainId: number;
  chainName: string;
  reservationId: string;
  wallet: string;
  nativeSymbol: string;
  model: string;
  promptPriceNeuron: string;
  completionPriceNeuron: string;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  reservedNeuron: string;
  balanceBefore: string;
  balanceAfterReserve: string;
};

export class UsageHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const nativeVaultTokenAddress =
  "0x0000000000000000000000000000000000000000" as const;
const depositEventAbi = parseAbiItem(
  "event Deposit(address indexed payer,uint256 amount,bytes32 indexed depositReference)"
);

export function usageErrorResponse(error: unknown) {
  if (error instanceof UsageHttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json(
    { error: error instanceof Error ? error.message : "Usage billing failed." },
    { status: 500 }
  );
}

export async function readUsageBalance(
  authInput: AccountAuthInput,
  chainInput?: ProductChainId
) {
  const chain = getProductChain(chainInput ?? "celo");
  const context = await requireUsageContext(authInput);
  const account = await ensureUsageAccount(
    context.walletUser.id,
    context.wallet,
    chain
  );
  const quote = await buildUsageQuote({ chain: chain.id }).catch(() => undefined);

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    configured: true,
    nativeSymbol: chain.billingCurrency.symbol,
    wallet: context.wallet.address,
    balance: accountToBalance(account, chain),
    quote,
  };
}

export async function buildUsageQuote(
  input: UsageQuoteInput = {}
): Promise<UsageQuote> {
  const chain = getProductChain(input.chain ?? "celo");
  const price = await readActiveModelPrice(input);
  const estimatedPromptTokens =
    input.estimatedPromptTokens ??
    readPositiveInt(process.env.LANGCLAW_USAGE_ESTIMATED_PROMPT_TOKENS, 6000);
  const estimatedCompletionTokens =
    input.estimatedCompletionTokens ??
    readEstimatedCompletionUnits(input, price.imagePriceNeuron);
  const estimatedCost = BigInt(calculateTokenCostNeuron({
    promptPriceNeuron: price.promptPriceNeuron,
    completionPriceNeuron: price.completionPriceNeuron,
    promptTokens: estimatedPromptTokens,
    completionTokens: estimatedCompletionTokens,
  }));

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    model: price.model,
    nativeSymbol: chain.billingCurrency.symbol,
    endpoint: price.endpoint,
    promptPriceNeuron: price.promptPriceNeuron,
    completionPriceNeuron: price.completionPriceNeuron,
    imagePriceNeuron: price.imagePriceNeuron,
    promptPriceUsd: price.promptPriceUsd,
    completionPriceUsd: price.completionPriceUsd,
    imagePriceUsd: price.imagePriceUsd,
    estimatedPromptTokens,
    estimatedCompletionTokens,
    estimatedCostNeuron: estimatedCost.toString(),
    estimatedCost0G: formatBillingAmount(estimatedCost, chain),
    estimatedCostMnt: formatBillingAmount(estimatedCost, chain),
    estimatedCostNative: formatBillingAmount(estimatedCost, chain),
    priceFetchedAt: new Date(price.fetchedAt).toISOString(),
  };
}

export async function reserveResearchUsage(
  authInput: AccountAuthInput,
  quoteInput: UsageQuoteInput = {},
  chainInput?: ProductChainId
): Promise<UsageReservation> {
  const chain = getProductChain(chainInput ?? quoteInput.chain ?? "celo");
  const context = await requireUsageContext(authInput);
  const quote = await buildUsageQuote({ ...quoteInput, chain: chain.id });
  const reservationId = randomUUID();
  const reservedNeuron = quote.estimatedCostNeuron;
  const { data, error } = await context.supabase.rpc(
    "langclaw_usage_reserve_balance",
    {
      p_completion_price_neuron: quote.completionPriceNeuron,
      p_chain_id: chain.chainId,
      p_chain_slug: chain.id,
      p_estimated_completion_tokens: quote.estimatedCompletionTokens,
      p_estimated_prompt_tokens: quote.estimatedPromptTokens,
      p_model: quote.model,
      p_native_symbol: chain.billingCurrency.symbol,
      p_prompt_price_neuron: quote.promptPriceNeuron,
      p_reservation_id: reservationId,
      p_reserved_neuron: reservedNeuron,
      p_wallet_address: context.wallet.address,
      p_wallet_user_id: context.walletUser.id,
    }
  );

  if (error) {
    if (error.message.toLowerCase().includes("insufficient_balance")) {
      throw new UsageHttpError(
        402,
        `Insufficient ${chain.billingCurrency.symbol} balance.`
      );
    }

    throw new UsageHttpError(500, error.message);
  }

  const row = firstRpcRow(data);

  if (!row) {
    throw new UsageHttpError(500, "Usage reservation was not created.");
  }

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    reservationId,
    wallet: context.wallet.address,
    model: quote.model,
    nativeSymbol: chain.billingCurrency.symbol,
    promptPriceNeuron: quote.promptPriceNeuron,
    completionPriceNeuron: quote.completionPriceNeuron,
    estimatedPromptTokens: quote.estimatedPromptTokens,
    estimatedCompletionTokens: quote.estimatedCompletionTokens,
    reservedNeuron,
    balanceBefore: readDecimalString(row.balance_before_neuron),
    balanceAfterReserve: readDecimalString(row.balance_after_neuron),
  };
}

export async function readUsageReservation(
  authInput: AccountAuthInput,
  reservationId: string,
  chainInput?: ProductChainId
): Promise<UsageReservation> {
  const chain = getProductChain(chainInput ?? "celo");
  const context = await requireUsageContext(authInput);
  const reservations = context.supabase.from(
    "langclaw_usage_reservations"
  ) as ReturnType<typeof context.supabase.from> & {
    select: (columns: string) => any;
  };
  const { data, error } = await reservations
    .select(
      "id,wallet_address,chain_slug,chain_id,native_symbol,model,prompt_price_neuron,completion_price_neuron,estimated_prompt_tokens,estimated_completion_tokens,reserved_neuron,balance_before_neuron,balance_after_reserve_neuron,status"
    )
    .eq("id", reservationId)
    .eq("wallet_user_id", context.walletUser.id)
    .eq("chain_slug", chain.id)
    .maybeSingle();

  if (error) {
    throw new UsageHttpError(500, error.message);
  }

  if (!data) {
    throw new UsageHttpError(404, "Usage reservation was not found.");
  }

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    reservationId: (data as UsageRpcRow).id as string,
    wallet: String((data as UsageRpcRow).wallet_address),
    model: String((data as UsageRpcRow).model),
    nativeSymbol: String(
      (data as UsageRpcRow).native_symbol || chain.billingCurrency.symbol
    ),
    promptPriceNeuron: readDecimalString((data as UsageRpcRow).prompt_price_neuron),
    completionPriceNeuron: readDecimalString(
      (data as UsageRpcRow).completion_price_neuron
    ),
    estimatedPromptTokens: Number((data as UsageRpcRow).estimated_prompt_tokens),
    estimatedCompletionTokens: Number(
      (data as UsageRpcRow).estimated_completion_tokens
    ),
    reservedNeuron: readDecimalString((data as UsageRpcRow).reserved_neuron),
    balanceBefore: readDecimalString((data as UsageRpcRow).balance_before_neuron),
    balanceAfterReserve: readDecimalString(
      (data as UsageRpcRow).balance_after_reserve_neuron
    ),
  };
}

export async function settleResearchUsage({
  computeStatus,
  providerTrace,
  reservation,
  routerTrace,
  topic,
  tokenUsage,
}: {
  computeStatus?: ZeroGComputeStatus;
  reservation: UsageReservation;
  providerTrace?: ProviderUsageTrace;
  routerTrace?: ProviderUsageTrace;
  topic: string;
  tokenUsage?: ZeroGTokenUsage;
}): Promise<ModelUsageReceipt> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    throw new UsageHttpError(503, "Supabase service role key is required.");
  }

  const promptTokens = tokenUsage?.promptTokens ?? tokenUsage?.inputTokens ?? 0;
  const completionTokens =
    tokenUsage?.completionTokens ?? tokenUsage?.outputTokens ?? 0;
  const totalTokens =
    tokenUsage?.totalTokens ||
    (promptTokens || completionTokens ? promptTokens + completionTokens : 0);
  const selection = selectUsageCost({
    completionPriceNeuron: reservation.completionPriceNeuron,
    computeStatus,
    promptPriceNeuron: reservation.promptPriceNeuron,
    providerTrace: providerTrace ?? routerTrace,
    reservedNeuron: reservation.reservedNeuron,
    tokenUsage,
  });
  const trace = providerTrace ?? routerTrace;
  const rawCostNeuron = selection.chargedRawNeuron;
  const markupBps = readUsageMarkupBps();
  const markupNeuron = calculateMarkupNeuron(rawCostNeuron, markupBps);
  const chargedNeuron = applyMarkupNeuron(rawCostNeuron, markupBps);
  const uiTokenUsage = mapUiTokenUsage({
    ...(tokenUsage ?? {}),
    totalTokens: tokenUsage?.totalTokens ?? (totalTokens || undefined),
  });

  const { data, error } = await supabase.rpc(
    "langclaw_usage_finalize_reservation",
    {
      p_charged_neuron: chargedNeuron,
      p_completion_tokens: completionTokens,
      p_prompt_tokens: promptTokens,
      p_reservation_id: reservation.reservationId,
      p_status: selection.status,
      p_topic: topic,
      p_total_tokens: totalTokens,
    }
  );

  if (error) {
    throw new UsageHttpError(500, error.message);
  }

  const row = firstRpcRow(data);

  if (!row) {
    throw new UsageHttpError(500, "Usage charge was not finalized.");
  }

  return {
    wallet: reservation.wallet,
    chain: reservation.chain,
    chainId: reservation.chainId,
    chainName: reservation.chainName,
    nativeSymbol: reservation.nativeSymbol,
    model: reservation.model,
    requestId: trace?.requestId,
    provider: trace?.provider,
    teeVerified: trace?.teeVerified,
    ...uiTokenUsage,
    promptPriceNeuron: reservation.promptPriceNeuron,
    completionPriceNeuron: reservation.completionPriceNeuron,
    reservedNeuron: reservation.reservedNeuron,
    rawCostNeuron,
    markupBps,
    markupNeuron,
    chargedNeuron: readDecimalString(row.charged_neuron),
    releasedNeuron: readDecimalString(row.released_neuron),
    balanceBefore: reservation.balanceBefore,
    balanceAfter: readDecimalString(row.balance_after_neuron),
    costSource: selection.costSource,
    totalCostNeuron: rawCostNeuron === "0" ? undefined : rawCostNeuron,
    meter: buildUsageMeter({
      model: reservation.model,
      tokenUsage: uiTokenUsage,
      totalConsumeNeuron: readDecimalString(row.charged_neuron),
    }),
    status: readUsageStatus(row.status),
  };
}

export async function refundResearchUsage(
  reservation: UsageReservation,
  reason: string
): Promise<ModelUsageReceipt> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    throw new UsageHttpError(503, "Supabase service role key is required.");
  }

  const { data, error } = await supabase.rpc(
    "langclaw_usage_refund_reservation",
    {
      p_reason: reason,
      p_reservation_id: reservation.reservationId,
    }
  );

  if (error) {
    throw new UsageHttpError(500, error.message);
  }

  const row = firstRpcRow(data);

  return {
    wallet: reservation.wallet,
    chain: reservation.chain,
    chainId: reservation.chainId,
    chainName: reservation.chainName,
    nativeSymbol: reservation.nativeSymbol,
    model: reservation.model,
    promptPriceNeuron: reservation.promptPriceNeuron,
    completionPriceNeuron: reservation.completionPriceNeuron,
    reservedNeuron: reservation.reservedNeuron,
    rawCostNeuron: "0",
    markupBps: readUsageMarkupBps(),
    markupNeuron: "0",
    chargedNeuron: "0",
    releasedNeuron: row
      ? readDecimalString(row.released_neuron)
      : reservation.reservedNeuron,
    balanceBefore: reservation.balanceBefore,
    balanceAfter: row
      ? readDecimalString(row.balance_after_neuron)
      : reservation.balanceBefore,
    costSource: "reserved-estimate",
    meter: buildUsageMeter({
      model: reservation.model,
      totalConsumeNeuron: "0",
    }),
    status: "failed_after_charge",
  };
}

export async function verifyUsageDeposit({
  chain: chainInput = "celo",
  reference,
  txHash,
  wallet: walletInput,
}: {
  chain?: ProductChainId;
  reference?: unknown;
  txHash?: unknown;
  wallet: WalletAuthInput;
}) {
  const chain = getProductChain(chainInput);
  const hash = readTxHash(txHash);
  const vaultAddress = readVaultAddress(chain);
  const tokenAddress = readVaultTokenAddress(chain);
  const client = createUsagePublicClient(chain);
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);

  if (receipt.status !== "success") {
    throw new UsageHttpError(400, "Deposit transaction did not succeed.");
  }

  if (!tx.to || getAddress(tx.to) !== vaultAddress) {
    throw new UsageHttpError(400, "Invalid deposit receiver.");
  }

  const txSender = getAddress(tx.from);
  const claimedAddress = readOptionalAddress(walletInput.address);

  if (claimedAddress && claimedAddress !== txSender) {
    throw new UsageHttpError(403, "Wallet mismatch.");
  }

  if (tokenAddress === nativeVaultTokenAddress && tx.value <= 0n) {
    throw new UsageHttpError(400, "Deposit amount must be greater than zero.");
  }

  if (tokenAddress !== nativeVaultTokenAddress && tx.value !== 0n) {
    throw new UsageHttpError(400, "Token deposits must not send native value.");
  }

  const depositEvent = readDepositEvent(receipt.logs, vaultAddress);

  if (!depositEvent) {
    throw new UsageHttpError(400, "Deposit event was not found.");
  }

  const { context, walletSession } = await resolveDepositUsageContext(
    walletInput,
    txSender
  );

  if (getAddress(depositEvent.payer) !== getAddress(context.wallet.address)) {
    throw new UsageHttpError(403, "Deposit event wallet mismatch.");
  }

  if (
    tokenAddress === nativeVaultTokenAddress &&
    depositEvent.amountNeuron !== tx.value.toString()
  ) {
    throw new UsageHttpError(400, "Deposit event amount does not match tx value.");
  }

  const expectedReference = readOptionalBytes32(reference);

  if (
    expectedReference &&
    depositEvent.reference.toLowerCase() !== expectedReference.toLowerCase()
  ) {
    throw new UsageHttpError(400, "Deposit reference mismatch.");
  }

  const { data, error } = await context.supabase.rpc(
    "langclaw_usage_credit_deposit",
    {
      p_amount_neuron: depositEvent.amountNeuron,
      p_block_number: receipt.blockNumber.toString(),
      p_chain_id: chain.chainId,
      p_chain_slug: chain.id,
      p_log_index: depositEvent.logIndex,
      p_reference: depositEvent.reference,
      p_tx_hash: hash.toLowerCase(),
      p_native_symbol: chain.billingCurrency.symbol,
      p_wallet_address: context.wallet.address,
      p_wallet_user_id: context.walletUser.id,
    }
  );

  if (error) {
    throw new UsageHttpError(500, error.message);
  }

  const row = firstRpcRow(data);

  if (!row) {
    throw new UsageHttpError(500, "Deposit was not credited.");
  }

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    configured: true,
    nativeSymbol: chain.billingCurrency.symbol,
    wallet: context.wallet.address,
    walletSession,
    txHash: hash.toLowerCase(),
    amountNeuron: depositEvent.amountNeuron,
    amount0G: formatBillingAmount(BigInt(depositEvent.amountNeuron), chain),
    amountMnt: formatBillingAmount(BigInt(depositEvent.amountNeuron), chain),
    amountNative: formatBillingAmount(BigInt(depositEvent.amountNeuron), chain),
    credited: readBoolean(row.credited),
    balanceBefore: readDecimalString(row.balance_before_neuron),
    balanceAfter: readDecimalString(row.balance_after_neuron),
  };
}

export async function buildWithdrawRequest(walletInput: WalletAuthInput) {
  return buildWithdrawRequestForChain(walletInput, "celo");
}

export function buildUsageVaultInfo(chainInput: ProductChainId) {
  const chain = getProductChain(chainInput);
  const vaultAddress = readVaultAddress(chain);

  return {
    chain: chain.id,
    chainId: chain.chainId,
    chainName: chain.name,
    configured: true,
    billingCurrency: {
      decimals: chain.billingCurrency.decimals,
      feeCurrencyAddress: chain.billingCurrency.feeCurrencyAddress,
      name: chain.billingCurrency.name,
      symbol: chain.billingCurrency.symbol,
      tokenAddress: chain.billingCurrency.tokenAddress,
    },
    depositFunctionName: chain.billingCurrency.tokenAddress
      ? "depositTokenAmount"
      : "deposit",
    nativeSymbol: chain.billingCurrency.symbol,
    vaultAddress,
  };
}

export async function buildWithdrawRequestForChain(
  walletInput: WalletAuthInput,
  chainInput: ProductChainId
) {
  const chain = getProductChain(chainInput);
  const context = await requireWalletUsageContext(walletInput);
  const account = await ensureUsageAccount(
    context.walletUser.id,
    context.wallet,
    chain
  );
  const vault = buildUsageVaultInfo(chain.id);

  return {
    ...vault,
    wallet: context.wallet.address,
    functionName: "withdraw",
    balance: accountToBalance(account, chain),
    note:
      "Call withdraw(uint256 amount) from the connected wallet. Backend will verify the Withdrawal event before marking the request complete.",
  };
}

async function requireUsageContext(authInput: AccountAuthInput) {
  try {
    const account = await requireAccountAuth(authInput);

    return {
      supabase: account.supabase,
      wallet: { address: account.walletUser.walletAddress },
      walletUser: { id: account.walletUser.id },
    };
  } catch (error) {
    throw mapUsageAuthError(error);
  }
}

async function requireWalletUsageContext(walletInput: WalletAuthInput) {
  try {
    const account = await requireWalletAccount(walletInput);

    return {
      supabase: account.supabase,
      wallet: { address: account.walletUser.walletAddress },
      walletUser: { id: account.walletUser.id },
    };
  } catch (error) {
    throw mapUsageAuthError(error);
  }
}

async function resolveDepositUsageContext(
  walletInput: WalletAuthInput,
  txSender: Address
) {
  if (hasReusableWalletAuth(walletInput)) {
    const context = await requireWalletUsageContext(walletInput);

    if (getAddress(context.wallet.address) !== txSender) {
      throw new UsageHttpError(403, "Wallet mismatch.");
    }

    return { context, walletSession: undefined };
  }

  const walletSession = createWalletSessionForVerifiedAddress(txSender);
  const account = await createVerifiedWalletAccount(walletSession);

  return {
    context: {
      supabase: account.supabase,
      wallet: { address: account.walletUser.walletAddress },
      walletUser: { id: account.walletUser.id },
    },
    walletSession,
  };
}

function hasReusableWalletAuth(walletInput: WalletAuthInput) {
  return Boolean(
    walletInput.sessionToken ||
      (typeof walletInput.message === "string" &&
        typeof walletInput.signature === "string")
  );
}

async function ensureUsageAccount(
  walletUserId: string,
  wallet: UsageWallet,
  chain: ProductChainConfig
): Promise<UsageAccountRow> {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    throw new UsageHttpError(503, "Supabase service role key is required.");
  }

  const accounts = supabase.from("langclaw_usage_accounts") as ReturnType<
    typeof supabase.from
  > & {
    upsert: (values: Record<string, unknown>, options?: unknown) => any;
  };
  const { data, error } = await accounts
    .upsert(
      {
        chain_id: chain.chainId,
        chain_slug: chain.id,
        native_symbol: chain.billingCurrency.symbol,
        wallet_address: wallet.address,
        wallet_user_id: walletUserId,
      },
      { onConflict: "wallet_user_id,chain_slug" }
    )
    .select(
      "wallet_user_id,wallet_address,chain_slug,chain_id,native_symbol,available_neuron,reserved_neuron,lifetime_deposited_neuron,lifetime_charged_neuron"
    )
    .single();

  if (error || !data) {
    throw new UsageHttpError(
      500,
      error?.message || "Unable to read usage balance."
    );
  }

  return data as unknown as UsageAccountRow;
}

function mapUsageAuthError(error: unknown) {
  if (error instanceof AccountAuthError) {
    return new UsageHttpError(error.status, error.message);
  }

  return error;
}

async function readActiveModelPrice(input: UsageQuoteInput = {}) {
  const endpoint = getOpenAIBaseUrl();
  const model = input.model?.trim() || getDefaultOpenAIModel("chat");
  const promptPriceNeuron = readNeuronString(
    process.env.OPENAI_PROMPT_PRICE_NEURON_PER_TOKEN ||
      process.env.LANGCLAW_USAGE_PROMPT_PRICE_NEURON ||
      "1"
  );
  const completionPriceNeuron = readNeuronString(
    process.env.OPENAI_COMPLETION_PRICE_NEURON_PER_TOKEN ||
      process.env.LANGCLAW_USAGE_COMPLETION_PRICE_NEURON ||
      "5"
  );

  if (!promptPriceNeuron || !completionPriceNeuron) {
    throw new UsageHttpError(
      503,
      `OpenAI model ${model} usage pricing is not configured.`
    );
  }

  return {
    model,
    endpoint,
    promptPriceNeuron,
    completionPriceNeuron,
    imagePriceNeuron: undefined,
    promptPriceUsd:
      readString(process.env.OPENAI_PROMPT_PRICE_USD_PER_TOKEN) || undefined,
    completionPriceUsd:
      readString(process.env.OPENAI_COMPLETION_PRICE_USD_PER_TOKEN) || undefined,
    imagePriceUsd: undefined,
    fetchedAt: Date.now(),
  };
}

function readEstimatedCompletionUnits(
  input: UsageQuoteInput,
  imagePriceNeuron?: string
) {
  if (input.estimatedCompletionTokens !== undefined) {
    return input.estimatedCompletionTokens;
  }

  if (input.service === "image" && imagePriceNeuron) {
    return Math.max(1, input.imageCount ?? 1);
  }

  if (input.service === "audio") {
    return readPositiveInt(
      process.env.LANGCLAW_USAGE_ESTIMATED_AUDIO_COMPLETION_TOKENS,
      1200
    );
  }

  return readPositiveInt(
    process.env.LANGCLAW_USAGE_ESTIMATED_COMPLETION_TOKENS,
    1200
  );
}

function accountToBalance(account: UsageAccountRow, chain: ProductChainConfig) {
  const availableNeuron = readDecimalString(account.available_neuron);
  const reservedNeuron = readDecimalString(account.reserved_neuron);
  const lifetimeDepositedNeuron = readDecimalString(
    account.lifetime_deposited_neuron
  );
  const lifetimeChargedNeuron = readDecimalString(
    account.lifetime_charged_neuron
  );

  return {
    chain: chain.id,
    chainId: chain.chainId,
    nativeSymbol: chain.billingCurrency.symbol,
    availableNeuron,
    available0G: formatBillingAmount(BigInt(availableNeuron), chain),
    availableMnt: formatBillingAmount(BigInt(availableNeuron), chain),
    availableNative: formatBillingAmount(BigInt(availableNeuron), chain),
    reservedNeuron,
    reserved0G: formatBillingAmount(BigInt(reservedNeuron), chain),
    reservedMnt: formatBillingAmount(BigInt(reservedNeuron), chain),
    reservedNative: formatBillingAmount(BigInt(reservedNeuron), chain),
    lifetimeDepositedNeuron,
    lifetimeDeposited0G: formatBillingAmount(BigInt(lifetimeDepositedNeuron), chain),
    lifetimeDepositedMnt: formatBillingAmount(BigInt(lifetimeDepositedNeuron), chain),
    lifetimeDepositedNative: formatBillingAmount(BigInt(lifetimeDepositedNeuron), chain),
    lifetimeChargedNeuron,
    lifetimeCharged0G: formatBillingAmount(BigInt(lifetimeChargedNeuron), chain),
    lifetimeChargedMnt: formatBillingAmount(BigInt(lifetimeChargedNeuron), chain),
    lifetimeChargedNative: formatBillingAmount(BigInt(lifetimeChargedNeuron), chain),
  };
}

function createUsagePublicClient(chainConfig: ProductChainConfig) {
  const rpcUrl =
    readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl) ||
    chainConfig.rpcUrl;
  const chainId = readPositiveInt(
    readChainEnv(chainConfig, "CHAIN_ID", String(chainConfig.chainId)),
    chainConfig.chainId
  );
  const chain = defineChain({
    id: chainId,
    name: chainConfig.name,
    nativeCurrency: chainConfig.nativeCurrency,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  });

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}

function readDepositEvent(
  logs: Array<{
    address: Address;
    data: Hex;
    logIndex: number;
    topics: [signature: Hex, ...args: Hex[]] | [];
  }>,
  vaultAddress: Address
) {
  for (const log of logs) {
    if (getAddress(log.address) !== vaultAddress) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [depositEventAbi],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as {
        amount?: bigint;
        depositReference?: Hex;
        payer?: Address;
      };

      if (
        !args.payer ||
        args.amount === undefined ||
        !args.depositReference
      ) {
        continue;
      }

      return {
        amountNeuron: args.amount.toString(),
        logIndex: log.logIndex,
        payer: getAddress(args.payer),
        reference: args.depositReference,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function readVaultAddress(chain: ProductChainConfig) {
  const address = readChainEnv(chain, "LANGCLAW_USAGE_VAULT_ADDRESS");

  if (!address || !isAddress(address)) {
    throw new UsageHttpError(
      503,
      `${chain.envPrefix}_LANGCLAW_USAGE_VAULT_ADDRESS is not configured.`
    );
  }

  return getAddress(address);
}

function readVaultTokenAddress(chain: ProductChainConfig) {
  const address = readChainEnv(
    chain,
    "LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN",
    chain.billingCurrency.tokenAddress ?? nativeVaultTokenAddress
  );

  if (!address || /^0x0{40}$/i.test(address)) {
    return nativeVaultTokenAddress;
  }

  if (!isAddress(address)) {
    throw new UsageHttpError(
      503,
      `${chain.envPrefix}_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN is invalid.`
    );
  }

  return getAddress(address);
}

function firstRpcRow(value: unknown): UsageRpcRow | null {
  if (Array.isArray(value)) {
    return (value[0] as UsageRpcRow | undefined) ?? null;
  }

  return value && typeof value === "object" ? (value as UsageRpcRow) : null;
}

function readTxHash(value: unknown) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new UsageHttpError(400, "A valid txHash is required.");
  }

  return value as Hex;
}

function readOptionalAddress(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !isAddress(value)) {
    throw new UsageHttpError(400, "A valid wallet address is required.");
  }

  return getAddress(value);
}

function readOptionalBytes32(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new UsageHttpError(400, "reference must be a bytes32 hex string.");
  }

  return value as Hex;
}

function readNeuronString(value: unknown) {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : "";
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
  }

  if (typeof value !== "string") {
    return "";
  }

  return /^\d+$/.test(value) ? value : "";
}

function readDecimalString(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "0";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }

  return "0";
}

function readUsageStatus(value: unknown): ModelUsageReceipt["status"] {
  return value === "estimated" ||
    value === "refunded" ||
    value === "failed_after_charge"
    ? value
    : "charged";
}

function readBoolean(value: unknown) {
  return value === true || value === "true";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatBillingAmount(value: bigint, chain: ProductChainConfig) {
  if (chain.billingCurrency.decimals === 18) {
    return formatWeiAsMnt(value);
  }

  return trimDecimal(formatUnits(value, chain.billingCurrency.decimals));
}

function formatWeiAsMnt(value: bigint) {
  return trimDecimal(formatUnits(value, 18));
}

function trimDecimal(value: string) {
  return value.includes(".")
    ? value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")
    : value;
}
