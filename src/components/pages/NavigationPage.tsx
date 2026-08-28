import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Car, Bus, Footprints, Bike, ArrowRight, ArrowLeft, ArrowUp,
  CornerUpRight, CornerUpLeft, Flag, Gauge, Route, Locate,
  UtensilsCrossed, CloudSun, Navigation as NavIcon, Loader2, Lock, Unlock, Box, Signal, RotateCcw, Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fetchRoutePlan, formatDistance, formatDuration, RouteResult, RouteStep, RoutePlan } from "@/lib/routing";
import { RouteDetailsPanel } from "@/components/travel/RouteDetailsPanel";
import { MapLayerSwitcher, type MapStyle } from "@/components/travel/MapLayerSwitcher";
import { PlaceSearchInput } from "@/components/travel/PlaceSearchInput";
import { useGeolocation, distanceMeters } from "@/hooks/useGeolocation";
import { useVoiceGuide, loadVoicePrefs, saveVoicePrefs, type VoicePrefs } from "@/hooks/useVoiceGuide";
import { VoiceSettingsPopover } from "@/components/travel/VoiceSettingsPopover";
import { useWeather } from "@/hooks/useWeather";
import { tripSession } from "@/lib/tripSession";
import { saveOfflineRoute, loadOfflineRoute, saveTripOffline } from "@/lib/offlineRoute";
import type { Location } from "@/types/travel";
import { usePlaces } from "@/hooks/usePlaces";
import { offlineTileLayer } from "@/lib/offlineMap";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const dot = (color: string, size = 12) => L.divIcon({
  className: "",
  html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)"></div>`,
  iconSize: [size, size], iconAnchor: [size/2, size/2],
});
const carIcon = (heading: number | null) => L.divIcon({
  className: "",
  html: `
    <div style="position:relative;width:32px;height:32px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:hsl(162,72%,40%);border:3px solid white;box-shadow:0 0 0 5px hsla(162,72%,40%,.25),0 2px 8px rgba(0,0,0,.4);"></div>
      <div style="position:absolute;left:50%;top:-10px;transform:translateX(-50%) rotate(${heading ?? 0}deg);transform-origin:50% 26px;">
        <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid hsl(162,72%,30%);filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));"></div>
      </div>
    </div>`,
  iconSize: [32, 32], iconAnchor: [16, 16],
});

const transitModes = [
  { id: "car" as const, icon: Car, label: "Drive" },
  { id: "transit" as const, icon: Bus, label: "Commute" },
  { id: "walk" as const, icon: Footprints, label: "Walk" },
  { id: "bike" as const, icon: Bike, label: "Bike" },
];

const maneuverIcon = (m?: string, mod?: string) => {
  if (m === "arrive") return Flag;
  if (mod?.includes("left")) return m === "turn" ? CornerUpLeft : ArrowLeft;
  if (mod?.includes("right")) return m === "turn" ? CornerUpRight : ArrowRight;
  return ArrowUp;
};

// Rotation (deg) for a big on-map guidance arrow based on the next maneuver.
const maneuverRotation = (m?: string, mod?: string): number => {
  if (!mod) return 0;
  if (mod === "uturn") return 180;
  if (mod === "sharp left") return -135;
  if (mod === "left") return -90;
  if (mod === "slight left") return -45;
  if (mod === "sharp right") return 135;
  if (mod === "right") return 90;
  if (mod === "slight right") return 45;
  return 0;
};


// Whether a route segment passes a toll-ish corridor (very rough heuristic on mock data).
function routeHasToll(coords: [number, number][] | undefined, mode: string) {
  if (mode !== "car" || !coords?.length) return false;
  // Tag any leg that crosses south of 14.45 (SLEX-ish) as toll for the mock.
  return coords.some(([lat]) => lat < 14.45);
}

export default function NavigationPage() {
  const [selectedMode, setSelectedMode] = useState<"car" | "transit" | "walk" | "bike">("car");
  const [isNavigating, setIsNavigating] = useState(false);
  const [voicePrefs, setVoicePrefs] = useState<VoicePrefs>(() => loadVoicePrefs());
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [mapStyle, setMapStyle] = useState<MapStyle>("voyager");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [alternates, setAlternates] = useState<RouteResult[]>([]);
  const [speedLimits, setSpeedLimits] = useState<any[]>([]);
  const [selectedAltIdx, setSelectedAltIdx] = useState<number>(0); // 0 = primary
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [destination, setDestination] = useState<Location | null>(null);
  const [tripStops, setTripStops] = useState<Location[]>([]); // multi-leg from "Start the Trip"
  const [legIdx, setLegIdx] = useState(0);
  const [searchHidden, setSearchHidden] = useState(false);
  const [tripMode, setTripMode] = useState(false); // hides search/style/locate when launched from a trip
  const [isOnline, setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [tiltLocked, setTiltLocked] = useState(false); // when true, tilt stays flat during navigation
  const [followMode, setFollowMode] = useState(true); // auto-recenter on user as they move
  const [keepTiltOnRecenter, setKeepTiltOnRecenter] = useState(true); // preserve 3D tilt when pressing recenter
  const [keepTiltAfterStop, setKeepTiltAfterStop] = useState(false); // preserve tilt even after navigation stops
  const [manualTilt, setManualTilt] = useState(false); // user-forced tilt when not navigating
  // Locked start position for route calculation — prevents re-fetch on every GPS tick.
  // Only updated when a new destination is set or the user explicitly retries.
  const lockedStartRef = useRef<[number, number] | null>(null);
  const [accuracyThreshold, setAccuracyThreshold] = useState<number>(() => {
    if (typeof window === "undefined") return 40;
    const raw = window.localStorage.getItem("nav.accuracyThreshold");
    return raw ? Number(raw) : 40;
  });
  const [downloadingMap, setDownloadingMap] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => { try { window.localStorage.setItem("nav.accuracyThreshold", String(accuracyThreshold)); } catch {} }, [accuracyThreshold]);

  // Persist voice prefs
  useEffect(() => { saveVoicePrefs(voicePrefs); }, [voicePrefs]);
  useEffect(() => {
    const on = () => setIsOnline(true); const off = () => setIsOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Real GPS
  const { fix } = useGeolocation();
  const userPos = useMemo<[number, number] | null>(
    () => fix ? [fix.lat, fix.lng] : null,
    [fix?.lat, fix?.lng],
  );
  const startPoint: [number, number] = userPos ?? [14.5895, 120.9740];
  const { speak, cancel: cancelVoice } = useVoiceGuide(voicePrefs);

  // Dynamic API places for near-route suggestions (restaurants + gas stations)
  const { places: routeRestaurants } = usePlaces({ lat: startPoint[0], lng: startPoint[1], category: "restaurant" });
  const { places: routeGasStations } = usePlaces({ lat: startPoint[0], lng: startPoint[1], category: "gas-station" });

  const suggestionsAlongRoute = useMemo(() => {
    return [...routeRestaurants, ...routeGasStations];
  }, [routeRestaurants, routeGasStations]);

  // Weather along route (sampled at midpoint of current leg).
  const midCoord = route?.coordinates?.[Math.floor(route.coordinates.length / 2)];
  const { data: areaWeather } = useWeather(midCoord?.[0], midCoord?.[1]);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const altPolylinesRef = useRef<L.Polyline[]>([]);
  const traveledRef = useRef<L.Polyline | null>(null);
  const carMarkerRef = useRef<L.Marker | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);
  const startMarkerRef = useRef<L.Marker | null>(null);
  const eateryMarkersRef = useRef<L.Marker[]>([]);
  const accuracyRingRef = useRef<L.Circle | null>(null);
  const headingConeRef = useRef<L.Polygon | null>(null);
  const lastFittedRouteRef = useRef<string | null>(null); // prevents repeated fitBounds
  const hasAutoCentered = useRef(false);

  const tileUrls: Record<string, string> = {
    voyager: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    dark: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    light: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  };

  const handleDownloadMap = async () => {
    if (!mapInstance.current) return;
    setDownloadingMap(true);
    setDownloadProgress(0);
    
    const bounds = mapInstance.current.getBounds();
    try {
      const { downloadTiles } = await import("@/lib/offlineMap");
      await downloadTiles(
        bounds, 
        12, 16, 
        tileUrls[mapStyle],
        (dl, total) => setDownloadProgress(Math.round((dl / total) * 100))
      );
      toast({ title: "✅ Map Downloaded", description: "This area is available offline." });
    } catch (e) {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setDownloadingMap(false);
    }
  };

  // Hand-off from Itinerary "Start the Trip"
  useEffect(() => {
    const trip = tripSession.takeTrip();
    if (trip && trip.stops.length > 0) {
      if (trip.startFrom) {
        lockedStartRef.current = [trip.startFrom.lat, trip.startFrom.lng];
      }
      setTripStops(trip.stops.map(s => s.location));
      setDestination(trip.stops[0].location);
      setSearchHidden(true);
      setTripMode(true);
      toast({ title: "🧭 Trip Loaded", description: `${trip.stops.length} stops · ${trip.pace} pace` });
      return;
    }
    const dest = tripSession.takeDestination();
    if (dest) {
      setDestination(dest.location);
      setSearchHidden(true);
      setTripMode(false);
      return;
    }
    // No hand-off → if offline, restore the last cached route so navigation still works.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const cached = loadOfflineRoute();
      if (cached?.destination && cached.route) {
        setDestination(cached.destination);
        setRoute(cached.route);
        setSearchHidden(true);
        toast({ title: "📴 Offline Route Loaded", description: cached.destination.name });
      }
    }
  }, []);

  // Cache route + alternates + nearby places for offline use.
  useEffect(() => {
    if (!route || !destination) return;
    const nearby = suggestionsAlongRoute.filter(l =>
      route.coordinates.some(([rlat, rlng]) => Math.hypot(rlat - l.lat, rlng - l.lng) < 0.05),
    );
    saveOfflineRoute({ destination, route, alternates, nearby, mode: selectedMode });
    // Also key it by destination id so it can be restored per trip target.
    saveTripOffline(destination.id, {
      destination, route, alternates, nearby, mode: selectedMode, tripTitle: destination.name,
    });
  }, [route, alternates, destination, selectedMode, suggestionsAlongRoute]);

  // Swap the primary route with the selected alternate.
  const selectAlternate = (i: number) => {
    if (i === 0 || i > alternates.length) { setSelectedAltIdx(0); return; }
    const chosen = alternates[i - 1];
    const oldPrimary = route;
    if (!chosen || !oldPrimary) return;
    const newAlternates = alternates.slice();
    newAlternates[i - 1] = oldPrimary;
    setRoute(chosen);
    setAlternates(newAlternates);
    setSelectedAltIdx(0);
    setStepIdx(0);
    toast({ title: "🔀 Route Switched", description: `${chosen.label ?? "Alternate"} · ${formatDuration(chosen.duration)}` });
  };


  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      center: startPoint, zoom: 13, zoomControl: false, attributionControl: false,
    });
    const tileOptions = {
      className: mapStyle === "dark" ? "map-tiles-dark" : "",
    };
    tileRef.current = offlineTileLayer(tileUrls[mapStyle], tileOptions).addTo(map);
    mapInstance.current = map;
    // User-initiated drag disables follow-mode so the map doesn't fight them
    map.on("dragstart", () => setFollowMode(false));
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update map style when it changes
  useEffect(() => { 
    if (tileRef.current) {
      tileRef.current.setUrl(tileUrls[mapStyle]); 
      // Update className dynamically (Leaflet doesn't have a direct method for this, so we manipulate the DOM element)
      const container = tileRef.current.getContainer();
      if (container) {
        if (mapStyle === "dark") {
          container.classList.add("map-tiles-dark");
        } else {
          container.classList.remove("map-tiles-dark");
        }
      }
    }
  }, [mapStyle]);

  // Auto-center on user's location when it first becomes available
  useEffect(() => {
    if (mapInstance.current && userPos && !route && !hasAutoCentered.current) {
      mapInstance.current.setView(userPos, 14);
      hasAutoCentered.current = true;
    }
  }, [userPos, route]);

  // When tilt mode flips, give Leaflet a beat to recompute its viewport.
  useEffect(() => {
    const t = setTimeout(() => mapInstance.current?.invalidateSize(), 750);
    return () => clearTimeout(t);
  }, [isNavigating]);

  // Reliability tier from current GPS accuracy vs user-set threshold
  const reliability = useMemo(() => {
    const a = fix?.accuracy ?? 9999;
    if (a <= accuracyThreshold * 0.5) return { label: "Good", color: "hsl(162,72%,40%)", text: "white" };
    if (a <= accuracyThreshold) return { label: "Fair", color: "hsl(38,92%,50%)", text: "white" };
    return { label: "Poor", color: "hsl(0,75%,55%)", text: "white" };
  }, [fix?.accuracy, accuracyThreshold]);

  // Update start marker as GPS arrives
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !userPos) return;
    const accText = Math.round(fix?.accuracy ?? 0);
    const labelHtml = `
      <div role="img" aria-label="Your location, GPS signal ${reliability.label}${accText ? `, accurate within ${accText} meters` : ""}" style="position:relative;width:18px;height:18px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${reliability.color};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>
        <div style="position:absolute;top:20px;left:50%;transform:translateX(-50%);background:${reliability.color};color:${reliability.text};font:600 9px Inter,sans-serif;padding:1px 6px;border-radius:999px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);letter-spacing:.02em;">GPS · ${reliability.label}</div>
      </div>`;
    const icon = L.divIcon({ className: "", html: labelHtml, iconSize: [18, 18], iconAnchor: [9, 9] });
    if (!startMarkerRef.current) {
      startMarkerRef.current = L.marker(userPos, { icon }).bindPopup(`📍 You are here · ${reliability.label} GPS`).addTo(map);
    } else {
      startMarkerRef.current.setLatLng(userPos);
      startMarkerRef.current.setIcon(icon);
    }
    // GPS accuracy ring — radius from real accuracy, color from reliability tier
    const acc = Math.min(fix?.accuracy ?? 50, 250);
    if (!accuracyRingRef.current) {
      accuracyRingRef.current = L.circle(userPos, {
        radius: acc, color: reliability.color, weight: 1,
        fillColor: reliability.color, fillOpacity: 0.12,
      }).addTo(map);
    } else {
      accuracyRingRef.current.setLatLng(userPos);
      accuracyRingRef.current.setRadius(acc);
      accuracyRingRef.current.setStyle({ color: reliability.color, fillColor: reliability.color });
    }
  }, [userPos?.[0], userPos?.[1], fix?.accuracy, reliability.label]);

  // Update destination marker
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    destMarkerRef.current?.remove();
    if (destination) {
      destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: dot("#ef4444", 16) })
        .bindPopup(`🏁 ${destination.name}`).addTo(map);
    }
  }, [destination?.id]);

  // Fetch route plan — only when destination or mode changes, NOT on every GPS update.
  // We lock the start position at fetch time so GPS drift does not trigger constant re-fetches
  // which were previously overloading the backend and breaking route display.
  useEffect(() => {
    if (!destination) { setRoute(null); setAlternates([]); setRouteError(null); return; }

    // If we don't have a locked start yet (from hand-off) and GPS is still warming up, wait!
    if (!lockedStartRef.current && !userPos) {
      return; 
    }

    // Lock the start position for this fetch. Use current GPS if available.
    if (!lockedStartRef.current) {
      lockedStartRef.current = userPos;
    }
    const frozenStart = lockedStartRef.current;

    let cancelled = false;
    setLoadingRoute(true);
    setRouteError(null);

    fetchRoutePlan(frozenStart, [destination.lat, destination.lng], selectedMode)
      .then(plan => {
        if (cancelled) return;
        // Only accept the result if it has real geometry (more than 2 coords = actual road route)
        if (plan.primary.coordinates.length < 2) {
          setRouteError("Could not calculate route. Tap retry or check your connection.");
          setLoadingRoute(false);
          return;
        }
        setRoute(plan.primary);
        setAlternates(plan.alternates);
        setSpeedLimits(plan.speed_limits || []);
        setSelectedAltIdx(0);
        setStepIdx(0);
        setRouteError(null);
        setLoadingRoute(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRouteError("Route service unavailable. Using straight-line fallback.");
        setLoadingRoute(false);
      });

    return () => { cancelled = true; };
    // Intentionally excludes userPos/startPoint — GPS changes must NOT trigger route re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.id, selectedMode]);

  // Draw primary + alternate polylines + eateries along the way.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    polylineRef.current?.remove();
    traveledRef.current?.remove();
    altPolylinesRef.current.forEach(p => p.remove());
    altPolylinesRef.current = [];
    eateryMarkersRef.current.forEach(m => m.remove());
    eateryMarkersRef.current = [];
    if (!route) return;

    // Draw alternates first (underneath), muted + dashed.
    if (!tripMode) {
      alternates.forEach((alt, i) => {
        const isSelected = selectedAltIdx === i + 1;
        const pl = L.polyline(alt.coordinates, {
          color: isSelected ? "hsl(162, 72%, 40%)" : "hsl(220, 10%, 55%)",
          weight: isSelected ? 5 : 4,
          opacity: isSelected ? 0.85 : 0.55,
          dashArray: isSelected ? undefined : "6, 8",
        }).addTo(map);
        pl.on("click", () => setSelectedAltIdx(i + 1));
        altPolylinesRef.current.push(pl);
      });
    }

    const primaryIsActive = selectedAltIdx === 0;
    polylineRef.current = L.polyline(route.coordinates, {
      color: primaryIsActive ? "hsl(162, 72%, 40%)" : "hsl(220, 10%, 55%)",
      weight: primaryIsActive ? 5 : 4,
      opacity: primaryIsActive ? 0.85 : 0.55,
      dashArray: primaryIsActive ? undefined : "6, 8",
    }).addTo(map);
    polylineRef.current.on("click", () => setSelectedAltIdx(0));
    traveledRef.current = L.polyline([], {
      color: "hsl(162, 72%, 25%)", weight: 6, opacity: 1,
    }).addTo(map);

    // Suggestions (eateries + gas stations) near the active route from API
    const activeRoute = selectedAltIdx === 0 ? route : alternates[selectedAltIdx - 1] ?? route;
    const itemsNearRoute = suggestionsAlongRoute.filter(l =>
      activeRoute.coordinates.some(([rlat, rlng]) => Math.hypot(rlat - l.lat, rlng - l.lng) < 0.05)
    );
    itemsNearRoute.forEach(e => {
      const isGas = e.type === "gas-station";
      const iconEmoji = isGas ? "⛽" : "🍽️";
      const iconColor = isGas ? "#3b82f6" : "#f59e0b"; // blue for gas, amber for food
      const labelText = isGas ? "gas station along your route" : "along your route";
      
      const mk = L.marker([e.lat, e.lng], { icon: dot(iconColor, 10) })
        .bindPopup(`<strong>${iconEmoji} ${e.name}</strong><br/><small>${e.rating ? e.rating + "★ " : ""}${labelText}</small>`).addTo(map);
      eateryMarkersRef.current.push(mk);
    });

    // Only fit bounds when a genuinely new route loads — not on alt clicks or eatery changes.
    const routeFingerprint = `${route.distance}-${route.duration}-${selectedAltIdx}`;
    if (!isNavigating && activeRoute.coordinates.length > 1 && lastFittedRouteRef.current !== routeFingerprint) {
      lastFittedRouteRef.current = routeFingerprint;
      const bounds = L.latLngBounds(activeRoute.coordinates);
      const maxZoom = selectedMode === "walk" ? 17 : selectedMode === "bike" ? 16 : 15;
      map.fitBounds(bounds, { padding: [40, 40], maxZoom });
    }
  }, [route, alternates, selectedAltIdx, tripMode, selectedMode, suggestionsAlongRoute]);

  // Live GPS follow: snap user position to the route, advance steps, voice prompts
  useEffect(() => {
    if (!isNavigating || !route || !userPos) return;
    const map = mapInstance.current;
    if (!map) return;

    // Update car marker = user position (with heading-aware arrow)
    if (!carMarkerRef.current) {
      carMarkerRef.current = L.marker(userPos, { icon: carIcon(fix?.heading ?? null), zIndexOffset: 1000 }).addTo(map);
    } else {
      carMarkerRef.current.setLatLng(userPos);
      carMarkerRef.current.setIcon(carIcon(fix?.heading ?? null));
    }
    if (followMode) map.panTo(userPos, { animate: true });

    // Find nearest coordinate on route -> draw traveled polyline up to that index
    let minIdx = 0, minD = Infinity;
    route.coordinates.forEach((c, i) => {
      const d = Math.hypot(c[0] - userPos[0], c[1] - userPos[1]);
      if (d < minD) { minD = d; minIdx = i; }
    });
    traveledRef.current?.setLatLngs(route.coordinates.slice(0, minIdx + 1));

    // Advance step when within ~50m of next step's maneuver point
    const next = route.steps[stepIdx + 1];
    if (next) {
      const dToNext = distanceMeters({ lat: userPos[0], lng: userPos[1] }, { lat: next.location[0], lng: next.location[1] });
      if (dToNext < 50) {
        setStepIdx(s => s + 1);
        speak(next.instruction);
      }
    }

    // Arrived?
    const dest = route.coordinates[route.coordinates.length - 1];
    if (distanceMeters({ lat: userPos[0], lng: userPos[1] }, { lat: dest[0], lng: dest[1] }) < 30) {
      speak("You have arrived at your destination.");
      toast({ title: "🏁 You have arrived!", description: destination?.name ?? "" });
      // multi-leg: advance to next stop
      if (tripStops.length && legIdx < tripStops.length - 1) {
        const nextLeg = tripStops[legIdx + 1];
        setLegIdx(i => i + 1);
        setDestination(nextLeg);
        setStepIdx(0);
        toast({ title: "➡️ Next Stop", description: nextLeg.name });
      } else {
        setIsNavigating(false);
      }
    }
  }, [userPos?.[0], userPos?.[1], isNavigating, route, stepIdx]);

  // Stop -> clean car marker + voice
  useEffect(() => {
    if (!isNavigating) {
      carMarkerRef.current?.remove();
      carMarkerRef.current = null;
      traveledRef.current?.setLatLngs([]);
      cancelVoice();
    }
  }, [isNavigating, cancelVoice]);

  // Periodically suggest a nearby eatery while navigating
  useEffect(() => {
    if (!isNavigating || !route) return;
    const id = setInterval(() => {
      const eateries = suggestionsAlongRoute.filter(l =>
        (l.type === "restaurant" || l.type === "poi") &&
        route.coordinates.some(([rlat, rlng]) => Math.hypot(rlat - l.lat, rlng - l.lng) < 0.05),
      );
      if (!eateries.length) return;
      const pick = eateries[Math.floor(Math.random() * eateries.length)];
      toast({ title: "🍽️ Eatery Ahead", description: `${pick.name} · ${pick.rating ?? ""}★` });
    }, 45000);
    return () => clearInterval(id);
  }, [isNavigating, route, suggestionsAlongRoute]);

  // Weather monitor along the way
  useEffect(() => {
    if (!isNavigating || !areaWeather) return;
    toast({ title: `${areaWeather.condition} ${areaWeather.tempC}°C ahead`, description: areaWeather.summary });
  }, [isNavigating, areaWeather?.condition]);

  const handleLocate = () => {
    if (!mapInstance.current || !userPos) return;
    mapInstance.current.panTo(userPos, { animate: true });
    setFollowMode(true); // re-engage follow on recenter
    // Tilt is preserved unless the user explicitly disabled keepTiltOnRecenter
    if (!keepTiltOnRecenter && isNavigating) setTiltLocked(true);
    toast({
      title: "📍 Centered on Your Location",
      description: keepTiltOnRecenter ? "Follow-mode on · 3D tilt preserved" : "Follow-mode on",
    });
  };

  const handleStartNav = () => {
    if (!route) return;
    setIsNavigating(v => !v);
    if (!isNavigating) {
      const first = route.steps[0]?.instruction ?? "Starting navigation";
      toast({ title: "🧭 Navigation Started", description: first });
      speak(first);
      setSheetExpanded(false);
      setFollowMode(true); // always follow when starting
    } else {
      toast({ title: "⏹️ Navigation Stopped", description: keepTiltAfterStop ? "3D tilt kept (Keep tilt ON)" : "View reset to top-down" });
      setSheetExpanded(true);
      // Auto-reset 3D unless the user has Keep tilt enabled
      if (!keepTiltAfterStop) {
        setManualTilt(false);
        setTiltLocked(false);
      }
    }
  };

  const handleResetTilt = () => {
    setManualTilt(false);
    setTiltLocked(false);
    setIsNavigating(false);
    toast({ title: "🗺️ View Reset", description: "Back to top-down" });
  };

  const handlePickDestination = (place: Location) => {
    // Reset the locked start so the new route uses current GPS position.
    lockedStartRef.current = null;
    setDestination(place);
    setRoute(null);
    setAlternates([]);
    setRouteError(null);
    setSearchHidden(true);
    toast({ title: "📍 Destination Set", description: place.name });
  };

  const currentStep: RouteStep | undefined = route?.steps[stepIdx];
  const nextStep: RouteStep | undefined = route?.steps[stepIdx + 1];
  const ManeuverIcon = maneuverIcon(nextStep?.maneuver ?? currentStep?.maneuver, nextStep?.modifier ?? currentStep?.modifier);
  const showToll = routeHasToll(route?.coordinates, selectedMode);

  // Tilt is on during navigation (unless locked flat) OR when user kept tilt after stop
  const tilt3D = ((isNavigating || (manualTilt && keepTiltAfterStop)) && !tiltLocked);

  return (
    <div className="relative h-[calc(100dvh-7rem)] overflow-hidden">
      {/* Screen-reader live region announcing GPS reliability changes */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        GPS signal {reliability.label}{fix?.accuracy ? `, accurate within ${Math.round(fix.accuracy)} meters` : ""}
      </div>
      {/* Map layer — isolated 3D context so siblings aren't pushed behind in stacking */}
      <div className="absolute inset-0 z-0 overflow-hidden" style={{ perspective: "1400px", perspectiveOrigin: "50% 85%" }}>
        <div
          className="absolute inset-0 transition-transform duration-700 ease-out will-change-transform"
          ref={mapRef}
          style={{
            transform: tilt3D
              ? "translateY(12%) scale(1.7) rotateX(55deg)"
              : "translateY(0) scale(1) rotateX(0deg)",
            transformOrigin: "50% 75%",
          }}
        />
      </div>

      {/* Controls layer — flat, never affected by 3D, never clipped */}
      <div className="pointer-events-none absolute inset-0 z-30">
        <div className="pointer-events-auto absolute top-3 right-3 flex flex-col items-end gap-2 max-w-[calc(100%-1.5rem)]">
          {!tripMode && <MapLayerSwitcher value={mapStyle} onChange={setMapStyle} />}
          {!isOnline && (
            <Badge className="bg-amber-500 text-white text-[9px] h-5">Offline mode</Badge>
          )}
          <div className="flex flex-col gap-2 items-end">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-full bg-card/95 backdrop-blur-sm shadow-card-hover border-border/50 overflow-hidden relative"
              onClick={handleDownloadMap}
              disabled={downloadingMap}
              title="Download Offline Map"
            >
              {downloadingMap ? (
                <>
                  <div className="absolute inset-0 bg-primary/20" style={{ height: `${100 - downloadProgress}%` }} />
                  <span className="text-[9px] font-bold z-10">{downloadProgress}%</span>
                </>
              ) : (
                <Download className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="default"
              size="icon"
              className={`h-11 w-11 rounded-full shadow-travel ${followMode ? "glow-primary" : "bg-card text-foreground hover:bg-card/90"}`}
              onClick={handleLocate}
              aria-label="Recenter on my location"
              title={followMode ? "Following — tap to recenter" : "Recenter & resume follow"}
            >
              <Locate className={`w-5 h-5 ${followMode ? "" : "opacity-70"}`} />
            </Button>
            {isNavigating && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-10 w-10 rounded-full backdrop-blur-sm shadow-card-hover border-border/50 ${tiltLocked ? "bg-card/95" : "bg-primary text-primary-foreground"}`}
                  onClick={() => setTiltLocked(v => !v)}
                  aria-label={tiltLocked ? "Unlock 3D tilt" : "Lock view flat"}
                  title={tiltLocked ? "Unlock 3D tilt" : "Lock view flat"}
                >
                  {tiltLocked ? <Lock className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                </Button>
              </>
            )}
            {/* Reset 3D — visible whenever tilt is currently applied */}
            {tilt3D && !isNavigating && (
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full bg-card/95 backdrop-blur-sm shadow-card-hover border-border/50"
                onClick={handleResetTilt}
                aria-label="Reset 3D tilt"
                title="Reset to top-down"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            )}
            {/* GPS reliability + threshold setting */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-card/95 backdrop-blur-sm shadow-card-hover border border-border/50 text-[10px] font-semibold"
                  title="GPS reliability & threshold"
                  style={{ color: reliability.color }}
                >
                  <Signal className="w-3.5 h-3.5" />
                  <span>{reliability.label}</span>
                  <span className="text-muted-foreground font-normal">· ≤{accuracyThreshold}m</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold mb-1">GPS Accuracy Threshold</p>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Fix within <span className="font-semibold">{accuracyThreshold}m</span> is considered reliable. Half of that is "Good".
                  </p>
                  <Slider value={[accuracyThreshold]} min={10} max={120} step={5} onValueChange={([v]) => setAccuracyThreshold(v)} />
                  <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                    <span>Strict 10m</span><span>Loose 120m</span>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/40">
                  <div>
                    <p className="text-[11px] font-semibold">Keep tilt after stop</p>
                    <p className="text-[9px] text-muted-foreground">Stay in 3D when navigation ends</p>
                  </div>
                  <Switch checked={keepTiltAfterStop} onCheckedChange={setKeepTiltAfterStop} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold">Keep tilt on recenter</p>
                    <p className="text-[9px] text-muted-foreground">Preserve 3D when pressing GPS</p>
                  </div>
                  <Switch checked={keepTiltOnRecenter} onCheckedChange={setKeepTiltOnRecenter} />
                </div>
                <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                  Current: <span className="font-semibold" style={{ color: reliability.color }}>{reliability.label}</span>
                  {" · "}{Math.round(fix?.accuracy ?? 0)}m fix
                </div>
              </PopoverContent>
            </Popover>
            <VoiceSettingsPopover value={voicePrefs} onChange={setVoicePrefs} />
          </div>
        </div>
      </div>



      {/* Destination search — hidden in trip mode and after a pick to avoid disruption. */}
      <AnimatePresence>
        {!searchHidden && !tripMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="absolute top-4 left-4 z-30 w-full max-w-[280px]"
          >
            <PlaceSearchInput
              placeholder="Search destination…"
              onPick={handlePickDestination}
              className="bg-card/95 backdrop-blur-sm rounded-xl shadow-card-hover"
            />
          </motion.div>
        )}
        {searchHidden && destination && (
          <motion.div
            key="dest-pill"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="absolute top-4 left-4 z-30 w-full max-w-[280px]"
          >
            <button
              onClick={() => setSearchHidden(false)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-card/95 backdrop-blur-sm shadow-card-hover border border-border/50 text-left"
            >
              <NavIcon className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground">Destination</p>
                <p className="text-xs font-semibold truncate">{destination.name}</p>
              </div>
              {tripStops.length > 0 && (
                <Badge variant="outline" className="text-[9px] h-5">{legIdx + 1}/{tripStops.length}</Badge>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNavigating && nextStep && (
          <motion.div
            initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -50, opacity: 0 }}
            className="absolute top-16 left-4 z-30 w-full max-w-[280px]"
          >
            <Card className="border-0 shadow-travel-lg bg-primary text-primary-foreground overflow-hidden">
              <CardContent className="p-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary-foreground/15 flex items-center justify-center flex-shrink-0">
                    <ManeuverIcon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-bold text-base leading-tight truncate">{nextStep.instruction}</p>
                    <p className="text-xs opacity-80 mt-0.5">in {formatDistance(nextStep.distance)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-display font-bold text-lg leading-none">{formatDuration((route?.duration ?? 0) * (1 - stepIdx / Math.max(1, route?.steps.length ?? 1)))}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">remaining</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-primary-foreground/15">
                  <div className="flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{Math.round((fix?.speed ?? 0) * 3.6)} km/h</span>
                  </div>
                  {areaWeather && (
                    <Badge className="bg-primary-foreground/20 text-primary-foreground text-[9px] h-5 font-semibold gap-1">
                      <CloudSun className="w-2.5 h-2.5" /> {areaWeather.tempC}°C
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <span className="text-[10px] opacity-70">Step {stepIdx + 1} / {route?.steps.length}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Big on-map guidance arrow — mirrors the next maneuver so drivers can glance
          at the tilted 3D map and immediately see where to go. Hidden when arrived. */}
      <AnimatePresence>
        {isNavigating && nextStep && nextStep.maneuver !== "arrive" && (
          <motion.div
            key={`guide-${stepIdx}`}
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 z-20"
            style={{ bottom: sheetExpanded ? "38%" : "22%" }}
            role="img"
            aria-label={`Guidance arrow: ${nextStep.instruction}`}
          >
            <div className="relative">
              <div
                className="w-24 h-24 rounded-full bg-primary/85 backdrop-blur-md shadow-travel-lg border-4 border-white/90 flex items-center justify-center"
                style={{
                  transform: `rotate(${maneuverRotation(nextStep.maneuver, nextStep.modifier)}deg)`,
                  transition: "transform 500ms ease-out",
                }}
              >
                <ArrowUp className="w-12 h-12 text-primary-foreground drop-shadow" strokeWidth={3} />
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-card/95 backdrop-blur-sm shadow-card-hover border border-border/50 text-[10px] font-bold whitespace-nowrap">
                {formatDistance(nextStep.distance)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>



      <motion.div
        className="absolute bottom-0 left-0 right-0 glass-ultra rounded-t-3xl z-30 border-t border-border/30"
        animate={{ height: sheetExpanded ? "auto" : 28 }}
        transition={{ type: "spring", stiffness: 400, damping: 35 }}
      >
        <button className="flex justify-center w-full py-1.5" onClick={() => setSheetExpanded(!sheetExpanded)} aria-label="Toggle panel">
          <div className="w-9 h-1 rounded-full bg-border" />
        </button>


        <AnimatePresence>
          {sheetExpanded && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="px-4 pb-4 space-y-3"
            >
              {!destination && (
                <Card className="border-0 card-interactive">
                  <CardContent className="p-3 text-center text-xs text-muted-foreground">
                    Search a destination above to plan a route.
                  </CardContent>
                </Card>
              )}

              {/* Route error state with retry */}
              {routeError && (
                <Card className="border-0 border-l-2 border-l-destructive/60 bg-destructive/5">
                  <CardContent className="p-3 flex items-center gap-2">
                    <div className="flex-1">
                      <p className="text-[11px] font-semibold text-destructive">Route Error</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{routeError}</p>
                    </div>
                    <button
                      onClick={() => {
                        lockedStartRef.current = null;
                        setRoute(null);
                        setRouteError(null);
                        // Re-trigger by toggling destination (same object, new ref trick)
                        setDestination(d => d ? { ...d } : d);
                      }}
                      className="text-[10px] font-semibold text-primary px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors flex-shrink-0"
                    >
                      Retry
                    </button>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-2">
                {transitModes.map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => setSelectedMode(id)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all tap-highlight ${
                      selectedMode === id ? "bg-primary text-primary-foreground shadow-travel" : "bg-muted"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] font-semibold">{label}</span>
                    <span className={`text-[9px] ${selectedMode === id ? "opacity-70" : "text-muted-foreground"}`}>
                      {loadingRoute && selectedMode === id ? "…" : selectedMode === id && route ? formatDuration(route.duration) : "Tap to calc"}
                    </span>
                  </button>
                ))}
              </div>

              {/* Alternate route chips — appear when OSRM returned more than one path. */}
              {selectedMode !== "transit" && alternates.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
                    Choose a route
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {[route, ...alternates].filter(Boolean).map((r, i) => {
                      if (!r) return null;
                      const isActive = selectedAltIdx === i;
                      return (
                        <button
                          key={i}
                          onClick={() => selectAlternate(i)}
                          className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[10px] font-semibold transition-colors ${
                            isActive ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border/50 text-muted-foreground"
                          }`}
                        >
                          <Route className="w-3.5 h-3.5" />
                          <div className="text-left">
                            <p>{formatDuration(r.duration)}</p>
                            <p className={`text-[8px] truncate max-w-[80px] ${r.label === "toll-free" ? "text-emerald-500 font-bold" : "opacity-70"}`}>
                              {r.label === "toll-free" ? "Avoids Tolls" : (r.label ?? `Route ${i + 1}`)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {destination && (
                <div className="grid grid-cols-[1fr_auto] gap-2 items-start mt-2">
                  <div className="min-w-0 pr-2">
                    <h3 className="font-display font-bold text-[15px] truncate">{destination.name}</h3>
                    <p className="text-[10px] text-muted-foreground truncate">{destination.address || destination.description || "Unknown address"}</p>
                    {showToll && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-warning mt-1">
                        <Badge variant="outline" className="text-[8px] h-[16px] px-1 border-warning/30 text-warning bg-warning/10">Tolls</Badge>
                        This route has tolls
                      </div>
                    )}
                  </div>
                  {route && (
                    <Button
                      className={`h-10 rounded-xl px-6 font-display font-bold text-[13px] shadow-travel ${isNavigating ? "bg-destructive text-white hover:bg-destructive/90" : "glow-primary"}`}
                      onClick={handleStartNav}
                    >
                      {isNavigating ? "Stop" : "Go"}
                    </Button>
                  )}
                </div>
              )}

              {destination && (
                <RouteDetailsPanel routeCoords={route?.coordinates} mode={selectedMode} speedLimits={speedLimits} steps={route?.steps} />
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
