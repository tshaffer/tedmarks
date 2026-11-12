/**
 * The city from Google's address: "Mountain View" from "160 Castro St, Mountain View, CA 94041,
 * USA"; "Sydney" from "1 Macquarie Pl, Sydney NSW 2000, Australia"; "Cozumel" from "…, 77668
 * Cozumel, Q.R., Mexico" (postcodes and state codes dropped).
 */
export function cityFromAddress(address: string | undefined): string | undefined {
  const parts = (address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return undefined;
  const clean = (part: string) => part.split(/\s+/).filter((w) => !/\d/.test(w) && !/^[A-Z.]{2,4}$/.test(w)).join(' ');
  // Street, City [state postcode], Country — or Street, City, State postcode, Country.
  const city = clean(parts.length === 3 ? parts[1]! : parts[parts.length - 3]!);
  return city || undefined;
}
