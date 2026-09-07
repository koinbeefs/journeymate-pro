# Feature Implementation Plan

This document outlines the approach for building the **Dynamic Transit Module** and **Tourist Viewpoint Side Trips** features.

## 1. Dynamic Transit Module (Multi-Modal Routing)
**Goal:** Allow users to define multiple chained transit options to reach a destination (e.g., Trike to Crossing → Bus to Mayantoc).

### Proposed Changes
1. **Types (`src/types/travel.ts`)**
   - Enhance the `ItineraryStop` interface to support an array of transit segments instead of a single type.
   ```typescript
   export interface TransitSegment {
     id: string;
     type: TransitType;
     description: string; // e.g., "Tricycle to crossing", "Bus to Mayantoc"
   }
   
   // Update ItineraryStop to include:
   transitSegments?: TransitSegment[];
   ```
2. **UI Updates (`src/components/travel/ItineraryTimeline.tsx`)**
   - When rendering the connector between stops, if `transitSegments` exists, render a detailed breakdown showing the chained transit steps instead of a single vehicle icon.
3. **Editor Updates (`src/components/travel/TripWizard.tsx` or Trip Editor)**
   - Add a button in the transit selection area to **"+ Add Transit Leg"**. This will allow users to chain multiple vehicles together for a single destination hop.

---

## 2. Tourist Viewpoint Side Trips (Detours)
**Goal:** Allow users to click on tourist viewpoints along their route to add them as a side trip (waypoint). The final destination is preserved, and the app will proactively suggest nearby viewpoints during active navigation.

### Proposed Changes
1. **Interactive Route Details (`src/components/travel/RouteDetailsPanel.tsx`)**
   - Currently, viewpoints are displayed in a read-only list. We will make these list items clickable.
   - Add an `onAddWaypoint?: (viewpoint: any) => void` prop. When clicked, trigger this callback.
2. **Proactive Suggestions During Navigation (`src/components/pages/NavigationPage.tsx`)**
   - While navigation is active ("in go"), monitor the user's current GPS location against the list of viewpoints along the route.
   - If a viewpoint is approaching (e.g., within 5km) and is closely aligned with the current path, show a small unobtrusive popup/toast: "Scenic Viewpoint nearby: [Name]. Detour?"
3. **Routing Logic & Confirmation Dialog**
   - When a user clicks a viewpoint (either from the panel or the proactive suggestion popup), show a **Confirmation Dialog**: "Do you want to add [Viewpoint] as a side trip?"
   - Upon confirmation, add the viewpoint to the `waypoints` state array.
   - Re-trigger `fetchRoutePlan(start, destination, waypoints)` so the navigation line re-draws: `Current Location -> Viewpoint -> Original Destination`.

---

## ⚠️ API Notes & Feasibility
- **Transit APIs in the Philippines:** Major transit APIs (like Google Maps Transit or Sakay.ph) often lack data for informal transport in rural areas (like tricycles, local jeepneys, or specific crossings). We will integrate a search for transit hubs using our Places API to suggest common drop-offs, but we will *also* provide a manual text input fallback so users can always type "Tricycle to crossing" when API data is missing.
