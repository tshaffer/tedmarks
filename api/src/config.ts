import 'dotenv/config';
import { DEFAULT_NEARBY_RADIUS_METERS } from '@tedmarks/shared';

export interface Config {
  port: number;
  mongoUri: string | undefined;
  mongoDbName: string;
  /** Services ID for Sign in with Apple on the website. */
  appleServicesId: string;
  /** This server's public origin (Apple's return URL is built from it). */
  publicUrl: string | undefined;
  allowedAppleUserIds: string[];
  sessionSecret: string | undefined;
  googlePlacesApiKey: string | undefined;
  anthropicApiKey: string | undefined;
  /** Server default for the nearby search radius when the app doesn't send one. */
  nearbyRadiusMeters: number;
  /** Google Maps key for the website (public by design; restricted to the site's address). */
  googleMapsBrowserKey: string | undefined;
  /** Map ID (Google Cloud → Map management) for the website's map. */
  googleMapId: string | undefined;
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
    appleServicesId: optional('APPLE_SERVICES_ID') ?? 'com.tedshaffer.tedmarks.web',
    publicUrl: optional('PUBLIC_URL')?.replace(/\/$/, ''),
    allowedAppleUserIds: (optional('ALLOWED_APPLE_USER_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sessionSecret: optional('SESSION_SECRET'),
    googlePlacesApiKey: optional('GOOGLE_PLACES_API_KEY'),
    anthropicApiKey: optional('ANTHROPIC_API_KEY'),
    nearbyRadiusMeters: Number(optional('NEARBY_RADIUS_METERS') ?? DEFAULT_NEARBY_RADIUS_METERS),
    accessKey: optional('API_ACCESS_KEY'),
    googleMapsBrowserKey: optional('GOOGLE_MAPS_BROWSER_KEY'),
    googleMapId: optional('GOOGLE_MAP_ID'),
  };
}

/** Names of settings that are missing, for a startup warning. Never logs values. */
export function missingSettings(config: Config): string[] {
  const missing: string[] = [];
  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (!config.publicUrl) missing.push('PUBLIC_URL (Sign in with Apple)');
  if (config.allowedAppleUserIds.length === 0) missing.push('ALLOWED_APPLE_USER_IDS');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  if (!config.googlePlacesApiKey) missing.push('GOOGLE_PLACES_API_KEY');
  if (!config.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  if (!config.accessKey) missing.push('API_ACCESS_KEY (requests are not protected)');
  return missing;
}
