<?php declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Itinerary;
use App\Models\Trip;
use App\Services\WeatherService;
use App\Services\PlaceSearchService;
use App\Services\RouteService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

class ItineraryController extends Controller
{
    protected $weatherService;
    protected $placeSearchService;
    protected $routeService;

    public function __construct(
        WeatherService $weatherService,
        PlaceSearchService $placeSearchService,
        RouteService $routeService
    ) {
        $this->weatherService = $weatherService;
        $this->placeSearchService = $placeSearchService;
        $this->routeService = $routeService;
    }

    // Add place to itinerary
    public function store(Request $request)
    {
        $request->validate([
            'trip_id' => 'required|exists:trips,id',
            'place_id' => 'required',
            'place_name' => 'required',
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
            'day_number' => 'required|integer|min:1',
            'order' => 'required|integer|min:0',
            'time' => 'nullable|date_format:H:i',
            'duration_minutes' => 'nullable|integer',
            'category' => 'nullable|string',
            // When true, skip recalculateSchedule — caller will trigger it once after bulk insert.
            'skip_recalculate' => 'nullable|boolean',
        ]);

        $trip = Trip::findOrFail($request->trip_id);
        
        // Authorization check (ensure user owns trip or is accepted collaborator)
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Get weather (Handle failures gracefully)
        $weather = [];
        try {
            $weather = $this->weatherService->getWeather($request->lat, $request->lng);
        } catch (\Exception $e) {
            // Ignore weather errors, proceed with itinerary creation
            \Illuminate\Support\Facades\Log::warning('Weather service failed: ' . $e->getMessage());
        }

        // Find gas stations (Handle failures gracefully)
        $gasStations = [];
        try {
            $gasStations = $this->placeSearchService->findGasStations($request->lat, $request->lng);
        } catch (\Exception $e) {
            // Ignore search errors
        }

        // Determine stay duration based on category or place name keywords
        $duration = $this->determineDuration($request->category, $request->place_name);
        $duration = $request->duration_minutes ?? $duration;

        $itinerary = Itinerary::create([
            'trip_id' => $request->trip_id,
            'user_id' => $request->user()->id,
            'place_id' => $request->place_id,
            'place_name' => $request->place_name,
            'place_address' => $request->place_address ?? null,
            'lat' => $request->lat,
            'lng' => $request->lng,
            'day_number' => $request->day_number,
            'order' => $request->order,
            'time' => $request->time,
            'duration_minutes' => $duration,
            'weather_summary' => $weather['summary'] ?? null,
            'weather_icon' => $weather['icon'] ?? null,
            'nearby_gas_stations' => json_encode($gasStations),
        ]);

        // Only recalculate schedule if not explicitly deferred by the caller (e.g. bulk insert).
        if (!$request->boolean('skip_recalculate')) {
            $this->recalculateSchedule($trip);
        }
        $itinerary->refresh();

        return response()->json($itinerary, 201);
    }

    // Update itinerary item
    public function update(Request $request, $id)
    {
        $itinerary = Itinerary::findOrFail($id);
        $trip = $itinerary->trip;
        
        // Authorization check (ensure user owns trip or is accepted collaborator)
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // 2. Validate Input
        $request->validate([
            'time' => 'nullable|date_format:H:i',
            'duration_minutes' => 'nullable|integer|min:1',
            'notes' => 'nullable|string'
        ]);

        // 3. Filter Input
        // Only allow updating these specific fields to avoid overwriting computed data
        // like lat/lng/gas stations accidentally.
        $data = $request->only([
            'time', 
            'duration_minutes', 
            'notes', 
            'day_number', 
            'order'
        ]);

        // 4. Update
        $itinerary->update($data);

        // Recalculate schedule
        $this->recalculateSchedule($trip);

        return response()->json($itinerary->refresh());
    }

    // Delete itinerary item
    public function destroy($id)
    {
        $itinerary = Itinerary::findOrFail($id);
        $trip = $itinerary->trip;
        $user = request()->user();
        
        $isCollaborator = $trip->user_id === $user->id || 
            $trip->users()->where('trip_user.user_id', $user->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $itinerary->delete();
        $this->recalculateSchedule($trip);
        return response()->json(['message' => 'Deleted']);
    }

    // Get itineraries for a trip
    public function byTrip($tripId)
    {
        $itineraries = Itinerary::where('trip_id', $tripId)
            ->orderBy('day_number')
            ->orderBy('order')
            ->get();
        return response()->json($itineraries);
    }

    // Calculate route for all itinerary items
    public function calculateRoute($tripId)
    {
        // Idempotency guard: prevent duplicate concurrent executions for the same trip.
        // Lock TTL is 60 seconds — sufficient for OSRM + Geoapify calls to complete.
        $lock = Cache::lock("calculate-route-{$tripId}", 60);
        if (!$lock->get()) {
            return response()->json(['message' => 'Route calculation already in progress. Please wait.'], 202);
        }

        try {
            $trip = Trip::findOrFail($tripId);
            $itineraries = $trip->itineraries()->orderBy('day_number')->orderBy('order')->get();

            if ($itineraries->count() < 2) {
                return response()->json(['error' => 'Need at least 2 locations'], 400);
            }

            // Extract waypoints
            $waypoints = $itineraries->map(fn($i) => [$i->lat, $i->lng])->toArray();

            // Get route alternatives
            $routeService = new RouteService();
            $alternatives = $routeService->getRouteAlternatives($waypoints);

            if (empty($alternatives)) {
                return response()->json(['error' => 'Could not calculate route'], 400);
            }

            // Update trip with primary route
            $primaryRoute = reset($alternatives);
            $trip->update([
                'route_data' => json_encode($primaryRoute['geometry'] ?? null)
            ]);

            // Update each itinerary with distance and time from previous
            $legs = $primaryRoute['legs'] ?? [];
            foreach ($legs as $index => $leg) {
                if ($index + 1 < $itineraries->count()) {
                    $itineraries[$index + 1]->update([
                        'distance_from_previous' => $leg['distance'] / 1000,
                        'drive_time_from_previous' => intval($leg['duration'] / 60),
                    ]);
                }
            }

            // Recalculate schedule once at the end
            $this->recalculateSchedule($trip);

            return response()->json([
                'trip' => $trip,
                'itineraries' => $itineraries->map(fn($i) => $i->refresh()),
                'alternatives' => $alternatives
            ]);
        } finally {
            $lock->release();
        }
    }

    // Get route details (speed limits, turns, etc)
    public function routeDetails($tripId)
    {
        $trip = Trip::findOrFail($tripId);
        $itineraries = $trip->itineraries()->orderBy('day_number')->orderBy('order')->get();

        if ($itineraries->count() < 2) {
            return response()->json(['error' => 'Need at least 2 locations'], 400);
        }

        $waypoints = $itineraries->map(fn($i) => [$i->lat, $i->lng])->toArray();

        $routeService = new RouteService();
        
        try {
            $route = $routeService->calculateRoute($waypoints, $trip->transit_type ?? 'car');
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Route Calculation Failed: " . $e->getMessage());
            return response()->json(['error' => 'Route service unavailable'], 500);
        }

        // Validate response structure
        if (!$route || !isset($route['routes'][0])) {
            return response()->json(['error' => 'Could not calculate route'], 400);
        }

        $speedInfo = $routeService->getSpeedLimits($route['routes'][0]);

        return response()->json([
            'route' => $route['routes'][0],
            'speed_limits' => $speedInfo,
            'total_distance' => ($route['routes'][0]['distance'] ?? 0) / 1000,
            'total_duration' => ($route['routes'][0]['duration'] ?? 0) / 60,
        ]);
    }

    // Generic route calculation (no tripId required)
    public function calculateGenericRoute(Request $request)
    {
        $request->validate([
            'start_lat' => 'required|numeric',
            'start_lng' => 'required|numeric',
            'end_lat' => 'required|numeric',
            'end_lng' => 'required|numeric',
            'mode' => 'nullable|string',
            'origin_name' => 'nullable|string',
            'dest_name' => 'nullable|string',
        ]);

        $waypoints = [
            [$request->start_lat, $request->start_lng],
            [$request->end_lat, $request->end_lng]
        ];

        $routeService = new RouteService();
        $mode = $request->mode ?? 'car';
        $originName = $request->input('origin_name', 'Your Starting Location');
        $destName = $request->input('dest_name', 'Destination');

        try {
            $route = $routeService->calculateRoute($waypoints, $mode, true, $originName, $destName);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("Generic Route Calc Failed: " . $e->getMessage());
            return response()->json(['error' => 'Route service unavailable'], 500);
        }

        if (!$route || !isset($route['routes'][0])) {
            return response()->json(['error' => 'Could not calculate route'], 400);
        }

        $speedInfo = $routeService->getSpeedLimits($route['routes'][0]);

        return response()->json([
            'primary' => $route['routes'][0],
            'alternatives' => array_slice($route['routes'], 1),
            'speed_limits' => $speedInfo,
            'total_distance' => ($route['routes'][0]['distance'] ?? 0) / 1000,
            'total_duration' => ($route['routes'][0]['duration'] ?? 0) / 60,
        ]);
    }

    // Search places for adding to itinerary
    public function searchPlaces(Request $request)
    {
        $request->validate([
            'query' => 'required|string|min:2',
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
        ]);

        // FIX: Ensure this calls the method we renamed in Step 2 of the previous turn
        $places = $this->placeSearchService->searchPlaces(
            $request->query('query'), // Use 'query' method to get GET param safely
            $request->lat,
            $request->lng,
            $request->radius ?? 10000
        );

        return response()->json($places);
    }

    // Get suggestions between two waypoints
    public function suggestPlaces(Request $request)
    {
        $request->validate([
            'from_lat' => 'required|numeric',
            'from_lng' => 'required|numeric',
            'to_lat' => 'required|numeric',
            'to_lng' => 'required|numeric',
        ]);

        // Calculate midpoint
        $midLat = ($request->from_lat + $request->to_lat) / 2;
        $midLng = ($request->from_lng + $request->to_lng) / 2;

        // Suggest restaurants, hotels, gas stations
        $suggestions = $this->placeSearchService->searchNearby(
            $midLat,
            $midLng,
            ['restaurant', 'hotel', 'cafe', 'fuel']
        );

        return response()->json($suggestions);
    }

    // Rearrange itinerary stops based on proximity to initial location
    public function rearrange(Request $request, $tripId)
    {
        $request->validate([
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
        ]);

        $trip = Trip::findOrFail($tripId);
        
        // Authorization check
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $itineraries = $trip->itineraries()->get();
        if ($itineraries->isEmpty()) {
            return response()->json(['message' => 'Itinerary is empty'], 400);
        }

        $currentLat = (float) $request->lat;
        $currentLng = (float) $request->lng;

        $remaining = $itineraries->all();
        $sorted = [];

        while (!empty($remaining)) {
            $closestIndex = null;
            $minDist = INF;

            foreach ($remaining as $index => $item) {
                // Euclidean distance for proximity sorting
                $dist = sqrt(pow($currentLat - $item->lat, 2) + pow($currentLng - $item->lng, 2));
                if ($dist < $minDist) {
                    $minDist = $dist;
                    $closestIndex = $index;
                }
            }

            if ($closestIndex !== null) {
                $closestItem = $remaining[$closestIndex];
                $sorted[] = $closestItem;
                unset($remaining[$closestIndex]);
                // Reindex array
                $remaining = array_values($remaining);

                $currentLat = $closestItem->lat;
                $currentLng = $closestItem->lng;
            } else {
                break;
            }
        }

        // Update orders (0-indexed or 1-indexed order)
        foreach ($sorted as $newOrder => $item) {
            $item->update(['order' => $newOrder + 1]);
        }

        // Recalculate arrival times
        $this->recalculateSchedule($trip);

        return response()->json($trip->itineraries()->orderBy('order')->get());
    }

    // Auto-plan remaining days based on Day 1 preferences
    public function autoPlan(Request $request, $tripId, \App\Services\PlaceService $placeService)
    {
        $trip = Trip::with('itineraries')->findOrFail($tripId);
        
        // Authorization check
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $userId = $request->user()->id;

        // Calculate days
        $startDate = \Illuminate\Support\Carbon::parse($trip->start_date);
        $endDate = \Illuminate\Support\Carbon::parse($trip->end_date);
        $days = $startDate->diffInDays($endDate) + 1;

        if ($days <= 1) {
            return response()->json(['message' => 'Your trip is only 1 day. Nothing to plan for subsequent days!'], 400);
        }

        // Get Day 1 itineraries
        $day1Itineraries = $trip->itineraries()->where('day_number', 1)->get();
        if ($day1Itineraries->isEmpty()) {
            return response()->json(['message' => 'Please add at least one stop to Day 1 first so the AI can understand your preferences!'], 400);
        }

        // Detect user preferences from Day 1 category tags
        $day1Categories = $day1Itineraries->pluck('category')->filter()->toArray();
        $categoryCounts = array_count_values($day1Categories);
        arsort($categoryCounts);
        $preferredTypes = array_keys($categoryCounts);

        // Fetch popular attractions and restaurants near the trip destination center
        $lat = (float) $trip->center_lat;
        $lng = (float) $trip->center_lng;

        if (!$lat || !$lng) {
            // Fallback to first stop coordinates if center is not set
            $lat = (float) $day1Itineraries->first()->lat;
            $lng = (float) $day1Itineraries->first()->lng;
        }

        // Fetch pool of nearby items using PlaceService
        $attractions = [];
        $restaurants = [];

        try {
            $popularPlaces = $placeService->getPopular($lat, $lng);
            $popularRestaurants = $placeService->getHighRated($lat, $lng);
            
            // If they are empty or failed, use mock values or try standard search
            if (empty($popularPlaces) && empty($popularRestaurants)) {
                $popularPlaces = $this->placeSearchService->searchNearby($lat, $lng, ['tourism', 'catering']);
            }
            
            $allPlaces = array_merge($popularPlaces, $popularRestaurants);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("AutoPlan API Fetch failed: " . $e->getMessage());
            return response()->json(['message' => 'Place recommendations service is currently unavailable.'], 500);
        }

        // Exclude places already added to prevent duplicates
        $existingPlaceIds = $trip->itineraries->pluck('place_id')->toArray();
        $pool = [];
        foreach ($allPlaces as $p) {
            if (!in_array($p['id'], $existingPlaceIds)) {
                $pool[] = $p;
            }
        }

        // Sort pool based on user's Day 1 category preferences (places matching Day 1 preferred categories go first)
        usort($pool, function($a, $b) use ($preferredTypes) {
            $aPrefIdx = array_search($a['type'] ?? '', $preferredTypes);
            $bPrefIdx = array_search($b['type'] ?? '', $preferredTypes);
            
            $aHas = $aPrefIdx !== false;
            $bHas = $bPrefIdx !== false;
            
            if ($aHas && !$bHas) return -1;
            if (!$aHas && $bHas) return 1;
            if ($aHas && $bHas) {
                return $aPrefIdx - $bPrefIdx;
            }
            // Fallback to rating
            return ($b['rating'] ?? 0) <=> ($a['rating'] ?? 0);
        });

        // Group into attractions vs food
        $sights = [];
        $food = [];
        foreach ($pool as $p) {
            if (($p['type'] ?? '') === 'restaurant' || (($p['type'] ?? '') === 'cafe')) {
                $food[] = $p;
            } else {
                $sights[] = $p;
            }
        }

        $isPreview = $request->input('preview') === 'true' || $request->input('preview') === true;

        if (!$isPreview) {
            // Delete existing itineraries for Days 2+ to avoid double generation if clicked again
            Itinerary::where('trip_id', $trip->id)->where('day_number', '>', 1)->delete();
        }

        $plannedStops = [];
        
        // Arrange 5 stops per day for Days 2 to N
        for ($d = 2; $d <= $days; $d++) {
            // Stop 1: Attraction (09:30 AM)
            if (!empty($sights)) {
                $place = array_shift($sights);
                if ($isPreview) {
                    $plannedStops[] = $this->buildPreviewItineraryStop($place, $d, 1, '09:30', 120, 'AI Planned Attraction');
                } else {
                    $plannedStops[] = $this->createItineraryStop($trip->id, $userId, $place, $d, 1, '09:30', 120, 'AI Planned Stop based on Day 1 style');
                }
            }
            // Stop 2: Coffee/Snack (11:45 AM)
            if (!empty($food)) {
                $place = array_shift($food);
                if ($isPreview) {
                    $plannedStops[] = $this->buildPreviewItineraryStop($place, $d, 2, '11:45', 45, 'AI Suggested Coffee/Snack');
                } else {
                    $plannedStops[] = $this->createItineraryStop($trip->id, $userId, $place, $d, 2, '11:45', 45, 'AI Suggested snack spot');
                }
            }
            // Stop 3: Lunch Restaurant (12:45 PM)
            if (!empty($food)) {
                $place = array_shift($food);
                if ($isPreview) {
                    $plannedStops[] = $this->buildPreviewItineraryStop($place, $d, 3, '12:45', 90, 'AI Suggested Lunch Spot');
                } else {
                    $plannedStops[] = $this->createItineraryStop($trip->id, $userId, $place, $d, 3, '12:45', 90, 'AI Suggested lunch spot');
                }
            }
            // Stop 4: Attraction (15:00 PM)
            if (!empty($sights)) {
                $place = array_shift($sights);
                if ($isPreview) {
                    $plannedStops[] = $this->buildPreviewItineraryStop($place, $d, 4, '15:00', 120, 'AI Planned Attraction');
                } else {
                    $plannedStops[] = $this->createItineraryStop($trip->id, $userId, $place, $d, 4, '15:00', 120, 'AI Planned Stop based on Day 1 style');
                }
            }
            // Stop 5: Dinner Restaurant (18:30 PM)
            if (!empty($food)) {
                $place = array_shift($food);
                if ($isPreview) {
                    $plannedStops[] = $this->buildPreviewItineraryStop($place, $d, 5, '18:30', 120, 'AI Suggested Dinner Spot');
                } else {
                    $plannedStops[] = $this->createItineraryStop($trip->id, $userId, $place, $d, 5, '18:30', 120, 'AI Suggested dinner spot');
                }
            }
        }

        if ($isPreview) {
            return response()->json([
                'preview' => true,
                'stops' => $plannedStops
            ]);
        }

        // Recalculate schedule order and times
        $this->recalculateSchedule($trip);

        // Recalculate routes for all stops
        try {
            $this->calculateRoute($trip->id);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("AutoPlan route calculation skipped: " . $e->getMessage());
        }

        return response()->json([
            'message' => 'Successfully planned the remaining days of your trip!',
            'stops_added' => count($plannedStops)
        ]);
    }

    private function buildPreviewItineraryStop($place, $dayNumber, $order, $arrivalTime, $durationMinutes, $notes)
    {
        return [
            'id' => 'preview-' . $dayNumber . '-' . $order . '-' . $place['id'],
            'location' => [
                'id' => $place['id'],
                'name' => $place['name'],
                'address' => $place['address'] ?? $place['name'],
                'lat' => $place['lat'],
                'lng' => $place['lng'],
                'type' => $place['type'] ?? 'poi',
                'rating' => $place['rating'] ?? null,
                'photo_references' => $place['photo_references'] ?? [],
            ],
            'dayNumber' => $dayNumber,
            'day_number' => $dayNumber,
            'order' => $order,
            'arrivalTime' => $arrivalTime,
            'departureTime' => $arrivalTime, // simple mapping for preview display
            'duration_minutes' => $durationMinutes,
            'notes' => $notes,
            'weather_summary' => 'Sunny, 28°C',
            'weather_icon' => '01d',
        ];
    }

    private function createItineraryStop($tripId, $userId, $place, $dayNumber, $order, $arrivalTime, $durationMinutes, $notes)
    {
        $weatherSummary = 'Sunny, 28°C';
        $weatherIcon = '01d';
        try {
            $weatherData = $this->weatherService->getWeather($place['lat'], $place['lng']);
            $weatherSummary = $weatherData['summary'] ?? 'Sunny, 28°C';
            $weatherIcon = $weatherData['icon'] ?? '01d';
        } catch (\Exception $e) {
            // Ignore
        }

        return Itinerary::create([
            'trip_id' => $tripId,
            'user_id' => $userId,
            'place_id' => $place['id'],
            'place_name' => $place['name'],
            'place_address' => $place['address'] ?? $place['name'],
            'lat' => $place['lat'],
            'lng' => $place['lng'],
            'day_number' => $dayNumber,
            'order' => $order,
            'time' => $arrivalTime,
            'duration_minutes' => $durationMinutes,
            'notes' => $notes,
            'weather_summary' => $weatherSummary,
            'weather_icon' => $weatherIcon,
            'nearby_gas_stations' => json_encode([]),
        ]);
    }

    private function determineDuration(?string $category, string $name): int
    {
        $category = strtolower($category ?? 'unknown');
        $name = strtolower($name);

        if (str_contains($category, 'catering') || str_contains($category, 'restaurant') || str_contains($category, 'cafe') || str_contains($category, 'food') || str_contains($category, 'dining')) {
            return 90;
        }
        if (str_contains($category, 'tourism') || str_contains($category, 'attraction') || str_contains($category, 'museum') || str_contains($category, 'historic') || str_contains($category, 'monument') || str_contains($category, 'church') || str_contains($category, 'temple') || str_contains($category, 'place_of_worship')) {
            return 120;
        }
        if (str_contains($category, 'commercial') || str_contains($category, 'shop') || str_contains($category, 'mall') || str_contains($category, 'store')) {
            return 120;
        }
        if (str_contains($category, 'leisure') || str_contains($category, 'park') || str_contains($category, 'garden') || str_contains($category, 'beach') || str_contains($category, 'viewpoint') || str_contains($category, 'natural') || str_contains($category, 'forest')) {
            return 60;
        }
        if (str_contains($category, 'accommodation') || str_contains($category, 'hotel') || str_contains($category, 'motel') || str_contains($category, 'guest_house')) {
            return 60;
        }

        if (str_contains($name, 'restaurant') || str_contains($name, 'cafe') || str_contains($name, 'grill') || str_contains($name, 'bistro') || str_contains($name, 'kitchen') || str_contains($name, 'diner') || str_contains($name, 'fast food') || str_contains($name, 'coffee') || str_contains($name, 'starbucks') || str_contains($name, 'food')) {
            return 90;
        }
        if (str_contains($name, 'museum') || str_contains($name, 'gallery') || str_contains($name, 'cathedral') || str_contains($name, 'church') || str_contains($name, 'temple') || str_contains($name, 'castle') || str_contains($name, 'fort') || str_contains($name, 'monument') || str_contains($name, 'historic')) {
            return 120;
        }
        if (str_contains($name, 'mall') || str_contains($name, 'shop') || str_contains($name, 'market') || str_contains($name, 'store') || str_contains($name, 'center') || str_contains($name, 'plaza') || str_contains($name, 'supermarket')) {
            return 120;
        }
        if (str_contains($name, 'park') || str_contains($name, 'garden') || str_contains($name, 'beach') || str_contains($name, 'peak') || str_contains($name, 'viewpoint') || str_contains($name, 'falls') || str_contains($name, 'lake') || str_contains($name, 'mountain') || str_contains($name, 'forest')) {
            return 60;
        }
        if (str_contains($name, 'hotel') || str_contains($name, 'resort') || str_contains($name, 'inn') || str_contains($name, 'stay') || str_contains($name, 'villa') || str_contains($name, 'hostel')) {
            return 60;
        }

        return 60;
    }

    private function recalculateSchedule(Trip $trip): void
    {
        $itineraries = $trip->itineraries()->orderBy('day_number')->orderBy('order')->get();
        if ($itineraries->isEmpty()) {
            return;
        }

        $first = $itineraries->first();
        if (empty($first->time)) {
            $first->update(['time' => '08:00']);
        }

        foreach ($itineraries as $index => $itinerary) {
            if ($index === 0) {
                continue;
            }

            $prev = $itineraries[$index - 1];
            $prevDuration = $prev->duration_minutes ?? 60;
            
            try {
                $prevArrival = \Carbon\Carbon::parse($prev->time);
            } catch (\Exception $e) {
                $prevArrival = \Carbon\Carbon::parse('08:00');
            }
            
            $prevDeparture = $prevArrival->copy()->addMinutes($prevDuration);
            $driveTime = intval($itinerary->drive_time_from_previous ?? 0);
            $arrival = $prevDeparture->copy()->addMinutes($driveTime);

            $itinerary->update(['time' => $arrival->format('H:i')]);
        }
    }
}
