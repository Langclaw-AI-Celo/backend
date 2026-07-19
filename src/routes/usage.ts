import type { WalletAuthInput } from "../lib/server/wallet-auth";
import { readProductChainId } from "../lib/chain-config";
import {
  buildUsageVaultInfo,
  buildUsageQuote,
  buildWithdrawRequestForChain,
  readUsageBalance,
  usageErrorResponse,
  verifyUsageDeposit,
} from "../lib/usage";

type UsageRequestBody = {
  chain?: unknown;
  wallet?: WalletAuthInput;
  txHash?: unknown;
  reference?: unknown;
};

export async function handleUsageBalance(request: Request) {
  const body = await readUsageBody(request);

  if (body instanceof Response) {
    return body;
  }

  try {
    const payload = await readUsageBalance({
      request,
      wallet: body.wallet ?? {},
    }, readProductChainId(body.chain));

    return Response.json(payload);
  } catch (error) {
    return usageErrorResponse(error);
  }
}

export async function handleUsageQuote(request?: Request) {
  const body = await readUsageBody(request);

  if (body instanceof Response) {
    return body;
  }

  try {
    const quote = await buildUsageQuote({
      chain: readProductChainId(body.chain),
    });

    return Response.json({
      configured: true,
      quote,
    });
  } catch (error) {
    return usageErrorResponse(error);
  }
}

export async function handleUsageVaultInfo(request?: Request) {
  const body = await readUsageBody(request);

  if (body instanceof Response) {
    return body;
  }

  try {
    const vault = buildUsageVaultInfo(readProductChainId(body.chain));

    return Response.json(vault);
  } catch (error) {
    return usageErrorResponse(error);
  }
}

export async function handleUsageDepositVerify(request: Request) {
  const body = await readUsageBody(request);

  if (body instanceof Response) {
    return body;
  }

  try {
    const payload = await verifyUsageDeposit({
      reference: body.reference,
      chain: readProductChainId(body.chain),
      txHash: body.txHash,
      wallet: body.wallet ?? {},
    });

    return Response.json(payload);
  } catch (error) {
    return usageErrorResponse(error);
  }
}

export async function handleUsageWithdrawRequest(request: Request) {
  const body = await readUsageBody(request);

  if (body instanceof Response) {
    return body;
  }

  try {
    const payload = await buildWithdrawRequestForChain(
      body.wallet ?? {},
      readProductChainId(body.chain)
    );

    return Response.json(payload);
  } catch (error) {
    return usageErrorResponse(error);
  }
}

async function readUsageBody(request?: Request) {
  if (!request) {
    return {} as UsageRequestBody;
  }

  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    return body as UsageRequestBody;
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }
}
