import 'dotenv/config';

export interface Config {
  port: number;
  mongoUri: string | undefined;
  mongoDbName: string;
  appleBundleId: string | undefined;
  allowedAppleUserIds: string[];
  sessionSecret: string | undefined;
  googlePlacesApiKey: string | undefined;
  anthropicApiKey: string | undefined;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadConfig(): Config {
  return {
    port: Number(optional('PORT') ?? 4100),
    mongoUri: optional('MONGODB_URI'),
    mongoDbName: optional('MONGODB_DB') ?? 'tedmarks',
    appleBundleId: optional('APPLE_BUNDLE_ID'),
    allowedAppleUserIds: (optional('ALLOWED_APPLE_USER_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sessionSecret: optional('SESSION_SECRET'),
    googlePlacesApiKey: optional('GOOGLE_PLACES_API_KEY'),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
  };
}

/** Names of settings that are missing, for a startup warning. Never logs values. */
export function missingSettings(config: Config): string[] {
  const missing: string[] = [];
  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (!config.appleBundleId) missing.push('APPLE_BUNDLE_ID');
  if (config.allowedAppleUserIds.length === 0) missing.push('ALLOWED_APPLE_USER_IDS');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  if (!config.googlePlacesApiKey) missing.push('GOOGLE_PLACES_API_KEY');
  if (!config.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  return missing;
}
