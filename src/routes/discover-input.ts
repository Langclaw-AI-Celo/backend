const MAX_DISCOVERY_TOPIC_CHARACTERS = 4_000;

export function readDiscoveryTopicError(topic: string) {
  if (!topic) {
    return "Topic is required for Auto Discovery.";
  }

  if (topic.length > MAX_DISCOVERY_TOPIC_CHARACTERS) {
    return "Topic must be at most 4000 characters.";
  }

  return undefined;
}
