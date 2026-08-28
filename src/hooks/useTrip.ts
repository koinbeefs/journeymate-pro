import { useCallback, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { tripsApi, itinerariesApi } from "@/lib/api";
import echo from "@/lib/echo";
import { repo } from "@/lib/storage";
import { useGeolocation } from "@/hooks/useGeolocation";
import type { Trip, ItineraryStop, TransitType, WeatherCondition } from "@/types/travel";

function parseUtcDate(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  // If it already has ISO indicators
  if (dateStr.includes('T') && (dateStr.includes('Z') || dateStr.includes('+'))) {
    return new Date(dateStr).getTime();
  }
  // If it's SQL format, replace space with 'T' and add 'Z' to treat as UTC
  const formatted = dateStr.replace(' ', 'T') + 'Z';
  const time = new Date(formatted).getTime();
  return isNaN(time) ? 0 : time;
}

export function useTrip(initialId?: string) {
  const queryClient = useQueryClient();
  const { fix } = useGeolocation();
  const [activeId, setActiveId] = useState<string | undefined>(initialId);
  // Per-instance guard: prevents a double-trigger of calculateRoute (e.g. React Strict Mode or
  // rapid re-renders) from sending duplicate requests to the backend.
  const routeCalcInFlight = useRef(false);

  // Fetch all trips
  const { data: trips = [], isLoading: isLoadingTrips } = useQuery({
    queryKey: ['trips'],
    queryFn: async () => {
      const response = await tripsApi.getAll();
      const offlineTrips = repo.offlineTrips.list();
      return response.data.map((trip: any) => ({
        id: trip.id,
        title: trip.title,
        description: trip.description || "",
        startDate: trip.start_date,
        endDate: trip.end_date,
        destination: trip.destination || "",
        transitType: (trip.transit_type || "car") as TransitType,
        status: trip.invitation_status === 'pending' ? 'pending' : (trip.is_active ? 'active' : 'planning'),
        coverImage: "https://images.unsplash.com/photo-1518509562904-e7ef99cdcc86?w=800&q=80",
        isOfflineAvailable: offlineTrips.includes(String(trip.id)),
        centerLat: trip.center_lat ? Number(trip.center_lat) : 14.5995,
        centerLng: trip.center_lng ? Number(trip.center_lng) : 120.9842,
        collaborators: trip.users ? trip.users.map((u: any) => {
          const lat = u.last_location_lat ? Number(u.last_location_lat) : null;
          const lng = u.last_location_lng ? Number(u.last_location_lng) : null;
          const lastActive = parseUtcDate(u.last_active_at);
          const isOnline = lastActive ? (Date.now() - lastActive < 300000) : false; // active in past 5 mins

          return {
            id: String(u.id),
            name: u.username,
            email: u.email,
            avatar: u.profile_pic || `https://ui-avatars.com/api/?name=${u.username}`,
            role: u.pivot?.role || 'editor',
            isOnline,
            lastLocation: (lat && lng) ? { lat, lng } : undefined
          };
        }) : [],
        owner: trip.owner ? {
          id: String(trip.owner.id),
          name: trip.owner.username,
          email: trip.owner.email,
          avatar: trip.owner.profile_pic || `https://ui-avatars.com/api/?name=${trip.owner.username}`,
          role: 'owner',
          isOnline: trip.owner.last_active_at ? (Date.now() - parseUtcDate(trip.owner.last_active_at) < 300000) : false,
          lastLocation: (trip.owner.last_location_lat && trip.owner.last_location_lng) ? {
            lat: Number(trip.owner.last_location_lat),
            lng: Number(trip.owner.last_location_lng)
          } : undefined
        } : undefined,
        expenses: [],
        budget: undefined,
        stops: trip.itineraries ? trip.itineraries.map((itinerary: any) => {
          const arrival = itinerary.time || "09:00";
          const duration = itinerary.duration_minutes || 60;
          
          const [hours, minutes] = arrival.split(':').map(Number);
          const depDate = new Date();
          depDate.setHours(hours, minutes + duration);
          const departureTime = `${String(depDate.getHours()).padStart(2, '0')}:${String(depDate.getMinutes()).padStart(2, '0')}`;
          
          return {
            id: itinerary.id,
            location: {
              id: itinerary.place_id,
              name: itinerary.place_name,
              address: itinerary.place_address,
              lat: itinerary.lat,
              lng: itinerary.lng,
            },
            arrivalTime: arrival,
            departureTime: departureTime,
            notes: itinerary.notes || "",
            transitType: "car",
            weather: "sunny",
            temperature: 28,
            isCompleted: false,
            durationMinutes: duration,
            dayNumber: itinerary.day_number || 1,
          };
        }) : [],
      })) as Trip[];
    },
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (trips.length === 0) return;
    
    trips.forEach(trip => {
      echo.join(`trip.${trip.id}`)
        .here((users: any[]) => {
          // Mark users as online
          queryClient.setQueryData(['trips'], (oldData: any[]) => {
              if (!oldData) return oldData;
              const onlineIds = users.map(u => String(u.id));
              return oldData.map((t: any) => {
                if (t.id !== trip.id) return t;
                const c = t.collaborators.map((c: any) => ({ ...c, isOnline: onlineIds.includes(c.id) }));
                const o = t.owner ? { ...t.owner, isOnline: onlineIds.includes(t.owner.id) } : t.owner;
                return { ...t, collaborators: c, owner: o };
              });
          });
        })
        .joining((user: any) => {
          queryClient.setQueryData(['trips'], (oldData: any[]) => {
              if (!oldData) return oldData;
              return oldData.map((t: any) => {
                if (t.id !== trip.id) return t;
                const c = t.collaborators.map((c: any) => c.id === String(user.id) ? { ...c, isOnline: true } : c);
                const o = t.owner?.id === String(user.id) ? { ...t.owner, isOnline: true } : t.owner;
                return { ...t, collaborators: c, owner: o };
              });
          });
        })
        .leaving((user: any) => {
          queryClient.setQueryData(['trips'], (oldData: any[]) => {
              if (!oldData) return oldData;
              return oldData.map((t: any) => {
                if (t.id !== trip.id) return t;
                const c = t.collaborators.map((c: any) => c.id === String(user.id) ? { ...c, isOnline: false } : c);
                const o = t.owner?.id === String(user.id) ? { ...t.owner, isOnline: false } : t.owner;
                return { ...t, collaborators: c, owner: o };
              });
          });
        })
        .listen('LocationUpdated', (e: any) => {
          queryClient.setQueryData(['trips'], (oldData: any[]) => {
              if (!oldData) return oldData;
              return oldData.map((t: any) => {
                if (t.id !== trip.id) return t;
                const c = t.collaborators.map((c: any) => c.id === String(e.locationData.user_id) 
                  ? { ...c, lastLocation: { lat: e.locationData.lat, lng: e.locationData.lng } } : c);
                const o = t.owner?.id === String(e.locationData.user_id) 
                  ? { ...t.owner, lastLocation: { lat: e.locationData.lat, lng: e.locationData.lng } } : t.owner;
                return { ...t, collaborators: c, owner: o };
              });
          });
        });
    });

    return () => {
        trips.forEach(trip => echo.leave(`trip.${trip.id}`));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips.map(t => t.id).join(','), queryClient]);

  const effectiveActiveId = activeId !== undefined ? String(activeId) : (trips.length > 0 ? String(trips[0].id) : undefined);
  const activeBase = trips.find(t => String(t.id) === effectiveActiveId) ?? trips[0];

  // Fetch stops for active trip
  const { data: activeStops = [], isLoading: isLoadingStops } = useQuery({
    queryKey: ['trips', effectiveActiveId, 'stops'],
    queryFn: async () => {
      if (!effectiveActiveId) return [];
      const response = await itinerariesApi.getAll(effectiveActiveId);
      return response.data.map((itinerary: any) => {
        const arrival = itinerary.time || "09:00";
        const duration = itinerary.duration_minutes || 60;
        
        // Compute departure time string
        const [hours, minutes] = arrival.split(':').map(Number);
        const depDate = new Date();
        depDate.setHours(hours, minutes + duration);
        const departureTime = `${String(depDate.getHours()).padStart(2, '0')}:${String(depDate.getMinutes()).padStart(2, '0')}`;
        
        // Parse weather_summary if available
        let weatherCond: WeatherCondition = "sunny";
        let tempValue = 28;
        if (itinerary.weather_summary) {
          const lowerSummary = String(itinerary.weather_summary).toLowerCase();
          if (lowerSummary.includes('rain')) weatherCond = "rainy";
          else if (lowerSummary.includes('cloud')) weatherCond = "cloudy";
          else if (lowerSummary.includes('storm')) weatherCond = "stormy";
          else if (lowerSummary.includes('snow')) weatherCond = "snowy";
          else if (lowerSummary.includes('fog')) weatherCond = "foggy";
          
          const match = String(itinerary.weather_summary).match(/(\d+(?:\.\d+)?)/);
          if (match) tempValue = Math.round(Number(match[1]));
        }

        return {
          id: itinerary.id,
          location: {
            id: itinerary.place_id,
            name: itinerary.place_name,
            address: itinerary.place_address,
            lat: itinerary.lat,
            lng: itinerary.lng,
          },
          arrivalTime: arrival,
          departureTime: departureTime,
          notes: itinerary.notes || "",
          transitType: "car" as TransitType,
          weather: weatherCond,
          temperature: tempValue,
          isCompleted: false,
          durationMinutes: duration,
          distanceFromPrevious: itinerary.distance_from_previous || 0,
          driveTimeFromPrevious: itinerary.drive_time_from_previous || 0,
          dayNumber: itinerary.day_number || 1,
        };
      }) as ItineraryStop[];
    },
    enabled: !!effectiveActiveId,
    placeholderData: keepPreviousData,
  });

  const active = activeBase ? { ...activeBase, stops: activeStops } : undefined;

  // Mutations
  const { mutateAsync: upsertMutation } = useMutation({
    mutationFn: async (trip: Trip) => {
      const payload = {
        title: trip.title,
        description: trip.description,
        destination: trip.destination || (trip as any).destinations?.[0]?.name || "Unknown",
        trip_type: 'manual',
        start_date: trip.startDate,
        end_date: trip.endDate,
        transit_type: trip.transitType || "car",
        center_lat: (trip as any).destinations?.[0]?.lat || 14.5995,
        center_lng: (trip as any).destinations?.[0]?.lng || 120.9842,
      };
      if (trip.id && !trip.id.startsWith('temp-')) {
        const response = await tripsApi.update(trip.id, payload);
        return response.data;
      } else {
        const response = await tripsApi.create(payload);
        const newTrip = response.data;
        
        // If the wizard passed destinations, create them as itineraries
        if ((trip as any).destinations && (trip as any).destinations.length > 0) {
          const dests = (trip as any).destinations;
          for (let i = 0; i < dests.length; i++) {
            const dest = dests[i];
            await itinerariesApi.create({
              trip_id: newTrip.id,
              place_id: dest.id || Math.random().toString(),
              place_name: dest.name,
              place_address: (dest as any).address || dest.description || dest.name,
              lat: dest.lat,
              lng: dest.lng,
              day_number: 1,
              order: i + 1,
              notes: "Added from trip wizard",
              category: dest.type || "",
              // Skip per-insert recalculation — we'll do one pass at the end via calculateRoute.
              skip_recalculate: true,
            });
          }

          if (!routeCalcInFlight.current) {
            routeCalcInFlight.current = true;
            try {
              // Rearrange based on user's actual GPS location if available, otherwise fallback
              const startLat = fix?.lat ?? payload.center_lat;
              const startLng = fix?.lng ?? payload.center_lng;
              await itinerariesApi.rearrange(newTrip.id, startLat, startLng);
              await itinerariesApi.calculateRoute(newTrip.id);
            } catch (err) {
              console.warn("Could not optimize initial trip route automatically", err);
            } finally {
              routeCalcInFlight.current = false;
            }
          }
        }
        return newTrip;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const { mutateAsync: removeMutation } = useMutation({
    mutationFn: async (id: string) => {
      await tripsApi.delete(id);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const { mutateAsync: optimizeRouteMutation, isPending: isOptimizing } = useMutation({
    mutationFn: async ({ id, lat, lng }: { id: string; lat: number; lng: number }) => {
      await itinerariesApi.rearrange(id, lat, lng);
      await itinerariesApi.calculateRoute(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const upsert = useCallback(async (trip: Trip) => {
    return upsertMutation(trip);
  }, [upsertMutation]);

  const remove = useCallback(async (id: string) => {
    return removeMutation(id);
  }, [removeMutation]);

  const optimizeRoute = useCallback(async (id: string, lat: number, lng: number) => {
    return optimizeRouteMutation({ id, lat, lng });
  }, [optimizeRouteMutation]);

  const setActiveIdSafe = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  return { 
    trips, 
    active, 
    setActiveId: setActiveIdSafe, 
    upsert, 
    remove, 
    optimizeRoute,
    isOptimizing,
    isLoading: isLoadingTrips || isLoadingStops 
  };
}
