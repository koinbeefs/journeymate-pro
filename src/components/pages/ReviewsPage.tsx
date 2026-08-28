import { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Star, ThumbsUp, MapPin, TrendingUp, Award, MessageSquare,
  Plus, Flame, Filter, Globe, Loader2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useTrip } from "@/hooks/useTrip";
import { useReviews } from "@/hooks/useReviews";
import { useAuth } from "@/auth/AuthProvider";
import api from "@/lib/api";

const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };
const container = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

function HeatmapMap({ data }: { data: any[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // 1. Initialize map only once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, {
      center: [13.5, 121.0], zoom: 7, zoomControl: false, attributionControl: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      className: "map-tiles-dark"
    }).addTo(map);

    layerGroupRef.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // 2. Render data when it changes
  useEffect(() => {
    if (!layerGroupRef.current) return;

    layerGroupRef.current.clearLayers();

    data.forEach((point: [number, number, number]) => {
      L.circle([point[0], point[1]], {
        radius: point[2] * 25000, color: "transparent",
        fillColor: `hsl(162, 72%, ${30 + point[2] * 30}%)`,
        fillOpacity: 0.4 + point[2] * 0.3,
      }).addTo(layerGroupRef.current!);
    });
  }, [data]);

  return <div ref={mapRef} className="h-72 w-full relative z-0" />;
}

export default function ReviewsPage() {
  const { active: trip } = useTrip();
  const { user } = useAuth();
  const { reviews: apiReviews, createReview, isLoading } = useReviews(trip?.id?.toString());
  const [liveHeatmapData, setLiveHeatmapData] = useState<any[]>([]);

  useEffect(() => {
    api.get('/heatmap').then(res => setLiveHeatmapData(res.data)).catch(console.error);
  }, []);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewText, setReviewText] = useState("");
  const [reviewLocation, setReviewLocation] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [helpfulIds, setHelpfulIds] = useState<string[]>([]);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  // Filters for the Reviews tab
  const [sortKey, setSortKey] = useState<"recent" | "rating-high" | "rating-low">("recent");
  const [sourceFilter, setSourceFilter] = useState<"all" | "app" | "google">("all");

  const mergedReviews = useMemo(() => {
    // Convert API reviews to the format expected by the UI
    const mappedApiReviews = apiReviews.map((r: any) => ({
      id: r.id?.toString() || Math.random().toString(),
      userId: r.user_id?.toString(),
      userName: r.user?.username || r.user?.name || "App User",
      userAvatar: r.user?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.user_id}`,
      locationId: r.place_id || "unknown",
      locationName: r.place_name || "Unknown Place",
      rating: r.rating || 5,
      comment: r.review_text || "",
      images: [],
      timestamp: r.created_at || new Date().toISOString(),
      helpful: 0,
      source: "app" as const
    }));

    let list = [...mappedApiReviews];
    if (sourceFilter !== "all") list = list.filter(r => r.source === sourceFilter);
    if (sortKey === "recent") list.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
    else if (sortKey === "rating-high") list.sort((a, b) => b.rating - a.rating);
    else list.sort((a, b) => a.rating - b.rating);
    return list;
  }, [apiReviews, sortKey, sourceFilter]);


  const handleSubmitReview = async () => {
    if (!reviewText.trim() || !reviewLocation.trim() || !trip) return;

    try {
      await createReview.mutateAsync({
        trip_id: trip.id.toString(),
        place_name: reviewLocation,
        rating: reviewRating,
        review_text: reviewText
      });

      toast({ title: "⭐ Review Published!", description: `Your review of "${reviewLocation}" has been posted.` });
      setReviewText("");
      setReviewLocation("");
      setReviewRating(5);
      setReviewOpen(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit review.", variant: "destructive" });
    }
  };

  const toggleHelpful = (id: string) => {
    const isHelpful = helpfulIds.includes(id);
    setHelpfulIds(prev => isHelpful ? prev.filter(h => h !== id) : [...prev, id]);
    if (!isHelpful) toast({ title: "👍 Marked Helpful" });
  };

  const handleReply = (reviewId: string) => {
    if (!replyText.trim()) return;
    toast({ title: "💬 Reply Posted!", description: "Your reply has been added." });
    setReplyText("");
    setReplyingTo(null);
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="px-4 py-4 pb-6 space-y-4">
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-xl tracking-tight">Reviews & Heatmap</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Your travel footprint</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 rounded-xl shadow-travel text-xs font-semibold" onClick={() => setReviewOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Review
        </Button>
      </motion.div>

      <Tabs defaultValue="heatmap">
        <TabsList className="w-full h-10 p-1 rounded-xl bg-muted">
          <TabsTrigger value="heatmap" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Heatmap</TabsTrigger>
          <TabsTrigger value="reviews" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Reviews</TabsTrigger>
          <TabsTrigger value="stats" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="heatmap" className="space-y-4 mt-3">
          <motion.div variants={item}>
            <Card className="border-0 card-elevated overflow-hidden">
              <CardContent className="p-0 relative">
                <HeatmapMap data={liveHeatmapData} />
                <div className="absolute bottom-3 right-3 glass-ultra rounded-xl px-3 py-2 z-[400]">
                  <div className="flex items-center gap-3 text-[9px] font-medium">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-primary/30" /> Low</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-primary/60" /> Med</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-primary" /> High</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={item} className="grid grid-cols-3 gap-2">
            {[
              { label: "Places Saved", value: user?.stats?.saved || 0, icon: MapPin },
              { label: "Trips Created", value: user?.stats?.trips || 0, icon: TrendingUp },
              { label: "Reviews Posted", value: user?.stats?.reviews || 0, icon: MessageSquare },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label} className="border-0 card-interactive">
                <CardContent className="p-3 text-center">
                  <Icon className="w-4 h-4 mx-auto mb-1 text-primary" />
                  <p className="font-display font-bold text-lg leading-none">{value}</p>
                  <p className="text-[9px] text-muted-foreground font-medium mt-1">{label}</p>
                </CardContent>
              </Card>
            ))}
          </motion.div>

          <motion.div variants={item}>
            <h3 className="section-header mb-3 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-accent" /> Most Visited
            </h3>
            <Card className="border-0 card-elevated">
              <CardContent className="p-3.5">
                {[...liveHeatmapData].sort((a, b) => b[2] - a[2]).slice(0, 5).map((point, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/30 last:border-0">
                    <span className="text-xs font-display font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold">{point[3] || `Location ${point[0].toFixed(2)}, ${point[1].toFixed(2)}`}</p>
                      <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, point[2] * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground font-semibold">{Math.round(point[2] * 100)}%</span>
                  </div>
                ))}
                {liveHeatmapData.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No visits recorded yet</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="reviews" className="space-y-3 mt-3">
          {/* Filter bar */}
          <motion.div variants={item}>
            <Card className="border-0 card-elevated">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <Filter className="w-3 h-3" /> Filters
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                    <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent" className="text-xs">Most recent</SelectItem>
                      <SelectItem value="rating-high" className="text-xs">Highest rated</SelectItem>
                      <SelectItem value="rating-low" className="text-xs">Lowest rated</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
                    <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All sources</SelectItem>
                      <SelectItem value="app" className="text-xs">App users</SelectItem>
                      <SelectItem value="google" className="text-xs">Google / Web</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[10px] text-muted-foreground text-center">{mergedReviews.length} review{mergedReviews.length === 1 ? "" : "s"}</p>
              </CardContent>
            </Card>
          </motion.div>

          {isLoading && apiReviews.length === 0 ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : mergedReviews.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No reviews match these filters.</p>
          ) : (
            mergedReviews.map(review => (
              <motion.div key={review.id} variants={item}>
                <Card className="border-0 card-interactive">
                  <CardContent className="p-3.5">
                    <div className="flex items-start gap-2.5">
                      <img src={review.userAvatar} className="w-9 h-9 rounded-xl flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-[13px] font-semibold">{review.userName}</p>
                          <Badge variant="outline" className="text-[9px] h-[16px] gap-0.5">
                            {review.source === "google" ? <Globe className="w-2 h-2" /> : null}
                            {review.source === "google" ? "Web" : "App"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">{review.locationName}</span>
                          <span className="text-[10px] text-muted-foreground/70">· {new Date(review.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-0.5 mt-1.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={`w-3 h-3 ${i < review.rating ? "text-accent fill-accent" : "text-muted"}`} />
                          ))}
                        </div>
                        <p className="text-xs mt-2 leading-relaxed text-foreground/80">{review.comment}</p>
                        <div className="flex items-center gap-3 mt-2.5">
                          <Button
                            variant="ghost" size="sm"
                            className={`h-7 text-[10px] gap-1 rounded-lg ${helpfulIds.includes(review.id) ? "text-primary" : "text-muted-foreground"}`}
                            onClick={() => toggleHelpful(review.id)}
                          >
                            <ThumbsUp className={`w-3 h-3 ${helpfulIds.includes(review.id) ? "fill-primary" : ""}`} />
                            {review.helpful + (helpfulIds.includes(review.id) ? 1 : 0)}
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 text-[10px] gap-1 text-muted-foreground rounded-lg"
                            onClick={() => setReplyingTo(replyingTo === review.id ? null : review.id)}
                          >
                            <MessageSquare className="w-3 h-3" /> Reply
                          </Button>
                        </div>
                        {replyingTo === review.id && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-2 flex gap-2">
                            <Input
                              value={replyText}
                              onChange={e => setReplyText(e.target.value)}
                              onKeyDown={e => e.key === "Enter" && handleReply(review.id)}
                              placeholder="Write a reply..."
                              className="h-8 text-[11px] border-0 bg-muted rounded-lg"
                            />
                            <Button size="sm" className="h-8 text-[10px] rounded-lg px-3" onClick={() => handleReply(review.id)} disabled={!replyText.trim()}>
                              Send
                            </Button>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))
          )}
        </TabsContent>


        <TabsContent value="stats" className="space-y-3 mt-3">
          <motion.div variants={item}>
            <Card className="border-0 card-elevated">
              <CardContent className="p-4">
                <h3 className="section-header mb-4">Travel Statistics</h3>
                <div className="space-y-4">
                  {[
                    { label: "XP Progress", value: `${Intl.NumberFormat("en-US").format(user?.stats?.current_xp || 0)} XP`, pct: Math.min(100, ((user?.stats?.current_xp || 0) / (user?.stats?.next_level_xp || 1000)) * 100) },
                    { label: "Total Distance", value: `${Intl.NumberFormat("en-US").format(user?.stats?.total_distance_km || 0)} km`, pct: Math.min(100, (user?.stats?.total_distance_km || 0) / 10) },
                    { label: "Cities Explored", value: String(user?.stats?.cities || 0), pct: Math.min(100, (user?.stats?.cities || 0) * 10) },
                    { label: "Places Saved", value: String(user?.stats?.saved || 0), pct: Math.min(100, (user?.stats?.saved || 0) * 5) },
                    { label: "Trips Created", value: String(user?.stats?.trips || 0), pct: Math.min(100, (user?.stats?.trips || 0) * 10) },
                    { label: "Reviews Written", value: String(user?.stats?.reviews || 0), pct: Math.min(100, (user?.stats?.reviews || 0) * 20) },
                    { label: "Photos Shared", value: String(user?.stats?.photos || 0), pct: Math.min(100, (user?.stats?.photos || 0) * 5) },
                  ].map(stat => (
                    <div key={stat.label}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-muted-foreground font-medium">{stat.label}</span>
                        <span className="font-semibold">{stat.value}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stat.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>

      {/* Add Review Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Write a Review</DialogTitle>
            <DialogDescription>Share your experience</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {!trip && (
              <div className="text-xs text-destructive mb-2">You must select an active trip first to review places in it.</div>
            )}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Location</label>
              <Input value={reviewLocation} onChange={e => setReviewLocation(e.target.value)} placeholder="e.g. Tagaytay Ridge" className="mt-1.5 h-10 rounded-xl border-border" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Rating</label>
              <div className="flex gap-1 mt-1.5">
                {[1, 2, 3, 4, 5].map(r => (
                  <button key={r} onClick={() => setReviewRating(r)} className="p-1">
                    <Star className={`w-6 h-6 transition-colors ${r <= reviewRating ? "text-accent fill-accent" : "text-muted"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Your Review</label>
              <textarea
                value={reviewText}
                onChange={e => setReviewText(e.target.value)}
                placeholder="Tell others about your experience..."
                className="mt-1.5 w-full h-24 p-3 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
          <Button
            className="w-full h-10 rounded-xl shadow-travel font-semibold"
            onClick={handleSubmitReview}
            disabled={!reviewText.trim() || !reviewLocation.trim() || !trip || createReview.isPending}
          >
            {createReview.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Star className="w-4 h-4 mr-1" />}
            Publish Review
          </Button>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
