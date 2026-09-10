# Feature Implementation Plan

This document outlines the approach for building the **Dynamic Transit Module** and **Tourist Viewpoint Side Trips** features.

## 1. Dynamic Transit Module (Multi-Modal Routing)

**Goal:** Provide an end-to-end multi-modal transit engine that automatically fetches public transit directions (via Google Maps Transit on RapidAPI) and allows users to build, edit, and navigate custom chained transit legs for provincial/local journeys (e.g., *Tricycle to Crossing → Jeepney/Bus to Hub → Walk to Destination*).

---

### 1.1 API & Feasibility Strategy (Hybrid Model)

- **Google Maps Transit via RapidAPI:**
  - Standard transit queries (`mode=transit`) will be routed through the Google Maps Directions API on RapidAPI (`x-rapidapi-key`).
  - Google Maps Transit returns step-by-step public transport routes (`transit_details`) including bus line names, train/LRT/MRT stations, stop counts, agencies, and walking connections where GTFS data is available.
- **Local & Rural Philippine Transport Handling:**
  - Rural or provincial regions frequently lack GTFS coverage for informal transport (jeepneys, tricycles, habal-habal, UV Express, local ferry crossings).
  - **Hybrid Engine Approach:**
    1. **Automated Search:** Query Google Maps Transit API via backend `RouteService.php`. If a full or partial GTFS route is returned, convert it automatically into structured `TransitSegment[]` items.
    2. **Custom Multi-Leg Builder:** If GTFS returns no route (or if the user wishes to customize their itinerary), the user can use the **Custom Transit Segment Builder** to add, edit, or reorder multi-leg chains with vehicle mode selection, stop hub search (via Places API), fare estimation, and notes.

---

### 1.2 Data Structures & Types (`src/types/travel.ts`)

Enhance travel types to support granular multi-segment transit routing:

```typescript
export type TransitType = 
  | "car" 
  | "bus" 
  | "train" 
  | "plane" 
  | "ferry" 
  | "bike" 
  | "walk" 
  | "jeepney" 
  | "tricycle" 
  | "uv_express" 
  | "custom";

export interface TransitSegment {
  id: string;
  type: TransitType;
  title: string;                 // e.g. "Tricycle to Mayantoc Crossing"
  departureName?: string;        // e.g. "Capas Junction"
  arrivalName?: string;          // e.g. "Mayantoc Town Plaza"
  durationMinutes?: number;      // Estimated duration in mins
  costEstimate?: number;          // Estimated fare in PHP
  distanceKm?: number;            // Distance in km
  agency?: string;               // e.g. "Victory Liner" or "LRT Line 1"
  lineName?: string;             // e.g. "Route 4 / Bus 102"
  instructions?: string;         // e.g. "Board at Bay 3, alight at Crossing"
  polyline?: string;             // Polyline for map display
}

// Updated ItineraryStop
export interface ItineraryStop {
  id: string;
  location: Location;
  arrivalTime: string;
  departureTime: string;
  notes: string;
  transitType: TransitType;
  transitSegments?: TransitSegment[]; // Detailed breakdown for chained legs
  weather?: WeatherCondition;
  temperature?: number;
  isCompleted: boolean;
  distanceFromPrevious?: number;
  driveTimeFromPrevious?: number;
  dayNumber?: number;
}
```

---

### 1.3 Backend Architecture (`backend/app/Services/RouteService.php`)

1. **Google Maps Transit Integration (`calculateGoogleTransitRoute`):**
   - Execute HTTP request to RapidAPI Google Directions with `mode=transit` using `env('RAPIDAPI_KEY')`.
   - Parse `routes[0].legs[0].steps[]`:
     - If `travel_mode === "TRANSIT"`, extract `transit_details` (`line.short_name`, `line.name`, `line.vehicle.type`, `departure_stop.name`, `arrival_stop.name`, `num_stops`).
     - Map Google vehicle types (BUS, SUBWAY, HEAVY_RAIL, FERRY) to internal `TransitType` values (`bus`, `train`, `ferry`, `walk`).
     - Convert encoded Google polylines into GeoJSON format.
2. **Normalized API Payload Response:**
   - Return normalized JSON array of `transit_segments` alongside main polyline and step instructions.

---

### 1.4 Frontend UI Components

1. **Interactive Multi-Leg Timeline (`src/components/travel/ItineraryTimeline.tsx`):**
   - Render multi-modal connection badges between itinerary stops.
   - Display step-by-step icons (🛺 Tricycle, 🚐 Jeepney, 🚌 Bus, 🚆 Train, 🚶 Walk, ⛴️ Ferry).
   - Show total estimated transit time and aggregate fare breakdown.
2. **Transit Segment Editor Modal (`src/components/travel/TransitSegmentEditorModal.tsx`):**
   - Multi-segment drawer/modal:
     - Vehicle type selection grid.
     - Origin & Destination stop hub search (integrated with `PlaceService` search for transit hubs, terminals, and crossings).
     - Manual text input fallback for local routes.
     - Fare & duration inputs.
     - Drag-and-drop or arrow controls to reorder chained legs.
3. **Trip Editor & Navigation Page Integration (`src/components/travel/TripWizard.tsx`, `NavigationPage.tsx`, `RouteDetailsPanel.tsx`):**
   - Enable "+ Add Transit Leg" button when editing trips.
   - Show segment-by-segment step cards in `RouteDetailsPanel.tsx` with live mode-switch cues during navigation.

---

## 2. Tourist Viewpoint Side Trips (Detours)
**Goal:** Allow users to click on tourist viewpoints along their route to add them as a side trip (waypoint). The final destination is preserved, and the app will proactively suggest nearby viewpoints during active navigation.

### Proposed Changes
1. **Interactive Route Details (`src/components/travel/RouteDetailsPanel.tsx`)**
   - Currently, viewpoints are displayed in a read-only list. We will make these list items clickable.
   - Add an `onAddWaypoint?: (viewpoint: any) => void` prop. When clicked, trigger this callback.
2. **Proactive Suggestions During Navigation (`src/components/pages/NavigationPage.tsx`)**
   - While navigation is active ("in go"), monitor the user's current GPS location against the list of viewpoints along the route.
   - If a viewpoint is approaching (within 500m–1km radius) and is closely aligned with the current path, show a small unobtrusive popup/toast: "Scenic Viewpoint nearby: [Name]. Detour?"
3. **Routing Logic & Confirmation Dialog**
   - When a user clicks a viewpoint (either from the panel or the proactive suggestion popup), show a **Confirmation Dialog**: "Do you want to add [Viewpoint] as a side trip?"
   - Upon confirmation, add the viewpoint to the `waypoints` state array.
   - Re-trigger `fetchRoutePlan(start, destination, waypoints)` so the navigation line re-draws: `Current Location -> Viewpoint -> Original Destination`.

---

## ⚠️ API Notes & Feasibility
- **Transit APIs in the Philippines:** Major transit APIs (like Google Maps Transit or Sakay.ph) often lack data for informal transport in rural areas (like tricycles, local jeepneys, or specific crossings). We will integrate a search for transit hubs using our Places API to suggest common drop-offs, but we will *also* provide a manual text input fallback so users can always type "Tricycle to crossing" when API data is missing.
