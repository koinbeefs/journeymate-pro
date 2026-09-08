import React, { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Bus, Train, Ship, Bike, Footprints, Car, Sparkles, Navigation, DollarSign, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { TransitSegment, TransitType } from "@/types/travel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stopName?: string;
  initialSegments?: TransitSegment[];
  onSave: (segments: TransitSegment[]) => void;
}

const TRANSIT_MODE_OPTIONS: { type: TransitType; label: string; icon: string }[] = [
  { type: "tricycle", label: "Tricycle / Habal", icon: "🛺" },
  { type: "jeepney", label: "Jeepney", icon: "🚐" },
  { type: "bus", label: "Bus / Express", icon: "🚌" },
  { type: "uv_express", label: "UV Express", icon: "🚐" },
  { type: "train", label: "Train / LRT / MRT", icon: "🚆" },
  { type: "ferry", label: "Ferry / Boat", icon: "⛴️" },
  { type: "walk", label: "Walk / Transfer", icon: "🚶" },
  { type: "custom", label: "Custom Route", icon: "📍" },
];

export function TransitSegmentEditorModal({
  open,
  onOpenChange,
  stopName = "Itinerary Stop",
  initialSegments = [],
  onSave,
}: Props) {
  const [segments, setSegments] = useState<TransitSegment[]>(() => 
    initialSegments.length > 0 ? initialSegments : [
      {
        id: "seg_" + Date.now(),
        type: "jeepney",
        title: "Local Jeepney to Junction",
        departureName: "Terminal / Station",
        arrivalName: "Crossing Hub",
        durationMinutes: 20,
        costEstimate: 25,
      }
    ]
  );

  const [activeIdx, setActiveIdx] = useState<number>(0);

  const addSegment = () => {
    const newSeg: TransitSegment = {
      id: "seg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 5),
      type: "bus",
      title: "Bus Leg",
      departureName: "Departure Point",
      arrivalName: "Drop-off",
      durationMinutes: 30,
      costEstimate: 50,
    };
    setSegments((prev) => [...prev, newSeg]);
    setActiveIdx(segments.length);
  };

  const removeSegment = (idx: number) => {
    if (segments.length <= 1) return;
    setSegments((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => Math.max(0, prev - 1));
  };

  const updateSegment = (idx: number, patch: Partial<TransitSegment>) => {
    setSegments((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  };

  const moveSegment = (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= segments.length) return;
    setSegments((prev) => {
      const copy = [...prev];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
    setActiveIdx(targetIdx);
  };

  const handleSave = () => {
    onSave(segments);
    onOpenChange(false);
  };

  const totalCost = segments.reduce((sum, s) => sum + (s.costEstimate || 0), 0);
  const totalMins = segments.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border-0 shadow-2xl bg-card p-0">
        <DialogHeader className="p-5 border-b border-border/40 bg-muted/20">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary text-[10px] font-bold border-0">
              MULTI-MODAL TRANSIT
            </Badge>
          </div>
          <DialogTitle className="text-lg font-bold font-display mt-1">
            Build Transit Chain for {stopName}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Chain multiple local & public transport legs (e.g. Tricycle → Bus → Walk).
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-5">
          {/* Summary Badges */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border/50 text-xs font-semibold">
            <div className="flex items-center gap-1.5 text-primary">
              <Clock className="w-4 h-4" />
              <span>Total Est. Time: <strong className="text-foreground">{totalMins} mins</strong></span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <DollarSign className="w-4 h-4" />
              <span>Est. Fare: <strong className="text-foreground">₱{totalCost}</strong></span>
            </div>
          </div>

          {/* Segment List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Transit Segments ({segments.length})
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addSegment}
                className="h-7 text-[11px] gap-1 rounded-lg border-dashed"
              >
                <Plus className="w-3.5 h-3.5" /> Add Leg
              </Button>
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {segments.map((seg, idx) => {
                const isSelected = idx === activeIdx;
                const option = TRANSIT_MODE_OPTIONS.find((o) => o.type === seg.type) || TRANSIT_MODE_OPTIONS[0];
                return (
                  <div
                    key={seg.id}
                    onClick={() => setActiveIdx(idx)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                        : "border-border/60 bg-background hover:bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span className="text-xl flex-shrink-0">{option.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold truncate">{seg.title || option.label}</span>
                          <Badge variant="secondary" className="text-[9px] h-4 px-1 capitalize">
                            {seg.type.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {seg.departureName || "Start"} → {seg.arrivalName || "Drop-off"} · {seg.durationMinutes}m · ₱{seg.costEstimate}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={idx === 0}
                        onClick={(e) => { e.stopPropagation(); moveSegment(idx, -1); }}
                        className="h-6 w-6 text-muted-foreground"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={idx === segments.length - 1}
                        onClick={(e) => { e.stopPropagation(); moveSegment(idx, 1); }}
                        className="h-6 w-6 text-muted-foreground"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      {segments.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); removeSegment(idx); }}
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Segment Editor */}
          {segments[activeIdx] && (
            <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
              <h5 className="text-xs font-bold flex items-center gap-1.5 text-primary">
                <Sparkles className="w-3.5 h-3.5" /> Edit Leg #{activeIdx + 1}
              </h5>

              {/* Transit Type Grid */}
              <div>
                <Label className="text-[10px] font-semibold text-muted-foreground">Mode of Transit</Label>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {TRANSIT_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => updateSegment(activeIdx, { type: opt.type })}
                      className={`p-2 rounded-lg text-center transition-all flex flex-col items-center border ${
                        segments[activeIdx].type === opt.type
                          ? "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                          : "border-border/40 bg-background text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="text-base">{opt.icon}</span>
                      <span className="text-[9px] mt-0.5 truncate w-full">{opt.label.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title / Description */}
              <div>
                <Label className="text-[10px] font-semibold text-muted-foreground">Leg Title</Label>
                <Input
                  value={segments[activeIdx].title}
                  onChange={(e) => updateSegment(activeIdx, { title: e.target.value })}
                  placeholder="e.g. Tricycle to Capas Junction"
                  className="h-8 text-xs mt-0.5"
                />
              </div>

              {/* Boarding & Drop-off */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] font-semibold text-muted-foreground">Boarding Stop / Hub</Label>
                  <Input
                    value={segments[activeIdx].departureName || ""}
                    onChange={(e) => updateSegment(activeIdx, { departureName: e.target.value })}
                    placeholder="Capas Terminal"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-semibold text-muted-foreground">Drop-off Stop / Hub</Label>
                  <Input
                    value={segments[activeIdx].arrivalName || ""}
                    onChange={(e) => updateSegment(activeIdx, { arrivalName: e.target.value })}
                    placeholder="Mayantoc Crossing"
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
              </div>

              {/* Duration & Fare */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] font-semibold text-muted-foreground">Est. Duration (Minutes)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={segments[activeIdx].durationMinutes || 0}
                    onChange={(e) => updateSegment(activeIdx, { durationMinutes: Math.max(1, parseInt(e.target.value) || 0) })}
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-semibold text-muted-foreground">Est. Fare (PHP ₱)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={segments[activeIdx].costEstimate || 0}
                    onChange={(e) => updateSegment(activeIdx, { costEstimate: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="h-8 text-xs mt-0.5"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-border/40 bg-muted/10 gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-1 font-semibold">
            <Navigation className="w-3.5 h-3.5" /> Save Transit Chain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
