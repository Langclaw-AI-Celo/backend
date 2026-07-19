import {
  createWalletChallenge,
  verifyWalletSession,
  WalletAuthError,
  type WalletAuthInput,
} from "../lib/server/wallet-auth";

type WalletChallengeBody = {
  address?: unknown;
  chainId?: unknown;
  purpose?: unknown;
};

type WalletSessionBody = {
  wallet?: WalletAuthInput;
};

export async function handleWalletChallenge(request: Request) {
  let body: WalletChallengeBody;

  try {
    const value = await request.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Wallet challenge body must be an object.");
    }

    body = value as WalletChallengeBody;
  } catch {
    return Response.json(
      { configured: true, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  try {
    return Response.json({
      challenge: createWalletChallenge({
        address: body.address,
        chainId: body.chainId,
        purpose: body.purpose,
        request,
      }),
      configured: true,
    });
  } catch (error) {
    return walletAuthErrorResponse(error);
  }
}

export async function handleWalletSession(request: Request) {
  let body: WalletSessionBody;

  try {
    const value = await request.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Wallet session body must be an object.");
    }

    body = value as WalletSessionBody;
  } catch {
    return Response.json(
      { configured: true, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  try {
    const wallet = await verifyWalletSession(body.wallet ?? {}, {
      requiredPurpose: "session",
    });

    if (!wallet?.sessionToken || !wallet.sessionExpiresAt) {
      return Response.json(
        { configured: true, error: "Wallet challenge is invalid or expired." },
        { status: 401 }
      );
    }

    return Response.json({
      configured: true,
      wallet: {
        address: wallet.address,
        sessionExpiresAt: wallet.sessionExpiresAt,
        sessionToken: wallet.sessionToken,
      },
    });
  } catch (error) {
    return walletAuthErrorResponse(error);
  }
}

export function walletAuthErrorResponse(error: unknown) {
  if (error instanceof WalletAuthError) {
    const message =
      error.status < 500 || error.status === 503
        ? error.message
        : "Wallet authentication failed.";

    return Response.json(
      { configured: true, error: message },
      { status: error.status }
    );
  }

  return Response.json(
    {
      configured: true,
      error: "Wallet authentication failed.",
    },
    { status: 500 }
  );
}
