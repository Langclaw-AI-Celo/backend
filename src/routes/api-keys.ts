import {
  accountAuthErrorResponse,
  requireWalletAccount,
} from "../lib/server/account-auth";
import {
  ApiKeyHttpError,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "../lib/server/api-keys";
import type { WalletAuthInput } from "../lib/server/wallet-auth";

type ApiKeysBody = {
  action?: unknown;
  keyId?: unknown;
  name?: unknown;
  wallet?: WalletAuthInput;
};

export async function handleApiKeys(request: Request) {
  let body: ApiKeysBody;

  try {
    const value = await request.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("API key request body must be an object.");
    }

    body = value as ApiKeysBody;
  } catch {
    return Response.json(
      { configured: true, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  let account;

  try {
    account = await requireWalletAccount(
      body.wallet ?? {},
      body.action === "create"
        ? {
            issueSession: false,
            requireChallenge: true,
            requiredPurpose: "api-key:create",
          }
        : {}
    );
  } catch (error) {
    return accountAuthErrorResponse(error, { configured: true });
  }

  try {
    if (!body.action || body.action === "list") {
      return Response.json({
        configured: true,
        keys: await listApiKeys(account.supabase, account.walletUser.id),
      });
    }

    if (body.action === "create") {
      return Response.json({
        configured: true,
        ...(await createApiKey(
          account.supabase,
          account.walletUser.id,
          body.name
        )),
      });
    }

    if (body.action === "revoke") {
      return Response.json({
        configured: true,
        key: await revokeApiKey(
          account.supabase,
          account.walletUser.id,
          body.keyId
        ),
      });
    }

    return Response.json(
      { configured: true, error: "Unsupported action." },
      { status: 400 }
    );
  } catch (error) {
    return apiKeyErrorResponse(error);
  }
}

export function apiKeyErrorResponse(error: unknown) {
  if (error instanceof ApiKeyHttpError) {
    const message =
      error.status < 500 || error.status === 503
        ? error.message
        : "API key request failed.";

    return Response.json(
      { configured: true, error: message },
      { status: error.status }
    );
  }

  return Response.json(
    {
      configured: true,
      error: "API key request failed.",
    },
    { status: 500 }
  );
}
