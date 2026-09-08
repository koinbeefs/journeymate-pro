// Pure-render timeline used inside ItineraryPage (and reusable for previews).
import { useState } from "react";
import { CheckCircle2, Circle, Clock, Navigation, Car, Bus, Train, Plane, Ship, Bike, Footprints, Layers, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ItineraryStop, TransitSegment, TransitType, WeatherCondition } from "@/types/travel";
import { TransitSegmentEditorModal } from "./TransitSegmentEditorModal";

const TRANSIT_ICONS: Record<TransitType, typeof Car> = {
  car: Car,
  bus: Bus,
  train: Train,
  plane: Plane,
  ferry: Ship,
  bike: Bike,
  walk: Footprints,
  jeepney: Bus,
  tricycle: Bike,
  uv_express: Bus,
  custom: Navigation,
};

const MODE_EMOJIS: Record<TransitType, string> = {
  car: "🚗",
  bus: "🚌",
  train: "🚆",
  plane: "✈️",
  ferry: "⛴️",
  bike: "🚴",
  walk: "🚶",
  jeepney: "🚐",
  tricycle: "🛺",
  uv_express: "🚐",
  custom: "📍",
};

const WEATHER_ICONS: Record<WeatherCondition, string> = {
  sunny: "☀️", cloudy: "⛅", rainy: "🌧️", stormy: "⛈️", snowy: "❄️", foggy: "🌫️", windy: "💨",
};

interface Props {
  stops: ItineraryStop[];
  onToggle?: (stopId: string) => void;
  onPick?: (stop: ItineraryStop) => void;
  onUpdateTransitSegments?: (stopId: string, segments: TransitSegment[]) => void;
}

export function ItineraryTimeline({ stops, onToggle, onPick, onUpdateTransitSegments }: Props) {
  const [editingStop, setEditingStop] = useState<ItineraryStop | null>(null);

  return (
    <div className="space-y-0">
      {stops.map((stop, idx) => {
        const TransitIcon = TRANSIT_ICONS[stop.transitType] || Navigation;
        const isNext = !stop.isCompleted && (idx === 0 || stops[idx - 1].isCompleted);
        const showDayHeader = idx === 0 || stop.dayNumber !== stops[idx - 1].dayNumber;
        const hasSegments = stop.transitSegments && stop.transitSegments.length > 0;

        return (
          <div key={stop.id} className="space-y-2">
            {showDayHeader && (
              <div className="flex items-center gap-2 pt-2.5 pb-2.5 first:pt-0">
                <span className="text-[10px] font-display font-bold text-primary tracking-wide uppercase bg-primary/10 px-2.5 py-1 rounded-lg">
                  Day {stop.dayNumber}
                </span>
                <div className="h-[1px] bg-border flex-1" />
              </div>
            )}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <button
                  onClick={() => onToggle?.(stop.id)}
                  disabled={!onToggle}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
                    stop.isCompleted ? "bg-success text-success-foreground shadow-sm"
                      : isNext ? "bg-primary text-primary-foreground shadow-travel"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {stop.isCompleted ? <CheckCircle2 className="w-4 h-4" /> : isNext ? <Navigation className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                </button>
                {idx < stops.length - 1 && (
                  <div className="flex flex-col items-center flex-1 my-0.5">
                    <div className={`w-0.5 h-6 ${stop.isCompleted ? "bg-success" : "bg-border"}`} />
                    {stops[idx + 1]?.distanceFromPrevious > 0 && (
                      <div className="text-[9px] text-muted-foreground flex flex-col items-center gap-0.5 my-1 bg-background/80 px-1 py-0.5 rounded shadow-sm border border-border/40">
                        <span>{Math.round(stops[idx + 1].distanceFromPrevious!)}km</span>
                        <span>{Math.round(stops[idx + 1].driveTimeFromPrevious!)}m</span>
                      </div>
                    )}
                    <div className={`w-0.5 min-h-6 flex-1 ${stop.isCompleted ? "bg-success" : "bg-border"}`} />
                  </div>
                )}
              </div>
              <Card
                onClick={() => onPick?.(stop)}
                className={`flex-1 border-0 mb-3 ${onPick ? "cursor-pointer" : ""} ${isNext ? "card-elevated ring-1 ring-primary/20" : "card-interactive"}`}
              >
                <CardContent className="p-3.5 space-y-2">
                  {isNext && <Badge className="text-[8px] h-[16px] bg-primary/10 text-primary font-bold border-0 mb-1">NEXT STOP</Badge>}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-[13px]">{stop.location.name}</h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{stop.notes}</p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {stop.weather && <span className="text-sm">{WEATHER_ICONS[stop.weather]}</span>}
                      {stop.temperature != null && <span className="text-xs font-semibold">{stop.temperature}°</span>}
                    </div>
                  </div>

                  {/* Multi-Modal Transit Segments Breakdown */}
                  {hasSegments ? (
                    <div className="p-2 rounded-lg bg-muted/40 border border-border/40 space-y-1.5 mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Transit Chain ({stop.transitSegments!.length} legs)
                        </span>
                        {onUpdateTransitSegments && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); setEditingStop(stop); }}
                            className="h-5 px-1.5 text-[9px] text-primary"
                          >
                            Edit Chain
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {stop.transitSegments!.map((seg, sIdx) => (
                          <div key={seg.id || sIdx} className="flex items-center gap-1">
                            <Badge variant="secondary" className="text-[9px] h-5 px-1.5 gap-1 font-medium bg-background border border-border/60">
                              <span>{MODE_EMOJIS[seg.type] || "📍"}</span>
                              <span>{seg.title}</span>
                              {seg.durationMinutes ? <span className="text-muted-foreground">({seg.durationMinutes}m)</span> : null}
                            </Badge>
                            {sIdx < stop.transitSegments!.length - 1 && <span className="text-[10px] text-muted-foreground font-bold">→</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px] h-5 gap-1 font-medium">
                          <Clock className="w-2.5 h-2.5" /> {stop.arrivalTime} - {stop.departureTime}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-5 gap-1 font-medium capitalize">
                          <TransitIcon className="w-2.5 h-2.5" /> {stop.transitType}
                        </Badge>
                      </div>

                      {onUpdateTransitSegments && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); setEditingStop(stop); }}
                          className="h-5 text-[9px] text-muted-foreground hover:text-primary gap-1 px-1.5"
                        >
                          <Plus className="w-2.5 h-2.5" /> Chained Transit
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        );
      })}

      {/* Transit Segment Modal */}
      {editingStop && (
        <TransitSegmentEditorModal
          open={!!editingStop}
          onOpenChange={(open) => !open && setEditingStop(null)}
          stopName={editingStop.location.name}
          initialSegments={editingStop.transitSegments}
          onSave={(segments) => {
            onUpdateTransitSegments?.(editingStop.id, segments);
            setEditingStop(null);
          }}
        />
      )}
    </div>
  );
}
