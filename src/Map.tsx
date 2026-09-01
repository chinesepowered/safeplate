import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Verdict } from "./ui";

export type Pin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  verdict?: Verdict;
  pending?: boolean;
  detail?: string;
};

/**
 * OpenStreetMap tiles through Leaflet, driven straight off the live query. The
 * pins are plain divs so a verdict change is a CSS colour transition — the
 * moment a restaurant turns green is the whole point of the product.
 */
export function VerdictMap({
  pins,
  onSelect,
  className = "",
}: {
  pins: Pin[];
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([43.4643, -80.5204], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const p of pins) {
      seen.add(p.id);
      const cls = p.pending
        ? "sp-pin sp-pin-pending"
        : `sp-pin sp-pin-${p.verdict ?? "unclear"}`;
      const icon = L.divIcon({
        className: "",
        html: `<div class="${cls}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const existing = markers.current.get(p.id);
      if (existing) {
        existing.setLatLng([p.lat, p.lng]);
        existing.setIcon(icon);
        existing.setTooltipContent(tooltip(p));
      } else {
        const m = L.marker([p.lat, p.lng], { icon })
          .addTo(map)
          .bindTooltip(tooltip(p), { direction: "top", offset: [0, -12] });
        m.on("click", () => onSelect?.(p.id));
        markers.current.set(p.id, m);
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }

    if (!fitted.current && pins.length) {
      fitted.current = true;
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // Leaflet needs a nudge when it is laid out inside a freshly mounted grid.
    setTimeout(() => map.invalidateSize(), 60);
  }, [pins, onSelect]);

  return <div ref={el} className={className} />;
}

function tooltip(p: Pin): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<strong>${esc(p.name)}</strong>${p.detail ? `<br/>${esc(p.detail)}` : ""}`;
}
