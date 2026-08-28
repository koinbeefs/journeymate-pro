import { useState, useRef, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Send, MapPin, Image, Users, Phone, Video,
  Circle, CheckCheck, Navigation, Share2,
  UserPlus, Crown, Eye, Radio, ChevronDown, ChevronUp,
  Loader2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { mockMessages, collaborators } from "@/data/mockData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ChatMessage, TravelUser } from "@/types/travel";
import { VideoCallOverlay, VoiceCallOverlay, AnimatePresence } from "@/components/travel/CallOverlay";
import { useTrip } from "@/hooks/useTrip";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/auth/AuthProvider";
import { useVideoCall } from "@/hooks/useVideoCall";
import { tripsApi, userSearchApi } from "@/lib/api";
import { useTracking } from "@/hooks/useTracking";

const createUserIcon = (name: string, online: boolean) => L.divIcon({
  className: "",
  html: `<div style="width:32px;height:32px;background:${online ? 'hsl(162,72%,40%)' : '#94a3b8'};border-radius:10px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:11px;font-family:Inter">${name.split(" ").map(n => n[0]).join("")}</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function TrackingMap({ centerLat, centerLng, members, showHeatmap, trackingTrails, heatmapData }: {
  centerLat?: number,
  centerLng?: number,
  members: TravelUser[],
  showHeatmap: boolean,
  trackingTrails: Record<string, [number, number][]>,
  heatmapData: [number, number, number][] // [lat, lng, intensity]
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const trailsRef = useRef<Record<string, L.Polyline>>({});
  const positionsRef = useRef<Record<string, [number, number][]>>({});
  const heatLayersRef = useRef<L.Circle[]>([]);
  const allUsers = members.filter(u => u.lastLocation);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const points = allUsers
      .filter(u => u.lastLocation)
      .map(u => [u.lastLocation!.lat, u.lastLocation!.lng] as [number, number]);

    const defaultCenter: [number, number] = [centerLat ?? 16.4023, centerLng ?? 120.5960]; // default to Baguio if null

    const map = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "",
      maxZoom: 19,
    }).addTo(map);

    // Add trip destination marker
    if (centerLat && centerLng) {
      const destIcon = L.divIcon({
        className: "",
        html: `<div style="width:36px;height:36px;background:hsl(142,76%,36%);border-radius:50%;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:white;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker([centerLat, centerLng], { icon: destIcon })
        .bindPopup("<strong>Trip Destination</strong>")
        .addTo(map);
    }

    allUsers.forEach(u => {
      if (!u.lastLocation) return;
      const start: [number, number] = [u.lastLocation.lat, u.lastLocation.lng];
      positionsRef.current[u.id] = [start];
      const marker = L.marker(start, { icon: createUserIcon(u.name, u.isOnline) })
        .bindPopup(`<strong>${u.name}</strong><br/><span style="color:${u.isOnline ? '#22c55e' : '#94a3b8'}">${u.isOnline ? "Online" : "Offline"}</span><br/><small>${u.role}</small>`)
        .addTo(map);
      markersRef.current[u.id] = marker;

      if (u.isOnline) {
        const trail = L.polyline([start], {
          color: "hsl(162,72%,40%)", weight: 3, opacity: 0.5, dashArray: "4 4",
        }).addTo(map);
        trailsRef.current[u.id] = trail;
      }
    });

    const boundsPoints = [...points];
    if (centerLat && centerLng) {
      boundsPoints.push([centerLat, centerLng]);
    }

    if (boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [60, 60] });
    } else if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], 12);
    }

    mapInstance.current = map;

    const invalidate = () => map.invalidateSize();
    const t1 = setTimeout(invalidate, 50);
    const t2 = setTimeout(invalidate, 250);
    const t3 = setTimeout(invalidate, 600);
    window.addEventListener("resize", invalidate);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && mapRef.current) {
      ro = new ResizeObserver(invalidate);
      ro.observe(mapRef.current);
    }

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      window.removeEventListener("resize", invalidate);
      ro?.disconnect();
      map.remove();
      mapInstance.current = null;
      markersRef.current = {};
      trailsRef.current = {};
      positionsRef.current = {};
    };
  }, []);

  // Update marker positions dynamically when members change
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const currentIds = new Set(allUsers.map(u => String(u.id)));

    // Remove markers for users not present anymore
    Object.keys(markersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        markersRef.current[id]?.remove();
        trailsRef.current[id]?.remove();
        delete markersRef.current[id];
        delete trailsRef.current[id];
        delete positionsRef.current[id];
      }
    });

    // Add or update markers for current users
    allUsers.forEach(u => {
      if (!u.lastLocation) return;
      const pos: [number, number] = [u.lastLocation.lat, u.lastLocation.lng];
      const existingMarker = markersRef.current[u.id];

      if (existingMarker) {
        existingMarker.setLatLng(pos);
        existingMarker.setIcon(createUserIcon(u.name, u.isOnline));
        existingMarker.setPopupContent(`<strong>${u.name}</strong><br/><span style="color:${u.isOnline ? '#22c55e' : '#94a3b8'}">${u.isOnline ? "Online" : "Offline"}</span><br/><small>${u.role}</small>`);

        // Update trail
        const trail = trailsRef.current[u.id];
        if (trail) {
          const pts = positionsRef.current[u.id] || [];
          const lastPt = pts[pts.length - 1];
          if (!lastPt || lastPt[0] !== pos[0] || lastPt[1] !== pos[1]) {
            pts.push(pos);
            if (pts.length > 30) pts.shift();
            positionsRef.current[u.id] = pts;
            trail.setLatLngs(pts);
          }
        }
      } else {
        const marker = L.marker(pos, { icon: createUserIcon(u.name, u.isOnline) })
          .bindPopup(`<strong>${u.name}</strong><br/><span style="color:${u.isOnline ? '#22c55e' : '#94a3b8'}">${u.isOnline ? "Online" : "Offline"}</span><br/><small>${u.role}</small>`)
          .addTo(map);
        markersRef.current[u.id] = marker;
        positionsRef.current[u.id] = [pos];

        if (u.isOnline) {
          const trail = L.polyline([pos], {
            color: "hsl(162,72%,40%)", weight: 3, opacity: 0.5, dashArray: "4 4",
          }).addTo(map);
          trailsRef.current[u.id] = trail;
        }
      }
    });
  }, [members]);

  // Heatmap overlay (circle-based, no extra dep)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    heatLayersRef.current.forEach(c => c.remove());
    heatLayersRef.current = [];
    heatmapData.forEach(p => {
      const c = L.circle([p[0], p[1]], {
        radius: 3000 + p[2] * 6000,
        color: "transparent",
        fillColor: `hsl(${(1 - p[2]) * 220}, 90%, 50%)`,
        fillOpacity: 0.25 + p[2] * 0.3,
      }).addTo(map);
      heatLayersRef.current.push(c);
    });
  }, [showHeatmap, heatmapData]);

  return <div ref={mapRef} className="absolute inset-0 bg-muted" />;
}

export default function SocialPage() {
  const { trips, active: activeTrip, setActiveId } = useTrip();
  const { user } = useAuth();

  const conversationId = activeTrip ? `trip-${activeTrip.id}` : "";
  const call = useVideoCall(conversationId, user?.id?.toString() ?? "", "video");

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [activeCall, setActiveCall] = useState<null | "audio" | "video">(null);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shareLocation, setShareLocation] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteSuggestions, setInviteSuggestions] = useState<any[]>([]);
  const [inviteSearchLoading, setInviteSearchLoading] = useState(false);
  const [selectedInviteUser, setSelectedInviteUser] = useState<any>(null);
  const inviteSearchRef = useRef<HTMLDivElement>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [trackOverlayOpen, setTrackOverlayOpen] = useState(true);
  const [inviting, setInviting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [trackingByTrip, setTrackingByTrip] = useState<Record<string, string[]>>(() => {
    const seed: Record<string, string[]> = {};
    trips.forEach(t => {
      seed[t.id] = (t.collaborators ?? [])
        .filter(c => c.isOnline && c.lastLocation)
        .map(c => c.id.toString());
    });
    return seed;
  });

  const { heatmapData } = useTracking();
  const { messages: apiMessages, sendMessage: sendApiMessage, isLoading } = useChat(activeTrip?.id?.toString() ?? "");

  // Watch for incoming call signaling
  useEffect(() => {
    if (call.callStatus === "ringing" && call.incomingCall) {
      setActiveCall(call.incomingCall.mode);
    } else if (call.callStatus === "active" && !activeCall) {
      setActiveCall(call.incomingCall?.mode || "video");
    } else if (call.callStatus === "ended") {
      setActiveCall(null);
    }
  }, [call.callStatus, call.incomingCall, activeCall]);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setMyLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.error("Geolocation error:", error);
      },
      { enableHighAccuracy: false, maximumAge: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const tripMembers: TravelUser[] = useMemo(() => {
    if (!activeTrip || !user) return [];
    const list: TravelUser[] = [];

    // Add owner if defined
    if (activeTrip.owner) {
      const owner = { ...activeTrip.owner };
      // If the owner is the current logged-in user, use our high-accuracy local myLocation state
      if (String(owner.id) === String(user.id) && myLocation) {
        owner.lastLocation = myLocation;
      }
      list.push(owner);
    }

    // Add collaborators
    (activeTrip.collaborators || []).forEach((m: any) => {
      const col = { ...m };
      // If this collaborator is the current logged-in user, use our high-accuracy local myLocation state
      if (String(col.id) === String(user.id) && myLocation) {
        col.lastLocation = myLocation;
      }
      list.push(col);
    });

    // Fallback: If logged-in user is somehow not in the list, add them as owner or collaborator based on activeTrip creator ID comparison.
    if (!list.some(m => String(m.id) === String(user.id))) {
      const isOwner = String(activeTrip.owner?.id) === String(user.id) || !activeTrip.owner;
      list.push({
        id: user.id.toString(),
        name: user.name || user.email || 'You',
        avatar: "https://i.pravatar.cc/150?u=" + user.id,
        role: isOwner ? "owner" : "editor",
        isOnline: true,
        lastLocation: myLocation || undefined
      });
    }

    return list;
  }, [activeTrip, user, myLocation]);

  const messages: ChatMessage[] = useMemo(() => {
    if (apiMessages && apiMessages.length > 0) {
      return apiMessages.map((m: any) => ({
        id: String(m.id ?? ''),
        userId: String(m.user_id ?? ''),
        userName: m.user?.username || m.user?.name || "User",
        userAvatar: m.user?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.user_id}`,
        message: m.content || "",
        timestamp: m.created_at || new Date().toISOString(),
        type: m.type || "text",
      }));
    }
    return [];
  }, [apiMessages]);

  // User search for invite
  useEffect(() => {
    if (!inviteName || inviteName.length < 2 || selectedInviteUser) {
      setInviteSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setInviteSearchLoading(true);
      try {
        const response = await userSearchApi.search(inviteName);
        setInviteSuggestions(response.data || []);
      } catch (error) {
        console.error("User search error:", error);
        setInviteSuggestions([]);
      } finally {
        setInviteSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inviteName, selectedInviteUser]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inviteSearchRef.current && !inviteSearchRef.current.contains(event.target as Node)) {
        setInviteSuggestions([]);
      }
    };
    if (inviteSuggestions.length > 0) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inviteSuggestions]);

  const trackingIds = activeTrip ? (trackingByTrip[activeTrip.id] ?? []) : [];
  // Reflect the local user's own toggle in the active trip's tracking set
  useEffect(() => {
    if (!user || !activeTrip) return;
    setTrackingByTrip(prev => {
      const set = new Set(prev[activeTrip.id] ?? []);
      if (shareLocation) set.add(user.id.toString()); else set.delete(user.id.toString());
      return { ...prev, [activeTrip.id]: Array.from(set) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareLocation, activeTrip?.id, user]);
  const isTracking = (id: string) => trackingIds.includes(id);

  // 1:1 call against the first online collaborator of the active trip.
  const callPeer = tripMembers.find(c => c.id !== user?.id.toString() && c.isOnline)
    ?? tripMembers.find(c => c.id !== user?.id.toString());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async () => {
    const text = message.trim();
    if (!text || !user) return;

    setMessage("");

    try {
      await sendApiMessage.mutateAsync({
        content: text,
        type: "text",
        user: {
          id: user.id.toString(),
          username: user.name || user.email || "You",
          profile_pic: `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.email || "You")}`
        }
      });
    } catch (error) {
      setMessage(text);
      toast({ title: "Error", description: "Failed to send message.", variant: "destructive" });
    }
  };

  const sendLocationMsg = async () => {
    if (!user) return;
    if (!navigator.geolocation) {
      toast({ title: "Error", description: "Geolocation is not supported by your browser.", variant: "destructive" });
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let locationLabel = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await response.json();
        locationLabel = data.display_name?.split(",").slice(0, 2).join(",") || locationLabel;
      } catch (err) {
        console.warn("Reverse geocoding failed, using coordinates", err);
      }

      try {
        await sendApiMessage.mutateAsync({
          content: `📍 Shared live location — ${locationLabel}`,
          type: "location"
        });
        toast({ title: "📍 Location Shared", description: "Your live location was sent to the group." });
      } catch (error) {
        toast({ title: "Error", description: "Failed to send location.", variant: "destructive" });
      }
    }, (err) => {
      toast({ title: "Error", description: "Unable to retrieve your location.", variant: "destructive" });
    });
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      const img = new window.Image();
      img.src = base64String;
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const maxW = 600;
        const scale = maxW / img.width;
        canvas.width = maxW;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);

        try {
          await sendApiMessage.mutateAsync({
            content: compressedBase64,
            type: "image"
          });
          toast({ title: "📸 Photo Shared", description: "Your image was sent to the group." });
        } catch (error) {
          toast({ title: "Error", description: "Failed to send image.", variant: "destructive" });
        }
      };
    };
    reader.readAsDataURL(file);
  };

  const sendImageMsg = () => {
    fileInputRef.current?.click();
  };

  const handleCall = (type: "audio" | "video") => {
    if (!callPeer) {
      toast({ title: "No one to call", description: "No members available right now.", variant: "destructive" });
      return;
    }
    setActiveCall(type);
    toast({
      title: type === "audio" ? "📞 Calling…" : "📹 Video Calling…",
      description: `Calling ${callPeer.name}…`,
    });
  };

  const handleInvite = async () => {
    if (!selectedInviteUser && !inviteName.trim()) return;
    if (!activeTrip) return;

    setInviting(true);
    try {
      const payload = selectedInviteUser 
        ? { username: selectedInviteUser.name }
        : { username: inviteName.trim() };
      
      await tripsApi.invite(activeTrip.id.toString(), payload);
      toast({ 
        title: "✅ Member Added!", 
        description: `${selectedInviteUser?.name || inviteName} has been added to the trip.` 
      });
      setInviteName("");
      setInviteSuggestions([]);
      setSelectedInviteUser(null);
      setInviteOpen(false);
    } catch (error: any) {
      toast({ 
        title: "Invite failed", 
        description: error.response?.data?.message || "Could not find user", 
        variant: "destructive" 
      });
    } finally {
      setInviting(false);
    }
  };

  const handleShareProfile = (name: string) => {
    navigator.clipboard.writeText(`Check out ${name}'s Intellitravel profile!`);
    toast({ title: "🔗 Profile Link Copied!", description: `${name}'s profile link copied to clipboard.` });
  };

  const roleIcons: Record<string, typeof Crown> = { owner: Crown, editor: Navigation, viewer: Eye };

  // Return early or empty state if no trip exists
  if (!activeTrip || !user) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground p-6 text-center">
        <Users className="w-12 h-12 mb-4 opacity-20" />
        <p className="font-semibold text-lg">No Active Trips</p>
        <p className="text-sm">Create or join a trip to access the Social features.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-5.8rem)]">
      {/* Trip switcher — keeps each group chat isolated so multiple trips don't collide */}
      <div className="px-4 pt-4 pb-2">
        <Select value={activeTrip.id.toString()} onValueChange={setActiveId}>
          <SelectTrigger className="h-10 rounded-xl bg-card border-border/50 text-xs font-semibold">
            <div className="flex items-center gap-2 min-w-0">
              <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            {trips.map(t => (
              <SelectItem key={t.id.toString()} value={t.id.toString()} className="text-xs">
                {t.title} · {((t.collaborators?.length ?? 0) + (t.owner ? 1 : 0))} members
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="chat" className="flex flex-col flex-1 min-h-0">
        <div className="px-4 pt-1">
          <TabsList className="w-full h-10 p-1 rounded-xl bg-muted">
            <TabsTrigger value="chat" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Chat</TabsTrigger>
            <TabsTrigger value="members" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Members</TabsTrigger>
            <TabsTrigger value="tracking" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm">Live Track</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="chat" className="flex-1 hidden data-[state=active]:flex flex-col min-h-0 m-0 overflow-hidden">
          {/* Chat header */}
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-border/30 flex-shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex -space-x-1.5">
                {tripMembers.filter(u => u.id !== user.id.toString()).slice(0, 3).map((u, i) => (
                  <img key={i} src={u.avatar} className="w-7 h-7 rounded-lg border-2 border-card" />
                ))}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{activeTrip.title}</p>
                <p className="text-[10px] text-muted-foreground">{tripMembers.filter(c => c.isOnline).length} online · {tripMembers.length} members</p>
              </div>
            </div>
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => handleCall("audio")} disabled={!callPeer}><Phone className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => handleCall("video")} disabled={!callPeer}><Video className="w-4 h-4" /></Button>
            </div>
          </div>

          {/* Messages — takes all remaining space */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
            {isLoading && messages.length === 0 ? (
              <div className="flex justify-center items-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.map(msg => {
              const isMe = msg.userId === user.id.toString();
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}
                >
                  {!isMe && <img src={msg.userAvatar} className="w-7 h-7 rounded-lg flex-shrink-0 mt-1" />}
                  <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"}`}>
                    {!isMe && <p className="text-[10px] text-muted-foreground mb-0.5 px-1 font-medium">{msg.userName}</p>}
                    <div className={`overflow-hidden ${msg.type === "image" ? "p-0.5 rounded-2xl" : "px-3.5 py-2.5 text-[13px] leading-relaxed"} ${isMe
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-md"
                      : msg.type === "location"
                        ? "bg-info/10 border border-info/15 rounded-2xl rounded-tl-md"
                        : msg.type === "itinerary-update"
                          ? "bg-accent/10 border border-accent/15 rounded-2xl rounded-tl-md"
                          : "bg-muted rounded-2xl rounded-tl-md"
                      }`}>
                      {msg.type === "location" && <MapPin className="w-3.5 h-3.5 text-info inline mr-1" />}
                      {msg.type === "itinerary-update" && <Navigation className="w-3.5 h-3.5 text-accent inline mr-1" />}
                      {msg.type === "image" ? (
                        <img src={msg.message} alt="Shared photo" className="max-w-full rounded-xl max-h-[220px] object-cover" />
                      ) : (
                        msg.message
                      )}
                    </div>
                    <div className={`flex items-center gap-1 mt-0.5 px-1 ${isMe ? "justify-end" : ""}`}>
                      <span className="text-[9px] text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isMe && <CheckCheck className="w-3 h-3 text-info" />}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Input bar — naturally positioned at bottom of flex container */}
          <div className="bg-card px-4 py-2.5 border-t border-border/30 flex-shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 rounded-xl" onClick={sendImageMsg} disabled={sendApiMessage.isPending}><Image className="w-4 h-4" /></Button>
              <Button
                variant="ghost" size="icon"
                className={`h-9 w-9 flex-shrink-0 rounded-xl ${shareLocation ? "text-primary bg-primary/8" : ""}`}
                onClick={sendLocationMsg}
                disabled={sendApiMessage.isPending}
              >
                <MapPin className="w-4 h-4" />
              </Button>
              <Input
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSendMessage()}
                placeholder="Type a message..."
                className="h-10 text-sm border-0 bg-muted rounded-xl"
              />
              <Button size="icon" className="h-9 w-9 flex-shrink-0 rounded-xl" onClick={handleSendMessage} disabled={!message.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
            {shareLocation && (
              <p className="text-[9px] text-success mt-1.5 flex items-center gap-1 px-1 font-medium">
                <Circle className="w-2 h-2 fill-success" /> Sharing live location
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="members" className="flex-1 overflow-y-auto m-0 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="section-header">{activeTrip.title} · Members</h3>
            <Button size="sm" className="h-8 text-xs gap-1.5 rounded-xl font-semibold" onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-3.5 h-3.5" /> Invite
            </Button>
          </div>
          <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground font-medium">
            <Radio className="w-3 h-3 text-primary" />
            <span><span className="font-semibold text-primary">{trackingIds.length}</span> tracking now in this trip</span>
          </div>
          <div className="space-y-2">
            {tripMembers.map(member => {
              const RoleIcon = roleIcons[member.role] || Eye;
              const tracking = isTracking(member.id);
              return (
                <Card key={member.id} className="border-0 card-interactive">
                  <CardContent className="p-3.5 flex items-center gap-3">
                    <div className="relative">
                      <img src={member.avatar} className="w-11 h-11 rounded-xl" />
                      {member.isOnline && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success ring-2 ring-card" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold truncate">{member.name} {member.id === user.id.toString() ? "(You)" : ""}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <RoleIcon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground capitalize font-medium">{member.role}</span>
                        {tracking && (
                          <Badge className="bg-primary/15 text-primary border-0 text-[9px] h-4 px-1.5 gap-1 font-semibold">
                            <Radio className="w-2.5 h-2.5" /> Tracking
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => handleShareProfile(member.name)}><Share2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="tracking" className="flex-1 m-0 flex flex-col min-h-0 overflow-hidden isolate">
          <section
            className="relative flex-[1_1_0%] min-h-[200px] max-h-[60vh] sm:max-h-[65vh] overflow-hidden isolate"
            role="region"
            aria-label={`Live tracking map for ${activeTrip.title}`}
          >
            <TrackingMap
              key={activeTrip.id}
              centerLat={activeTrip.centerLat}
              centerLng={activeTrip.centerLng}
              showHeatmap={showHeatmap}
              members={tripMembers}
              trackingTrails={{}}
              heatmapData={heatmapData}
            />

            <div className="absolute top-3 right-3 z-[500] flex flex-col gap-2 items-end max-w-[calc(100%-1.5rem)]">
              <Button
                type="button"
                size="sm"
                variant={showHeatmap ? "default" : "secondary"}
                onClick={() => setShowHeatmap(v => !v)}
                aria-pressed={showHeatmap}
                aria-label={showHeatmap ? "Hide activity heatmap" : "Show activity heatmap"}
                className="min-h-11 px-3 rounded-xl text-[11px] font-semibold shadow-card-hover backdrop-blur-sm border border-border/50 bg-card/95"
              >
                {showHeatmap ? "Hide" : "Show"} Heatmap
              </Button>
              <Badge
                className="bg-card/95 text-foreground border border-border/50 text-[10px] h-6 font-semibold gap-1 shadow-card-hover"
                aria-live="polite"
                aria-label={`${trackingIds.length} members currently tracking in this trip`}
              >
                <Radio className="w-2.5 h-2.5 text-primary" aria-hidden="true" /> {trackingIds.length} tracking
              </Badge>
            </div>
          </section>

          <Card
            className="relative z-10 border-0 border-t border-border/40 rounded-none bg-card/98 backdrop-blur-md overflow-hidden flex-[0_0_auto] max-h-[45vh] flex flex-col"
            style={{ paddingBottom: `env(safe-area-inset-bottom, 0px)` }}
            role="region"
            aria-label="Live tracking details"
          >

            <button
              type="button"
              onClick={() => setTrackOverlayOpen(v => !v)}
              className="w-full flex items-center justify-between px-4 min-h-11 py-2 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              aria-expanded={trackOverlayOpen}
              aria-controls="live-track-details"
              aria-label={trackOverlayOpen ? "Collapse live tracking details" : "Expand live tracking details"}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Radio className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden="true" />
                <p className="text-xs font-semibold truncate">Live · {activeTrip.title}</p>
                <Badge variant="outline" className="text-[10px] h-5 font-semibold flex-shrink-0">
                  {trackingIds.length} tracking
                </Badge>
              </div>
              {trackOverlayOpen
                ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                : <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />}
            </button>
            {trackOverlayOpen && (
              <CardContent id="live-track-details" className="px-3 pb-3 pt-0 overflow-y-auto min-h-0">

                <ul className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-0.5 list-none" aria-label="Members currently tracking">
                  {trackingIds.length === 0 && (
                    <li className="text-[11px] text-muted-foreground py-1">No one is tracking in this trip right now.</li>
                  )}
                  {tripMembers.filter(u => isTracking(u.id)).map(u => (
                    <li
                      key={u.id}
                      className="flex items-center gap-1.5 bg-muted rounded-xl px-2.5 py-1.5 flex-shrink-0"
                      aria-label={`${u.name}${u.id === user.id.toString() ? " (you)" : ""} is sharing live location`}
                    >
                      <img src={u.avatar} alt="" className="w-5 h-5 rounded-lg" />
                      <span className="text-[11px] font-semibold">{u.name.split(" ")[0]}{u.id === user.id.toString() ? " (You)" : ""}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" aria-hidden="true" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        </TabsContent>
      </Tabs>


      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={(open) => {
        setInviteOpen(open);
        if (!open) {
          setInviteName("");
          setInviteSuggestions([]);
          setSelectedInviteUser(null);
        }
      }}>
        <DialogContent className="max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Invite Member</DialogTitle>
            <DialogDescription>Search by name to add someone to the trip</DialogDescription>
          </DialogHeader>
          <div className="py-2 relative" ref={inviteSearchRef}>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Name Search</label>
            <div className="relative mt-1.5">
              <Input
                value={inviteName}
                onChange={e => {
                  setInviteName(e.target.value);
                  setSelectedInviteUser(null);
                }}
                placeholder="Type member name..."
                className="h-10 rounded-xl border-border pr-8"
              />
              {inviteSearchLoading && (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground absolute right-2.5 top-3" />
              )}
            </div>

            {inviteSuggestions.length > 0 && (
              <Card className="absolute left-0 right-0 mt-1 border border-border/60 shadow-lg rounded-xl z-50 overflow-hidden max-h-[160px] overflow-y-auto">
                <CardContent className="p-0">
                  {inviteSuggestions.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setSelectedInviteUser(u);
                        setInviteName(u.name);
                        setInviteSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-semibold hover:bg-muted/70 flex items-center gap-2 border-b border-border/10 last:border-b-0 transition-colors"
                    >
                      <img src={u.avatar || `https://ui-avatars.com/api/?name=${u.name}`} className="w-5 h-5 rounded-md" alt="" />
                      <div className="truncate">
                        <p>{u.name}</p>
                        <p className="text-[9px] text-muted-foreground font-normal">{u.email}</p>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
          <Button className="w-full h-10 rounded-xl shadow-travel font-semibold" onClick={handleInvite} disabled={(!selectedInviteUser && !inviteName.trim()) || inviting}>
            {inviting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Send Invite"}
          </Button>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {activeCall === "video" && (callPeer || call.incomingCall) && (
          <VideoCallOverlay
            key="video-call"
            call={call}
            remoteUserId={callPeer?.id || call.incomingCall?.from || ""}
            remoteName={callPeer?.name || (call.incomingCall ? (tripMembers.find(m => String(m.id) === String(call.incomingCall?.from))?.name || "Collaborator") : "Collaborator")}
            remoteAvatar={callPeer?.avatar || (call.incomingCall ? (tripMembers.find(m => String(m.id) === String(call.incomingCall?.from))?.avatar || "https://i.pravatar.cc/150") : "https://i.pravatar.cc/150")}
            autoStart={call.callStatus === "idle"}
            onClose={() => {
              call.hangUp();
              setActiveCall(null);
            }}
          />
        )}
        {activeCall === "audio" && (callPeer || call.incomingCall) && (
          <VoiceCallOverlay
            key="voice-call"
            call={call}
            remoteUserId={callPeer?.id || call.incomingCall?.from || ""}
            remoteName={callPeer?.name || (call.incomingCall ? (tripMembers.find(m => String(m.id) === String(call.incomingCall?.from))?.name || "Collaborator") : "Collaborator")}
            remoteAvatar={callPeer?.avatar || (call.incomingCall ? (tripMembers.find(m => String(m.id) === String(call.incomingCall?.from))?.avatar || "https://i.pravatar.cc/150") : "https://i.pravatar.cc/150")}
            autoStart={call.callStatus === "idle"}
            onClose={() => {
              call.hangUp();
              setActiveCall(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
