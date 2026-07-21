const automationProviderTimeoutMs = 12_000;

export function createAutomationProviderSignal() {
  return AbortSignal.timeout(automationProviderTimeoutMs);
}
