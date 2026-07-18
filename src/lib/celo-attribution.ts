import type { Hex } from "viem";

export const DEFAULT_CELO_ATTRIBUTION_HOSTNAME =
  "langclawcelo.vercel.app";

type AttributionEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    "CELO_ATTRIBUTION_CODE" | "CELO_ATTRIBUTION_HOSTNAME"
  >
>;

export type BuildCeloAttributionTagOptions = {
  env?: AttributionEnvironment;
  onWarning?: (message: string) => void;
};

export type CeloAttributionTag = {
  codes: string[];
  dataSuffix: Hex;
  hostname: string;
};

type AttributionSdk = {
  codeFromHostname: (hostname: string) => string;
  toDataSuffix: (codes: string | readonly string[]) => Hex;
};

let attributionSdkPromise: Promise<AttributionSdk> | undefined;

export async function buildCeloAttributionTag({
  env = process.env,
  onWarning = defaultWarning,
}: BuildCeloAttributionTagOptions = {}): Promise<CeloAttributionTag> {
  const { codeFromHostname, toDataSuffix } = await loadAttributionSdk();
  const configuredHostname = env.CELO_ATTRIBUTION_HOSTNAME?.trim();
  let hostname = configuredHostname || DEFAULT_CELO_ATTRIBUTION_HOSTNAME;
  let hostnameCode: string;

  try {
    hostnameCode = codeFromHostname(hostname);
  } catch {
    onWarning(
      "CELO_ATTRIBUTION_HOSTNAME is invalid. Using the production hostname."
    );
    hostname = DEFAULT_CELO_ATTRIBUTION_HOSTNAME;
    hostnameCode = codeFromHostname(hostname);
  }

  const codes = [hostnameCode];
  const officialCode = env.CELO_ATTRIBUTION_CODE?.trim();

  if (officialCode && officialCode !== hostnameCode) {
    if (officialCode === "minipay") {
      onWarning(
        "MiniPay adds its platform attribution code. Langclaw will not add it."
      );
    } else if (isValidAttributionCode(officialCode, toDataSuffix)) {
      codes.push(officialCode);
    } else {
      onWarning(
        "CELO_ATTRIBUTION_CODE is invalid. Using hostname attribution only."
      );
    }
  }

  return {
    codes,
    dataSuffix: toDataSuffix(codes),
    hostname,
  };
}

export async function withCeloAttribution<
  T extends Record<string, unknown>,
>(
  chain: string,
  request: T,
  options: BuildCeloAttributionTagOptions = {}
): Promise<T & { dataSuffix?: Hex }> {
  if (chain !== "celo") {
    return request;
  }

  const { dataSuffix } = await buildCeloAttributionTag(options);

  return {
    ...request,
    dataSuffix,
  };
}

function loadAttributionSdk() {
  attributionSdkPromise ??= import("@celo/attribution-tags");
  return attributionSdkPromise;
}

function isValidAttributionCode(
  code: string,
  toDataSuffix: AttributionSdk["toDataSuffix"]
) {
  try {
    toDataSuffix(code);
    return true;
  } catch {
    return false;
  }
}

function defaultWarning(message: string) {
  console.warn(`[celo-attribution] ${message}`);
}
