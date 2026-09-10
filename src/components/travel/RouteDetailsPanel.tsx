import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gauge, Fuel, Eye, AlertTriangle, ChevronDown, Receipt, Route, Flag, CornerUpLeft, CornerUpRight, ArrowUp, Bus, Footprints } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistance, type RouteStep } from "@/lib/routing";
import { useQuery } from "@tanstack/react-query";
import { placesApi } from "@/lib/api";
import type { TransitSegment } from "@/types/travel";

interface Props {
  routeCoords?: [number, number][];
  mode: "car" | "transit" | "walk" | "bike";
  speedLimits?: { name: string; max_speed: number }[];
  steps?: RouteStep[];
  transitSegments?: TransitSegment[];
  onSelectPlace?: (place: any) => void;
}

export function RouteDetailsPanel({ routeCoords, mode, speedLimits, steps, transitSegments, onSelectPlace }: Props) {
  const [open, setOpen] = useState(false);

  const { data: fuelStops = [] } = useQuery({
    queryKey: ['route_fuel', routeCoords?.length],
    queryFn: async () => {
      if (!routeCoords?.length) return [];
      const mid = routeCoords[Math.floor(routeCoords.length / 2)];
      const res = await placesApi.search({ lat: mid[0], lng: mid[1], query: "gas station" }).catch(() => ({ data: [] }));
      return res.data || [];
    },
    enabled: mode === "car" && !!routeCoords?.length,
  });

  const { data: viewpoints = [] } = useQuery({
    queryKey: ['route_views', routeCoords?.length],
    queryFn: async () => {
      if (!routeCoords?.length) return [];
      const mid = routeCoords[Math.floor(routeCoords.length / 2)];
      const res = await placesApi.search({ lat: mid[0], lng: mid[1], query: "viewpoint" }).catch(() => ({ data: [] }));
      return res.data || [];
    },
    enabled: mode !== "transit" && !!routeCoords?.length,
  });

  // Use highest speed limit on route, or fallback
  const maxSpeedInfo = useMemo(() => {
    if (speedLimits?.length) {
      return speedLimits.reduce((max, current) => 
        current.max_speed > max.max_speed ? current : max, 
        speedLimits[0]
      );
    }
    return { name: "Highway", max_speed: 60 };
  }, [speedLimits]);

  const limit = { kmh: maxSpeedInfo.max_speed, zone: maxSpeedInfo.name || "Highway" };
  
  // Restrictions per travel mode
  const restrictions = useMemo(() => {
    const list: string[] = [];
    if (mode === "car") {
      if (speedLimits?.some(s => s.name.includes("Expressway"))) {
        list.push("Tolls may apply on Expressway");
      }
    } else if (mode === "bike") {
      if (speedLimits?.some(s => s.name.includes("Expressway") || s.name.includes("Highway"))) {
        list.push("Bicycles prohibited on expressways & major tollways");
      }
      list.push("Use designated bike lanes & helmets where required");
    }
    return list;
  }, [mode, speedLimits]);

  return (
    <Card className="border-0 card-elevated">
      <CardContent className="p-0">
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between p-3 tap-highlight"
        >
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold">Route Details</span>
            <Badge variant="outline" className="text-[9px] h-5 font-semibold border-primary/20 text-primary">
              {mode === "transit" 
                ? (transitSegments?.length ? `${transitSegments.length} transit legs` : "Public Commute") 
                : mode === "car"
                ? `${fuelStops.length} gas · ${viewpoints.length} views`
                : `${viewpoints.length} views`}
            </Badge>
          </div>
          <motion.div animate={{ rotate: open ? 180 : 0 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-3 pt-0 space-y-3">
                {/* Car & Bike road info cards */}
                {(mode === "car" || mode === "bike") && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {mode === "car" && (
                        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-muted">
                          <div className="w-9 h-9 rounded-full border-2 border-destructive flex items-center justify-center flex-shrink-0 bg-white">
                            <span className="text-[12px] font-bold text-black">{limit.kmh}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold flex items-center gap-1"><Gauge className="w-3 h-3" /> Limit</p>
                            <p className="text-[9px] text-muted-foreground truncate">{limit.zone}</p>
                          </div>
                        </div>
                      )}
                      
                      <div className={`flex items-center gap-2 p-2.5 rounded-xl bg-muted ${mode === "bike" ? "col-span-2" : ""}`}>
                        <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold">{mode === "bike" ? "Bike Restrictions" : "Road Restrictions"}</p>
                          <p className="text-[9px] text-muted-foreground truncate">{restrictions.length} active</p>
                        </div>
                      </div>
                    </div>

                    {restrictions.length > 0 && (
                      <ul className="space-y-1">
                        {restrictions.map((r, i) => (
                          <li key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                            <span className="text-warning mt-0.5">•</span> {r}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}

                {/* Gas Stops & Scenic Viewpoints */}
                {mode !== "transit" && ((mode === "car" && fuelStops.length > 0) || viewpoints.length > 0) && (
                  <div className="grid grid-cols-2 gap-3">
                    {mode === "car" && fuelStops.length > 0 && (
                      <div className={viewpoints.length === 0 ? "col-span-2" : ""}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                          <Fuel className="w-3 h-3" /> Gas Stops Along Route
                        </p>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1 overscroll-contain">
                          {fuelStops.map((f: any) => (
                            <div 
                              key={f.id} 
                              className={`flex items-center justify-between p-2 rounded-lg bg-muted/50 ${onSelectPlace ? 'cursor-pointer hover:bg-muted active:scale-[0.98] transition-transform' : ''}`}
                              onClick={() => onSelectPlace && onSelectPlace(f)}
                            >
                              <span className="text-[11px] font-semibold truncate">{f.name}</span>
                              <span className="text-[9px] text-muted-foreground whitespace-nowrap ml-2">★ {f.rating || "N/A"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {viewpoints.length > 0 && (
                      <div className={(mode !== "car" || fuelStops.length === 0) ? "col-span-2" : ""}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                          <Eye className="w-3 h-3" /> Scenic Viewpoints
                        </p>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1 overscroll-contain">
                          {viewpoints.map((v: any) => (
                            <div 
                              key={v.id} 
                              className={`flex items-center justify-between p-2 rounded-lg bg-muted/50 ${onSelectPlace ? 'cursor-pointer hover:bg-muted active:scale-[0.98] transition-transform' : ''}`}
                              onClick={() => onSelectPlace && onSelectPlace(v)}
                            >
                              <span className="text-[11px] font-semibold truncate">{v.name}</span>
                              <span className="text-[9px] text-muted-foreground whitespace-nowrap ml-2">★ {v.rating || "N/A"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {transitSegments && transitSegments.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Bus className="w-3 h-3 text-primary" /> Public Transit Connections
                    </p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {transitSegments.map((seg, idx) => (
                        <div key={seg.id || idx} className="p-2 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-primary">{seg.title || `${seg.type ? seg.type.toUpperCase() : 'TRANSIT'} Leg ${idx + 1}`}</span>
                            <Badge variant="outline" className="text-[8px] h-4 capitalize">
                              {(seg.type || "transit").replace("_", " ")}
                            </Badge>
                          </div>
                          {seg.instructions && (
                            <p className="text-[10px] text-muted-foreground leading-snug">{seg.instructions}</p>
                          )}
                          <div className="flex items-center gap-3 text-[9px] text-muted-foreground font-medium pt-0.5">
                            {seg.agency && <span>Agency: {seg.agency}</span>}
                            {seg.durationMinutes && <span>~{seg.durationMinutes} mins</span>}
                            {seg.costEstimate && <span>₱{seg.costEstimate}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => {
                  const filteredSteps = mode === "transit"
                    ? (steps || []).filter(s => s.maneuver === "transit" || s.maneuver === "arrive" || s.instruction.toLowerCase().includes("board") || s.instruction.toLowerCase().includes("alight") || s.instruction.toLowerCase().includes("transfer") || s.instruction.toLowerCase().includes("walk") || s.instruction.toLowerCase().includes("tricycle"))
                    : (steps || []);

                  if (filteredSteps.length === 0) return null;

                  return (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                        <Route className="w-3 h-3" /> {mode === "transit" ? "Commute Step Instructions" : "Step-by-Step Directions"}
                      </p>
                      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {filteredSteps.map((s, idx) => {
                          const StepIcon = s.maneuver === "arrive" ? Flag : 
                                           s.maneuver === "transit" ? Bus :
                                           mode === "transit" ? Footprints :
                                           s.modifier?.includes("left") ? CornerUpLeft : 
                                           s.modifier?.includes("right") ? CornerUpRight : ArrowUp;
                          return (
                            <div key={idx} className="flex items-start gap-2.5 p-2 rounded-lg bg-muted/50">
                              <div className="w-6 h-6 rounded-md bg-background flex items-center justify-center flex-shrink-0 mt-0.5">
                                <StepIcon className="w-3.5 h-3.5 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold leading-snug">{s.instruction}</p>
                                {s.distance > 0 && (
                                  <p className="text-[9px] text-muted-foreground mt-0.5">{formatDistance(s.distance)}</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {routeCoords && (
                  <p className="text-[9px] text-muted-foreground text-center pt-1">
                    Total path: {formatDistance(routeCoords.length * 50)} of geometry sampled
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
