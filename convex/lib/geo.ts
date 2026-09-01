/**
 * Best-effort geocoding for the map pins, via OpenStreetMap's free Nominatim
 * service (no key, no SDK). A pin is a nicety: if this fails or the address is
 * vague the restaurant simply shows in the list without a pin, and nothing else
 * in the pipeline depends on it.
 */
export async function geocode(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!address || address.trim().length < 6) return null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(address);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "SafePlate/1.0 (Convex hackathon demo)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const rows: any = await res.json();
    const hit = Array.isArray(rows) ? rows[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
