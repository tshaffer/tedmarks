import 'dotenv/config';
import { DEFAULT_NEARBY_MAX_METERS, DEFAULT_NEARBY_START_METERS } from '@tedmarks/shared';

export interface Config {
  port: number;
  mongoUri: string | undefined;
  mongoDbName: string;
  appleBundleId: string | undefined;
  allowedAppleUserIds: string[];
  sessionSecret: string | undefined;
  googlePlacesApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  /** Server defaults for the nearby search when the app doesn't send its own. */
  nearbyStartMeters: number;
  nearbyMaxMeters: number;
  /** Interim shared key required on every request except /health (until Sign in with Apple). */
  accessKey: string | undefined;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadConfig(): Config {
  return {
    port: Number(optional('PORT') ?? 4200),
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
    nearbyStartMeters: Number(optional('NEARBY_START_METERS') ?? DEFAULT_NEARBY_START_METERS),
    nearbyMaxMeters: Number(optional('NEARBY_MAX_METERS') ?? DEFAULT_NEARBY_MAX_METERS),
    accessKey: optional('API_ACCESS_KEY'),
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
  if (!config.accessKey) missing.push('API_ACCESS_KEY (requests are not protected)');
  return missing;
}
