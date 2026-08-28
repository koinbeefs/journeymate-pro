import { useQuery } from "@tanstack/react-query";
import { trackingApi } from "@/lib/api";
import { useEffect, useRef } from "react";
import { useAuth } from "@/auth/AuthProvider";

// Module-level singleton: tracks how many components have the location interval active.
// Ensures only ONE GPS update interval runs at a time regardless of how many components
// call useTracking() — eliminates duplicate POST /users/location every 30s.
let locationIntervalId: ReturnType<typeof setInterval> | null = null;
let locationIntervalUsers = 0;
let lastLocationUpdate = 0;

export function useTracking() {
  const { user } = useAuth();
  const hasInterval = useRef(false);

  // Singleton location push — only ONE interval ever runs across all mounted instances.
  useEffect(() => {
    if (!user) return;
    // If an interval is already running from another mounted instance, skip.
    if (locationIntervalId !== null && hasInterval.current === false) {
      locationIntervalUsers++;
      hasInterval.current = true;
      return () => {
        locationIntervalUsers--;
        hasInterval.current = false;
      };
    }

    const updateLoc = () => {
      const now = Date.now();
      // Throttle: don't send if we already sent in the last 25 seconds
      if (now - lastLocationUpdate < 25000) return;
      
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lastLocationUpdate = Date.now();
          trackingApi.updateLocation(pos.coords.latitude, pos.coords.longitude).catch(() => {});
        },
        () => {} // Silently ignore permission/availability errors
      );
    };

    updateLoc(); // Immediate first call
    locationIntervalId = setInterval(updateLoc, 30000);
    locationIntervalUsers++;
    hasInterval.current = true;

    return () => {
      locationIntervalUsers--;
      hasInterval.current = false;
      if (locationIntervalUsers <= 0 && locationIntervalId !== null) {
        clearInterval(locationIntervalId);
        locationIntervalId = null;
        locationIntervalUsers = 0;
      }
    };
  }, [user]);

  // Heatmap query — TanStack Query already deduplicates this; all instances share one observer.
  const { data: heatmapData = [] } = useQuery({
    queryKey: ['heatmap'],
    queryFn: async () => {
      const response = await trackingApi.getHeatmap();
      return response.data as [number, number, number][];
    },
    refetchInterval: 60000,
  });

  return { heatmapData };
}
