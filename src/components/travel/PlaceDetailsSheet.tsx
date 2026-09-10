// Shared place-details modal: photo gallery, historical info, app user reviews
// (filterable by rating/recency/source/nearby), simulated Google reviews,
// and an optional Get Directions / Add Side Trip button.
import { useMemo, useState, useEffect } from "react";
import { Star, Navigation, Share2, MapPin, BookOpen, MessageSquare, Globe, Images, Camera, Loader2, X, Map, Upload, Plus } from "lucide-react";
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

export const placeDetailsCache: Record<string, Location> = {};

const HISTORY: Record<string, string> = {
  city: "A vibrant urban destination featuring a rich history, local markets, architectural landmarks, and diverse cultural experiences.",
  poi: "A popular point of interest cherished by locals and visitors alike for its unique character and heritage.",
  landmark: "An iconic landmark that has served as a cultural anchor and meeting point for generations.",
  hotel: "A welcoming accommodation hub offering rest, local hospitality, and convenient access to nearby attractions.",
  restaurant: "A beloved dining spot celebrated for local flavors, signature dishes, and authentic culinary traditions.",
  "gas-station": "An essential transit stop providing fuel, conveniences, and refresh amenities along main highways.",
  viewpoint: "Formed by scenic terrain uplift, this vantage point offers panoramic views of the surrounding countryside and landscapes.",
  shopping: "A bustling commercial center offering retail stores, local delicacies, dining, and family entertainment.",
  mall: "A popular shopping and leisure hub featuring top retail brands, restaurants, cinema, and air-conditioned comfort.",
  park: "A peaceful green sanctuary providing fresh air, walking trails, leisure spaces, and outdoor recreation.",
  museum: "A cultural treasure trove showcasing historical artifacts, art collections, and heritage exhibits.",
  beach: "A beautiful coastal destination known for tropical waters, sandy shores, and relaxing beachside activities.",
  transit: "A strategic transport node connecting travelers to key provincial destinations and city corridors.",
  custom: "A custom itinerary location curated for your travel route.",
};

const TYPE_IMAGES: Record<string, string[]> = {
  hotel: [
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80",
  ],
  restaurant: [
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=800&q=80",
  ],
  landmark: [
    "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&w=800&q=80",
  ],
  viewpoint: [
    "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80",
  ],
  shopping: [
    "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?auto=format&fit=crop&w=800&q=80",
  ],
  mall: [
    "https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?auto=format&fit=crop&w=800&q=80",
  ],
  park: [
    "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=800&q=80",
  ],
  default: [
    "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=800&q=80",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
  ]
};

function galleryFor(loc: Location | null): { src: string; by: string; source: "Imported" | "App user" }[] {
  if (!loc) return [];
  const directImg = loc.imageUrl || (loc as any).photoUrl;
  if (directImg && typeof directImg === "string" && directImg.trim()) {
    return [{ src: directImg, by: "Official", source: "Imported" }];
  }
  const type = (loc.type || "default").toLowerCase();
  const urls = TYPE_IMAGES[type] || TYPE_IMAGES.default;
  return urls.map((src, i) => ({
    src,
    by: i === 0 ? "Featured" : "Gallery",
    source: "Imported" as const,
  }));
}

export function PlaceDetailsSheet({ place, open, onOpenChange, showDirections, onNavigate }: Props) {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [sort, setSort] = useState<"recent" | "rating-high" | "rating-low">("recent");
  const [source, setSource] = useState<"all" | "app" | "google">("all");
  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [showSideTripConfirm, setShowSideTripConfirm] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailedPlace, setDetailedPlace] = useState<Location | null>(place);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoUrlInput, setPhotoUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);

  const { fix } = useGeolocation();

  useEffect(() => {
    if (!place || !open) {
      setDetailedPlace(place);
      return;
    }

    const cacheKey = place.id || `${place.name}_${place.lat}_${place.lng}`;
    const cached = placeDetailsCache[cacheKey];

    // Only return cached directly if it has been fully enriched
    if (cached && (cached as any)._enriched) {
      setDetailedPlace(cached);
      return;
    }

    if (cached) {
      setDetailedPlace(cached);
    } else {
      setDetailedPlace(place);
    }

    let mounted = true;
    async function fetchDetails() {
      // Clean up common itinerary stop prefixes so searching finds real place
      const cleanName = place!.name
        .replace(/^(walk|transfer|jeepney|bus|tricycle|drive)\s+to\s+/i, "")
        .replace(/^(entrance|drop-off|start|station|terminal)\s+of\s+/i, "")
        .replace(/\s*\([^)]*\)/g, "")
        .trim();

      setLoadingDetails(true);
      try {
        const response = await placesApi.search({
          lat: place!.lat,
          lng: place!.lng,
          query: cleanName || place!.name,
          _t: Date.now()
        } as any);

        const rawData = response.data;
        const results: Location[] = Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.data)
          ? rawData.data
          : Array.isArray(rawData?.places)
          ? rawData.places
          : [];

        const targetQuery = (cleanName || place!.name).toLowerCase();
        const match = results.find(r =>
          r.name.toLowerCase().includes(targetQuery) ||
          targetQuery.includes(r.name.toLowerCase())
        ) || results[0];

        if (match && mounted) {
          const merged = { ...place, ...match, id: place!.id, _enriched: true };
          placeDetailsCache[cacheKey] = merged;
          setDetailedPlace(merged);
        } else if (mounted) {
          const fallback = { ...place, _enriched: true };
          placeDetailsCache[cacheKey] = fallback;
          setDetailedPlace(fallback);
        }
      } catch (err) {
        console.error("Failed to fetch place details:", err);
        if (mounted) {
          const fallback = { ...place, _enriched: true };
          setDetailedPlace(fallback);
        }
      } finally {
        if (mounted) setLoadingDetails(false);
      }
    }

    fetchDetails();
    return () => { mounted = false; };
  }, [place, open]);

  const currentPlace = detailedPlace || place;

  const { reviews: fetchedReviews, createReview } = useReviews(
    currentPlace ? { placeName: currentPlace.name, placeId: currentPlace.id } : undefined
  );

  const userReviews = useMemo(
    () => currentPlace ? fetchedReviews.filter((r: any) =>
      (r.place_id && String(r.place_id) === String(currentPlace.id)) ||
      (r.place_name && r.place_name.toLowerCase().trim() === currentPlace.name.toLowerCase().trim()) ||
      (r.locationId && String(r.locationId) === String(currentPlace.id))
    ) : [],
    [currentPlace, fetchedReviews],
  );

  const userReviewPhotos = useMemo(() => {
    const photosList: { src: string; by: string; source: "App user" }[] = [];
    userReviews.forEach((r: any) => {
      const author = r.user?.name || r.user?.username || r.userName || "App User";
      if (Array.isArray(r.photos)) {
        r.photos.forEach((photoUrl: string) => {
          if (photoUrl) {
            photosList.push({ src: photoUrl, by: author, source: "App user" });
          }
        });
      }
    });
    return photosList;
  }, [userReviews]);

  const allReviews = useMemo(() => {
    if (!currentPlace) return [];
    const app = userReviews.map((r: any) => ({
      kind: "app" as const,
      id: r.id,
      author: r.user?.name || r.user?.username || r.userName || "Traveler",
      avatar: r.user?.profile_pic || r.userAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.user?.username || r.user?.name || "A")}`,
      rating: r.rating,
      text: r.review_text || r.comment,
      photos: r.photos || [],
      source: "App User" as const,
      timestamp: r.created_at || r.timestamp || new Date().toISOString(),
    }));
    const rawExt = currentPlace.reviews_data || (currentPlace as any).reviews;
    const extReviews = Array.isArray(rawExt) ? rawExt : [];
    const ext = extReviews.map((r: any, i: number) => ({
      kind: "ext" as const,
      id: `g-${i}`,
      author: r.author,
      avatar: r.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(r.author || "G")}`,
      rating: r.rating,
      text: r.text,
      photos: [],
      source: r.source || "Google",
      timestamp: r.timestamp || new Date().toISOString(),
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
    let importedPhotos: { src: string; by: string; source: "Imported" | "App user" }[] = [];
    if (currentPlace.photo_references && currentPlace.photo_references.length > 0) {
      importedPhotos = currentPlace.photo_references.map(ref => ({
        src: typeof ref === "string" ? placesApi.getPhoto(ref) : (ref as any).src || placesApi.getPhoto((ref as any).name || (ref as any).photo_reference),
        by: "Google",
        source: "Imported" as const,
      }));
    } else if ((currentPlace as any).photo_reference) {
      importedPhotos = [{
        src: placesApi.getPhoto((currentPlace as any).photo_reference),
        by: "Google",
        source: "Imported" as const,
      }];
    } else {
      importedPhotos = galleryFor(currentPlace);
    }

    if (importedPhotos.length === 0) {
      importedPhotos = galleryFor(currentPlace);
    }

    return [...userReviewPhotos, ...importedPhotos];
  }, [currentPlace, userReviewPhotos]);

  if (!place) return null;

  const history = (currentPlace as any)?.editorial_summary ||
                  (currentPlace as any)?.editorialSummary?.text ||
                  (currentPlace as any)?.editorialSummary ||
                  (currentPlace as any)?.description ||
                  HISTORY[currentPlace?.type || ""] ||
                  HISTORY[(currentPlace as any)?.category || ""] ||
                  `Explore ${currentPlace?.name || 'this destination'}, a cherished stop featuring local attractions, vibrant surroundings, and authentic experiences for travelers.`;

  const handleShare = () => {
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPhotos(prev => [...prev, event.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddPhotoUrl = () => {
    if (!photoUrlInput.trim()) return;
    setPhotos(prev => [...prev, photoUrlInput.trim()]);
    setPhotoUrlInput("");
    setShowUrlInput(false);
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReview = async () => {
    if (!currentPlace) return;
    if (!reviewText.trim() && photos.length === 0) {
      toast({ title: "Write a review", description: "Please enter a comment or upload a photo.", variant: "destructive" });
      return;
    }
    try {
      await createReview.mutateAsync({
        place_id: currentPlace.id,
        place_name: currentPlace.name,
        rating,
        review_text: reviewText.trim(),
        photos,
      });
      toast({ title: "🌟 Review Published!", description: `Thank you for reviewing ${currentPlace.name}.` });
      setReviewText("");
      setPhotos([]);
      setRating(5);
      setShowReviewForm(false);
    } catch (err: any) {
      toast({ title: "Failed to publish review", description: err?.message || "Something went wrong.", variant: "destructive" });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[85vh] max-h-[85vh] rounded-t-3xl p-0 overflow-hidden border-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{currentPlace.name}</SheetTitle>
            <SheetDescription>Details, photos, history, and community reviews for {currentPlace.name}</SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-full">
            <div className="relative h-48 sm:h-60 w-full bg-muted overflow-hidden">
              <img
                src={gallery[0]?.src || "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80"}
                alt={currentPlace.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
              
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <Button variant="secondary" size="icon" className="w-9 h-9 rounded-full bg-background/80 backdrop-blur-md" onClick={handleShare}>
                  <Share2 className="w-4 h-4" />
                </Button>
                <Button variant="secondary" size="icon" className="w-9 h-9 rounded-full bg-background/80 backdrop-blur-md" onClick={() => onOpenChange(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="absolute bottom-4 left-4 right-4 flex flex-col justify-end">
                <Badge variant="outline" className="w-max mb-1.5 capitalize text-[10px] bg-background/80 backdrop-blur-md border-primary/20 text-primary">
                  {currentPlace.type?.replace("-", " ") || "POI"}
                </Badge>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">{currentPlace.name}</h2>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0 text-primary" />
                  <span className="truncate">
                    {currentPlace.address ||
                      ((currentPlace as any).city ? `${(currentPlace as any).city}, Philippines` : "") ||
                      (currentPlace.lat && currentPlace.lng ? `${currentPlace.lat.toFixed(4)}, ${currentPlace.lng.toFixed(4)}` : "Philippines")}
                  </span>
                </p>
              </div>
            </div>

            <div className="p-4 space-y-5">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-muted/40 border border-border/50">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-accent font-bold text-sm">
                    <Star className="w-4 h-4 fill-accent" />
                    <span>{currentPlace.rating ? Number(currentPlace.rating).toFixed(1) : "4.5"}</span>
                  </div>
                  <span className="text-muted-foreground text-xs">({allReviews.length} reviews)</span>
                </div>
                {fix && currentPlace.lat && currentPlace.lng && (
                  <span className="text-xs text-muted-foreground font-medium">
                    {(distanceMeters({ lat: fix.lat, lng: fix.lng }, { lat: currentPlace.lat, lng: currentPlace.lng }) / 1000).toFixed(1)} km away
                  </span>
                )}
              </div>

              {showDirections && onNavigate && (
                <div className="grid grid-cols-2 gap-2">
                  <Button className="rounded-xl h-11 glow-primary gap-2 text-xs font-semibold" onClick={() => onNavigate(currentPlace as Location, "replace")}>
                    <Navigation className="w-4 h-4" /> Get Directions
                  </Button>
                  <Button variant="outline" className="rounded-xl h-11 gap-2 text-xs font-semibold" onClick={() => setShowSideTripConfirm(true)}>
                    <Map className="w-4 h-4 text-primary" /> Add Side Trip
                  </Button>
                </div>
              )}

              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-xs">Fetching place information...</span>
                </div>
              ) : (
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="w-full h-11 bg-muted/50 p-1 rounded-xl mb-4">
                    <TabsTrigger value="overview" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><BookOpen className="w-3.5 h-3.5" /> Overview</TabsTrigger>
                    <TabsTrigger value="photos" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><Images className="w-3.5 h-3.5" /> Photos ({gallery.length})</TabsTrigger>
                    <TabsTrigger value="reviews" className="flex-1 rounded-lg text-xs font-semibold gap-1.5 py-2"><MessageSquare className="w-3.5 h-3.5" /> Reviews ({allReviews.length})</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-4 mt-0">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-primary" /> History & Context
                      </h4>
                      <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed bg-muted/20 p-3 rounded-2xl border border-border/40">
                        {history}
                      </p>
                    </div>

                    {currentPlace.description && (
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">About</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">{currentPlace.description}</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="photos" className="mt-0">
                    <div className="grid grid-cols-2 gap-3 pb-8">
                      {gallery.map((g, i) => (
                        <div 
                          key={i} 
                          className="relative rounded-xl overflow-hidden bg-muted aspect-square cursor-pointer hover:opacity-90 transition-opacity border"
                          onClick={() => setSelectedPhotoIndex(i)}
                        >
                          <img src={g.src} alt={`Photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 left-1 text-[8px] bg-black/60 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
                            {g.by}
                          </span>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="reviews" className="mt-0 space-y-4 pb-8">
                    {!showReviewForm ? (
                      <Button
                        onClick={() => setShowReviewForm(true)}
                        className="w-full rounded-2xl h-11 glow-primary gap-2 text-xs font-semibold"
                      >
                        <Plus className="w-4 h-4" /> Write a Review & Add Photos
                      </Button>
                    ) : (
                      <div className="space-y-3 p-4 rounded-2xl bg-primary/5 border border-primary/20">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                            <Star className="w-4 h-4 text-accent fill-accent" /> Rate & Review {currentPlace.name}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => setShowReviewForm(false)} className="h-7 w-7 p-0 rounded-full">
                            <X className="w-4 h-4" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRating(star)}
                              onMouseEnter={() => setHoverRating(star)}
                              onMouseLeave={() => setHoverRating(0)}
                              className="p-1 hover:scale-110 transition-transform"
                            >
                              <Star
                                className={`w-6 h-6 ${
                                  (hoverRating || rating) >= star
                                    ? "text-accent fill-accent"
                                    : "text-muted-foreground/30"
                                }`}
                              />
                            </button>
                          ))}
                          <span className="text-xs font-semibold ml-2 text-muted-foreground">
                            {rating === 5 ? "Excellent" : rating === 4 ? "Very Good" : rating === 3 ? "Average" : rating === 2 ? "Poor" : "Terrible"}
                          </span>
                        </div>

                        <textarea
                          value={reviewText}
                          onChange={(e) => setReviewText(e.target.value)}
                          placeholder="Share your experience, tips, or highlights of this place..."
                          className="w-full text-xs p-3 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none min-h-[75px]"
                        />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                              <Camera className="w-3.5 h-3.5" /> Attach Photos ({photos.length})
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="cursor-pointer text-[10px] font-semibold text-primary hover:underline flex items-center gap-1 bg-background px-2.5 py-1 rounded-md border border-primary/20 shadow-sm">
                                <Upload className="w-3 h-3" /> Upload Photo
                                <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
                              </label>
                              <button
                                type="button"
                                onClick={() => setShowUrlInput(!showUrlInput)}
                                className="text-[10px] font-semibold text-muted-foreground hover:underline bg-background px-2.5 py-1 rounded-md border shadow-sm"
                              >
                                + URL
                              </button>
                            </div>
                          </div>

                          {showUrlInput && (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={photoUrlInput}
                                onChange={(e) => setPhotoUrlInput(e.target.value)}
                                placeholder="Paste image URL (https://...)"
                                className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border bg-background"
                              />
                              <Button size="sm" onClick={handleAddPhotoUrl} className="text-xs h-8">Add</Button>
                            </div>
                          )}

                          {photos.length > 0 && (
                            <div className="flex items-center gap-2 overflow-x-auto py-1">
                              {photos.map((p, i) => (
                                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0 border">
                                  <img src={p} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePhoto(i)}
                                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowReviewForm(false)}
                            className="rounded-xl text-xs"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSubmitReview}
                            disabled={createReview.isPending}
                            className="rounded-xl text-xs glow-primary gap-1.5"
                          >
                            {createReview.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Post Review"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {allReviews.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground text-sm">No reviews found for this place yet. Be the first to add a review!</div>
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
                          
                          {r.text && <p className="text-sm text-foreground/90 leading-relaxed">{r.text}</p>}
                          
                          {r.photos && r.photos.length > 0 && (
                            <div className="flex items-center gap-2 overflow-x-auto pt-1">
                              {r.photos.map((photoUrl: string, idx: number) => (
                                <img
                                  key={idx}
                                  src={photoUrl}
                                  alt={`Review photo ${idx + 1}`}
                                  className="w-20 h-20 rounded-xl object-cover border cursor-pointer hover:opacity-90 transition-opacity flex-shrink-0"
                                  onClick={() => {
                                    const galleryIdx = gallery.findIndex(g => g.src === photoUrl);
                                    if (galleryIdx >= 0) setSelectedPhotoIndex(galleryIdx);
                                  }}
                                />
                              ))}
                            </div>
                          )}

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
