// Shared place-details modal: photo gallery, historical info, app user reviews
// (filterable by rating/recency/source/nearby), simulated Google reviews,
// and an optional Get Directions / Add Side Trip button.
import { useMemo, useState, useEffect } from "react";
import { Star, Navigation, Share2, MapPin, BookOpen, MessageSquare, Globe, Images, Camera, Loader2, X, Map } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useGeolocation, distanceMeters } from "@/hooks/useGeolocation";
import type { Location } from "@/types/travel";
import { useReviews } from "@/hooks/useReviews";
import { placesApi } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  place: Location | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  showDirections?: boolean;
  onNavigate?: (place: Location, action: "replace" | "add-side-trip") => void;
}

const HISTORY: Record<string, string> = {
  landmark: "This landmark has welcomed visitors for centuries. It played a key role during the Spanish colonial period and has been preserved as a national treasure since 1951.",
  hotel: "Opened in the early 1900s, this property has hosted heads of state, artists and luminaries. The architecture blends Beaux-Arts elegance with tropical motifs.",
  restaurant: "A modern reinterpretation of regional cuisine. The kitchen sources from a network of smallholder farms and changes its tasting menu seasonally.",
  viewpoint: "Formed by volcanic uplift, this ridge offers one of the most photographed panoramas in the country. Best visited near sunrise or just before sunset.",
  city: "A bustling urban district with origins as a fishing village. Today it's known for art galleries, contemporary architecture, and a vibrant food scene.",
  poi: "A favorite among locals and travelers alike, this spot has steadily grown in popularity over the past decade.",
  "gas-station": "A 24-hour fuel & rest station along the expressway with restrooms, convenience store and a small food court.",
};

interface ExtReview { author: string; avatar: string; rating: number; text: string; source: "Google" | "TripAdvisor"; timestamp: string; }
const GOOGLE_REVIEWS: ExtReview[] = [
  { author: "Jordan M.", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Jordan", rating: 5, text: "Absolutely worth the trip. Staff were friendly and the views are unreal.", source: "Google", timestamp: "2026-05-21T10:00:00Z" },
  { author: "Aria S.", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Aria", rating: 4, text: "Great experience overall, can get crowded on weekends — go early.", source: "Google", timestamp: "2026-04-12T10:00:00Z" },
  { author: "Diego R.", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Diego", rating: 5, text: "Easy parking, friendly staff, beautiful setting. Highly recommend.", source: "TripAdvisor", timestamp: "2026-02-02T10:00:00Z" },
];

function galleryFor(place: Location) {
  const seed = encodeURIComponent(place.name);
  return Array.from({ length: 6 }).map((_, i) => ({
    src: `https://picsum.photos/seed/${seed}-${i}/600/400`,
    by: i % 2 === 0 ? "Google Users" : "Unsplash",
    source: "Imported" as "Imported" | "App user"
  }));
}

type SortKey = "recent" | "rating-high" | "rating-low";
type SourceFilter = "all" | "app" | "google";
export const placeDetailsCache: Record<string, Location> = {};

export function PlaceDetailsSheet({ place, open, onOpenChange, showDirections = false, onNavigate }: Props) {
  const [sort, setSort] = useState<SortKey>("recent");
  const [source, setSource] = useState<SourceFilter>("all");
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [showSideTripConfirm, setShowSideTripConfirm] = useState(false);
  const { fix } = useGeolocation();

  const [detailedPlace, setDetailedPlace] = useState<Location | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Responsive sidebar vs bottom sheet
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!open || !place) {
      setDetailedPlace(null);
      return;
    }

    const isFullDetails = place.rating !== undefined && place.rating !== null && 
                          ((place.photo_references && place.photo_references.length > 0) || place.description);

    if (isFullDetails) {
      setDetailedPlace(place);
      return;
    }

    const cacheKey = place.id || `${place.name}_${place.lat}_${place.lng}`;
    if (placeDetailsCache[cacheKey]) {
      setDetailedPlace(placeDetailsCache[cacheKey]);
      return;
    }

    let mounted = true;
    async function fetchDetails() {
      setLoadingDetails(true);
      try {
        const response = await placesApi.search({
          lat: place!.lat,
          lng: place!.lng,
          query: place!.name,
          _t: Date.now()
        } as any);
        
        const results = response.data as Location[];
        const match = results.find(r => r.name.toLowerCase().includes(place!.name.toLowerCase())) || results[0];
        
        if (match && mounted) {
          const merged = { ...place, ...match, id: place!.id };
          placeDetailsCache[cacheKey] = merged;
          setDetailedPlace(merged);
        } else if (mounted) {
          setDetailedPlace(place);
        }
      } catch (err) {
        console.error("Failed to fetch place details:", err);
        if (mounted) setDetailedPlace(place);
      } finally {
        if (mounted) setLoadingDetails(false);
      }
    }

    fetchDetails();
    return () => { mounted = false; };
  }, [place, open]);

  const currentPlace = detailedPlace || place;
  const { reviews: fetchedReviews } = useReviews();

  const userReviews = useMemo(
    () => currentPlace ? fetchedReviews.filter((r: any) => r.locationId === currentPlace.id || r.place_name === currentPlace.name) : [],
    [currentPlace, fetchedReviews],
  );

  const allReviews = useMemo(() => {
    if (!currentPlace) return [];
    const app = userReviews.map((r: any) => ({
      kind: "app" as const, id: r.id, author: r.user?.username || r.userName || "App User", avatar: r.user?.profile_pic || r.userAvatar || `https://ui-avatars.com/api/?name=${r.user?.username || "A"}`,
      rating: r.rating, text: r.review_text || r.comment, source: "App" as const, timestamp: r.created_at || r.timestamp,
    }));
    const extReviews = currentPlace.reviews_data || [];
    const ext = extReviews.map((r, i) => ({
      kind: "ext" as const, id: `g-${i}`, author: r.author, avatar: r.avatar || `https://ui-avatars.com/api/?name=${r.author}`,
      rating: r.rating, text: r.text, source: r.source, timestamp: r.timestamp,
    }));
    let merged = [...app, ...ext];
    if (source === "app") merged = merged.filter(r => r.kind === "app");
    if (source === "google") merged = merged.filter(r => r.kind === "ext");
    if (nearbyOnly && fix && currentPlace) {
      merged = merged.filter(r => r.kind === "ext" || distanceMeters({ lat: fix.lat, lng: fix.lng }, { lat: currentPlace.lat, lng: currentPlace.lng }) < 75000);
    }
    if (sort === "recent") merged.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
    else if (sort === "rating-high") merged.sort((a, b) => b.rating - a.rating);
    else merged.sort((a, b) => a.rating - b.rating);
    return merged;
  }, [currentPlace, userReviews, sort, source, nearbyOnly, fix?.lat, fix?.lng]);

  const gallery = useMemo(() => {
    if (!currentPlace) return [];
    if (currentPlace.photo_references && currentPlace.photo_references.length > 0) {
      return currentPlace.photo_references.map(ref => ({
        src: placesApi.getPhoto(ref),
        by: "Google",
        source: "Imported" as "Imported" | "App user",
      }));
    }
    return galleryFor(currentPlace);
  }, [currentPlace]);

  if (!place) return null;
  const history = (currentPlace as any)?.editorial_summary || 
                  (currentPlace as any)?.editorialSummary?.text || 
                  HISTORY[currentPlace?.type || "poi"] || 
                  "No historical details available for this place yet.";

  const handleShare = () => {
    if (!currentPlace) return;
    navigator.clipboard.writeText(`Check out ${currentPlace.name} on Intellitravel!`);
    toast({ title: "🔗 Link Copied", description: currentPlace.name });
  };

  const handleConfirmSideTrip = () => {
    setShowSideTripConfirm(false);
    if (onNavigate && currentPlace) {
      onNavigate(currentPlace as Location, "add-side-trip");
      onOpenChange(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent 
          side={isMobile ? "bottom" : "left"} 
          className={`p-0 overflow-hidden flex flex-col ${isMobile ? 'h-[90vh] w-full max-w-[100vw] rounded-t-3xl' : 'w-[400px] sm:max-w-md border-r'}`}
        >
          <ScrollArea className="flex-1 w-full relative">
            {/* Hero Image Header */}
            <div className="relative h-64 bg-zinc-900 group">
              {gallery.length > 0 ? (
                <img src={gallery[0].src} alt={currentPlace?.name || place.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/80 to-accent" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-5">
                <Badge className="w-fit text-[10px] h-[20px] bg-white/20 backdrop-blur-md border-0 capitalize mb-2 text-white">
                  {((currentPlace?.type || place.type || "Place")).replace("-", " ")}
                </Badge>
                <h2 className="font-display font-bold text-2xl md:text-3xl text-white leading-tight drop-shadow-lg">
                  {currentPlace?.name || place.name}
                </h2>
              </div>
              
              <div className="absolute top-4 right-4 flex gap-2">
                <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full bg-black/40 backdrop-blur text-white hover:bg-black/60 border-0" onClick={handleShare}>
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="px-5 py-4 bg-background">
              <SheetHeader className="mb-4 text-left">
                <SheetTitle className="sr-only">{currentPlace?.name || place.name}</SheetTitle>
                <div className="flex items-start justify-between gap-4">
                  <SheetDescription className="text-sm text-foreground/80 flex items-start gap-2 flex-1">
                    <MapPin className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                    {currentPlace?.address || currentPlace?.description || place.address || place.description || "Address not available"}
                  </SheetDescription>
                </div>

                <div className="flex items-center gap-2 mt-3 text-sm">
                  <span className="font-bold text-foreground text-base">{currentPlace?.rating?.toFixed(1) ?? "—"}</span>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${i < Math.round(currentPlace?.rating ?? 0) ? "text-accent fill-accent" : "text-muted"}`} />
                    ))}
                  </div>
                  <span className="text-muted-foreground ml-1">({allReviews.length})</span>
                </div>
              </SheetHeader>

              {showDirections && onNavigate && (
                <div className="flex gap-2 mb-6">
                  <Button className="flex-1 rounded-xl h-12 shadow-md gap-1.5 px-2 text-xs sm:text-sm" onClick={() => { onNavigate(currentPlace as Location, "replace"); onOpenChange(false); }}>
                    <Navigation className="w-4 h-4 shrink-0" /> <span className="truncate">Get Directions</span>
                  </Button>
                  <Button className="flex-1 rounded-xl h-12 shadow-md gap-1.5 px-2 text-xs sm:text-sm bg-indigo-500 hover:bg-indigo-600 text-white" onClick={() => setShowSideTripConfirm(true)}>
                    <Map className="w-4 h-4 shrink-0" /> <span className="truncate">Add Side Trip</span>
                  </Button>
                </div>
              )}

              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
                  <span className="text-sm text-muted-foreground font-medium">Loading places details...</span>
                </div>
              ) : (
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="w-full h-auto min-h-[44px] p-1 rounded-xl bg-muted/60 flex flex-wrap sm:grid sm:grid-cols-3 mb-6">
                    <TabsTrigger value="overview" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><BookOpen className="w-3.5 h-3.5" /> Overview</TabsTrigger>
                    <TabsTrigger value="photos" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><Images className="w-3.5 h-3.5" /> Photos</TabsTrigger>
                    <TabsTrigger value="reviews" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><MessageSquare className="w-3.5 h-3.5" /> Reviews</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="mt-0 space-y-4">
                    <div className="prose prose-sm dark:prose-invert">
                      <p className="leading-relaxed">{history}</p>
                    </div>
                    {gallery.length > 1 && (
                      <div className="mt-6">
                        <h4 className="font-semibold mb-3 text-sm flex items-center gap-2"><Images className="w-4 h-4 text-primary" /> Popular Photos</h4>
                        <div className={`gap-3 pb-4 ${gallery.length >= 4 ? 'grid grid-cols-2' : 'flex overflow-x-auto snap-x pr-4'}`}>
                          {gallery.slice(1, 4).map((g, i) => (
                            <div 
                              key={i} 
                              className={`relative rounded-xl overflow-hidden bg-muted cursor-pointer hover:opacity-90 transition-opacity ${gallery.length >= 4 ? 'aspect-square' : 'w-40 h-28 shrink-0 snap-start'}`}
                              onClick={() => setSelectedPhotoIndex(i + 1)}
                            >
                              <img src={g.src} alt={`Popular ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="photos" className="mt-0">
                    <div className="grid grid-cols-2 gap-3 pb-8">
                      {gallery.map((g, i) => (
                        <div 
                          key={i} 
                          className="relative rounded-xl overflow-hidden bg-muted aspect-square cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => setSelectedPhotoIndex(i)}
                        >
                          <img src={g.src} alt={`Photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="reviews" className="mt-0 space-y-4 pb-8">
                    {allReviews.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground text-sm">No reviews found for this place.</div>
                    ) : (
                      allReviews.map(r => (
                        <div key={r.id} className="p-4 rounded-2xl bg-muted/30 border border-border/50 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <img src={r.avatar} alt={r.author} className="w-10 h-10 rounded-full object-cover bg-muted" />
                              <div>
                                <p className="font-semibold text-sm leading-none">{r.author}</p>
                                <div className="flex items-center gap-1 mt-1.5">
                                  {Array.from({ length: 5 }).map((_, i) => (
                                    <Star key={i} className={`w-3 h-3 ${i < r.rating ? "text-accent fill-accent" : "text-muted"}`} />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap bg-background px-2 py-1 rounded-md shadow-sm border">{r.source}</span>
                          </div>
                          <p className="text-sm text-foreground/90 leading-relaxed">{r.text}</p>
                          <p className="text-[10px] text-muted-foreground font-medium">{new Date(r.timestamp).toLocaleDateString()}</p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Full screen photo viewer */}
      <Dialog open={selectedPhotoIndex !== null} onOpenChange={(open) => !open && setSelectedPhotoIndex(null)}>
        <DialogContent className="max-w-[95vw] w-full p-0 bg-transparent border-0 shadow-none flex items-center justify-center h-screen max-h-screen [&>button]:hidden">
          <DialogTitle className="sr-only">Photo view</DialogTitle>
          {selectedPhotoIndex !== null && gallery[selectedPhotoIndex] && (
            <div className="relative w-full h-full flex flex-col items-center justify-center">
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 z-10 text-white bg-black/40 hover:bg-black/60 rounded-full" 
                onClick={() => setSelectedPhotoIndex(null)}
              >
                <X className="w-5 h-5" />
              </Button>
              <img src={gallery[selectedPhotoIndex].src} className="max-w-full max-h-[90dvh] object-contain rounded-xl" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Side Trip Confirmation Dialog */}
      <AlertDialog open={showSideTripConfirm} onOpenChange={setShowSideTripConfirm}>
        <AlertDialogContent className="w-[90vw] max-w-sm rounded-3xl p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Add Side Trip?</AlertDialogTitle>
            <AlertDialogDescription>
              This will route you to <strong>{currentPlace?.name}</strong> first. After your visit, navigation will continue to your final destination.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2 flex-col sm:flex-row sm:space-x-0">
            <AlertDialogCancel className="rounded-xl h-12 flex-1 mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction className="rounded-xl h-12 flex-1 glow-primary" onClick={handleConfirmSideTrip}>Add Side Trip</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
