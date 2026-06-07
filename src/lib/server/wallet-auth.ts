import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getAddress, verifyMessage } from "viem";

export type WalletAuthInput = {
  address?: unknown;
  message?: unknown;
  sessionToken?: unknown;
  signature?: unknown;
};

export type VerifiedWallet = {
  authMethod: "challenge" | "session";
  address: string;
  message?: string;
  purpose?: WalletAuthPurpose;
  sessionExpiresAt?: string;
  sessionToken?: string;
  signature?: string;
};

export type WalletAuthPurpose = "api-key:create" | "session";

export type WalletChallenge = {
  address: string;
  chainId: number;
  domain: string;
  expiresAt: string;
  issuedAt: string;
  message: string;
  nonce: string;
  purpose: WalletAuthPurpose;
  uri: string;
};

type WalletChallengeRecord = WalletChallenge & {
  expiresAtMs: number;
};

type VerifyWalletSessionOptions = {
  issueSession?: boolean;
  requireChallenge?: boolean;
  requiredPurpose?: WalletAuthPurpose;
};

type WalletSessionPayload = {
  address: string;
  exp: number;
  iat: number;
  v: 1;
};

export class WalletAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const WALLET_LOGIN_STATEMENT = "Login to Langclaw";
const WALLET_AUTH_VERSION = "1";
const DEFAULT_CHAIN_ID = 42220;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_TOKEN_PREFIX = "lws_v1";
const allowedPurposes = new Set<WalletAuthPurpose>([
  "api-key:create",
  "session",
]);
const challenges = new Map<string, WalletChallengeRecord>();

export function createWalletChallenge({
  address,
  chainId,
  purpose,
  request,
}: {
  address: unknown;
  chainId?: unknown;
  purpose?: unknown;
  request: Request;
}): WalletChallenge {
  const checksumAddress = readChecksumAddress(address);
  const challengePurpose = readPurpose(purpose);
  const challengeChainId = readChainId(chainId);
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAtMs = now + CHALLENGE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const nonce = randomBytes(16).toString("hex");
  const { domain, uri } = readRequestDomain(request);
  const message = [
    `${domain} wants you to sign in with your Ethereum account:`,
    checksumAddress,
    "",
    WALLET_LOGIN_STATEMENT,
    "",
    `URI: ${uri}`,
    `Version: ${WALLET_AUTH_VERSION}`,
    `Chain ID: ${challengeChainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    `Purpose: ${challengePurpose}`,
  ].join("\n");
  const challenge = {
    address: checksumAddress.toLowerCase(),
    chainId: challengeChainId,
    domain,
    expiresAt,
    expiresAtMs,
    issuedAt,
    message,
    nonce,
    purpose: challengePurpose,
    uri,
  };

  pruneExpiredChallenges(now);
  challenges.set(nonce, challenge);

  return publicChallenge(challenge);
}

export async function verifyWalletSession(
  wallet: WalletAuthInput,
  options: VerifyWalletSessionOptions = {}
): Promise<VerifiedWallet | null> {
  const checksumAddress = normalizeWalletInputAddress(wallet.address);

  if (!checksumAddress) {
    return null;
  }

  if (typeof wallet.sessionToken === "string") {
    if (options.requireChallenge) {
      return null;
    }

    return verifyWalletSessionToken(checksumAddress, wallet.sessionToken);
  }

  if (
    typeof wallet.message !== "string" ||
    typeof wallet.signature !== "string"
  ) {
    return null;
  }

  const nonce = readMessageField(wallet.message, "Nonce");

  if (!nonce) {
    return null;
  }

  const challenge = consumeChallenge(nonce);

  if (!challenge) {
    return null;
  }

  if (
    challenge.address !== checksumAddress.toLowerCase() ||
    challenge.message !== wallet.message ||
    (options.requiredPurpose && challenge.purpose !== options.requiredPurpose)
  ) {
    return null;
  }

  const valid = await verifyMessage({
    address: checksumAddress,
    message: wallet.message,
    signature: wallet.signature as `0x${string}`,
  });

  if (!valid) {
    return null;
  }

  return {
    authMethod: "challenge",
    address: checksumAddress.toLowerCase(),
    message: wallet.message,
    purpose: challenge.purpose,
    ...issueSession(checksumAddress, options),
    signature: wallet.signature,
  };
}

export function createWalletSessionForVerifiedAddress(address: string): VerifiedWallet {
  const checksumAddress = readChecksumAddress(address);

  return {
    address: checksumAddress.toLowerCase(),
    authMethod: "session",
    purpose: "session",
    ...issueSession(checksumAddress, { requiredPurpose: "session" }),
  };
}

function verifyWalletSessionToken(
  checksumAddress: string,
  sessionToken: string
): VerifiedWallet | null {
  const payload = parseSessionToken(sessionToken);

  if (!payload || payload.address !== checksumAddress.toLowerCase()) {
    return null;
  }

  return {
    address: payload.address,
    authMethod: "session",
    purpose: "session",
    sessionExpiresAt: new Date(payload.exp).toISOString(),
    sessionToken,
  };
}

function issueSession(
  checksumAddress: string,
  options: VerifyWalletSessionOptions
) {
  if (options.issueSession === false || options.requiredPurpose !== "session") {
    return {};
  }

  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + SESSION_TTL_MS;
  const sessionToken = createSessionToken({
    address: checksumAddress.toLowerCase(),
    exp: expiresAtMs,
    iat: issuedAtMs,
    v: 1,
  });

  return {
    sessionExpiresAt: new Date(expiresAtMs).toISOString(),
    sessionToken,
  };
}

function createSessionToken(payload: WalletSessionPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = signSessionPayload(encodedPayload);

  return `${SESSION_TOKEN_PREFIX}.${encodedPayload}.${signature}`;
}

function parseSessionToken(token: string): WalletSessionPayload | null {
  const parts = token.split(".");

  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) {
    return null;
  }

  const [, encodedPayload, signature] = parts;
  const expectedSignature = signSessionPayload(encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: WalletSessionPayload;

  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as WalletSessionPayload;
  } catch {
    return null;
  }

  if (
    payload.v !== 1 ||
    typeof payload.address !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    payload.exp <= Date.now() ||
    payload.iat - Date.now() > 5 * 60 * 1000
  ) {
    return null;
  }

  try {
    return {
      ...payload,
      address: getAddress(payload.address).toLowerCase(),
    };
  } catch {
    return null;
  }
}

function signSessionPayload(encodedPayload: string) {
  return createHmac("sha256", readSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readSessionSecret() {
  const explicit = process.env.LANGCLAW_WALLET_SESSION_SECRET?.trim();

  if (process.env.NODE_ENV === "production") {
    if (!explicit) {
      throw new WalletAuthError(
        503,
        "LANGCLAW_WALLET_SESSION_SECRET is required."
      );
    }

    return explicit;
  }

  const fallback =
    explicit ||
    process.env.LANGCLAW_API_KEY_PEPPER?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (fallback) {
    return fallback;
  }

  return "langclaw-dev-wallet-session-secret";
}

function consumeChallenge(nonce: string) {
  pruneExpiredChallenges();
  const challenge = challenges.get(nonce);

  if (!challenge) {
    return null;
  }

  challenges.delete(nonce);

  if (challenge.expiresAtMs <= Date.now()) {
    return null;
  }

  return challenge;
}

function pruneExpiredChallenges(now = Date.now()) {
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAtMs <= now) {
      challenges.delete(nonce);
    }
  }
}

function publicChallenge(challenge: WalletChallengeRecord): WalletChallenge {
  return {
    address: challenge.address,
    chainId: challenge.chainId,
    domain: challenge.domain,
    expiresAt: challenge.expiresAt,
    issuedAt: challenge.issuedAt,
    message: challenge.message,
    nonce: challenge.nonce,
    purpose: challenge.purpose,
    uri: challenge.uri,
  };
}

function readChecksumAddress(value: unknown) {
  if (typeof value !== "string") {
    throw new WalletAuthError(400, "A valid wallet address is required.");
  }

  try {
    return getAddress(value);
  } catch {
    throw new WalletAuthError(400, "A valid wallet address is required.");
  }
}

function normalizeWalletInputAddress(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

function readPurpose(value: unknown): WalletAuthPurpose {
  if (value === undefined || value === null || value === "") {
    return "session";
  }

  if (typeof value === "string" && allowedPurposes.has(value as WalletAuthPurpose)) {
    return value as WalletAuthPurpose;
  }

  throw new WalletAuthError(400, "Unsupported wallet auth purpose.");
}

function readChainId(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CHAIN_ID;
  }

  const chainId = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new WalletAuthError(400, "A valid chain id is required.");
  }

  return chainId;
}

function readRequestDomain(request: Request) {
  const configuredDomain = process.env.LANGCLAW_WALLET_AUTH_DOMAIN?.trim();
  const url = new URL(request.url);
  const domain = configuredDomain || url.host;
  const uri = `${url.protocol}//${domain}`;

  return { domain, uri };
}

function readMessageField(message: string, field: string) {
  return message
    .split("\n")
    .find((line) => line.startsWith(`${field}: `))
    ?.replace(`${field}: `, "")
    .trim();
}
