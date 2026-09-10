<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RouteService
{
    protected $osrmBaseUrl = 'https://router.project-osrm.org';

    /**
     * Calculate route for multiple waypoints
     * @param array $waypoints Array of [lat, lng] arrays
     * @param string $mode 'car', 'bike', 'walk', etc.
     * @param bool $alternatives Whether to request alternative routes from OSRM
     */
    public function calculateRoute($waypoints, $mode = 'car', $alternatives = true, $originName = 'Your Starting Location', $destName = 'Destination')
    {
        if (count($waypoints) < 2) return null;

        if ($mode === 'transit') {
            $googleTransit = $this->calculateGoogleTransitRoute($waypoints);
            if ($googleTransit !== null) {
                return $googleTransit;
            }

            $transitRoute = $this->calculateGeoapifyRoute($waypoints, 'transit');
            if ($transitRoute !== null) {
                return $transitRoute;
            }

            Log::info("Generating provincial public commute route fallback");
            return $this->generateProvincialTransitFallbackRoute($waypoints, $originName, $destName);
        }

        $profile = match($mode) {
            'bicycle', 'bike' => 'cycling',
            'walk', 'foot' => 'foot',
            default => 'driving'
        };

        // 2. Format Coordinates: "lng,lat;lng,lat;..."
        $coordString = implode(';', array_map(fn($wp) => "{$wp[1]},{$wp[0]}", $waypoints));
        
        $url = "{$this->osrmBaseUrl}/route/v1/{$profile}/{$coordString}";

        try {
            $response = Http::get($url, [
                'overview' => 'full',
                'geometries' => 'geojson',
                'steps' => 'true',
                'annotations' => 'true',
                'alternatives' => $alternatives ? 'true' : 'false'
            ]);

            if ($response->failed() || !isset($response['routes'][0])) {
                Log::warning("OSRM Route Failed: " . $response->body());
                return $this->handleOsrmFailure($waypoints, $mode);
            }

            $data = $response->json();

            // OSRM public demo server defaults all profiles to 'driving' speed/duration.
            // We override the duration dynamically based on the requested travel mode
            // to ensure accurate travel times are returned to the frontend.
            if (isset($data['routes'])) {
                foreach ($data['routes'] as &$r) {
                    $distance = $r['distance'] ?? 0; // in meters
                    
                    // Choose realistic speed divisor (meters per second)
                    $speed = null;
                    if ($mode === 'walk' || $mode === 'foot') {
                        $speed = 1.39; // Walking speed (~5 km/h)
                    } elseif ($mode === 'bicycle' || $mode === 'bike') {
                        $speed = 4.44; // Cycling speed (~16 km/h)
                    } elseif ($mode === 'transit') {
                        $speed = 6.11; // Transit speed (~22 km/h)
                    }
                    
                    if ($speed !== null) {
                        $r['duration'] = $distance / $speed;
                        if (isset($r['legs'])) {
                            foreach ($r['legs'] as &$leg) {
                                $legDistance = $leg['distance'] ?? $distance;
                                $leg['duration'] = $legDistance / $speed;
                                if (isset($leg['steps'])) {
                                    foreach ($leg['steps'] as &$step) {
                                        $stepDistance = $step['distance'] ?? 0;
                                        $step['duration'] = $stepDistance / $speed;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Fetch Toll-Free Alternative from Geoapify if mode is car
            if ($mode === 'car' && $alternatives) {
                $tollFreeRoute = $this->calculateGeoapifyRoute($waypoints, 'drive', 'tolls');
                if ($tollFreeRoute && isset($tollFreeRoute['routes'][0])) {
                    // Tag it so the frontend knows it's the toll-free alternative
                    $tollFree = $tollFreeRoute['routes'][0];
                    $tollFree['is_toll_free'] = true;
                    // Prepend or append to alternatives (OSRM routes[0] is primary)
                    if (isset($data['routes'])) {
                        $data['routes'][] = $tollFree;
                    } else {
                        $data['routes'] = [$tollFree];
                    }
                }
            }

            return $data;

        } catch (\Exception $e) {
            Log::error("Route Calculation Exception: " . $e->getMessage());
            return $this->handleOsrmFailure($waypoints, $mode);
        }
    }

    protected function handleOsrmFailure($waypoints, $mode) {
        $geoapifyMode = match($mode) {
            'bicycle', 'bike' => 'bicycle',
            'walk', 'foot' => 'walk',
            default => 'drive'
        };
        $fallback = $this->calculateGeoapifyRoute($waypoints, $geoapifyMode);
        if ($fallback && isset($fallback['routes'][0])) {
            return $fallback;
        }

        // Ultimate fallback: straight line
        return $this->generateFallbackStraightLine($waypoints, $mode);
    }

    protected function generateFallbackStraightLine($waypoints, $mode) {
        $distance = 0;
        for ($i = 0; $i < count($waypoints) - 1; $i++) {
            $distance += $this->haversineDistance($waypoints[$i], $waypoints[$i+1]);
        }
        $speed = match($mode) {
            'walk', 'foot' => 1.39,
            'bicycle', 'bike' => 4.44,
            'transit' => 6.11,
            default => 13.89
        };
        $duration = $distance / $speed;
        $coords = array_map(fn($w) => [$w[1], $w[0]], $waypoints);

        return [
            'routes' => [[
                'distance' => $distance,
                'duration' => $duration,
                'geometry' => [
                    'type' => 'LineString',
                    'coordinates' => $coords
                ],
                'legs' => [[
                    'distance' => $distance,
                    'duration' => $duration,
                    'steps' => [
                        [
                            'distance' => $distance,
                            'duration' => $duration,
                            'maneuver' => [
                                'type' => 'depart',
                                'location' => [$waypoints[0][1], $waypoints[0][0]]
                            ],
                            'name' => 'Straight line fallback'
                        ],
                        [
                            'distance' => 0,
                            'duration' => 0,
                            'maneuver' => [
                                'type' => 'arrive',
                                'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]
                            ],
                            'name' => ''
                        ]
                    ]
                ]]
            ]]
        ];
    }

    protected function haversineDistance($a, $b) {
        $R = 6371000;
        $dLat = deg2rad($b[0] - $a[0]);
        $dLon = deg2rad($b[1] - $a[1]);
        $x = sin($dLat/2) * sin($dLat/2) + cos(deg2rad($a[0])) * cos(deg2rad($b[0])) * sin($dLon/2) * sin($dLon/2);
        return 2 * $R * asin(sqrt($x));
    }

    /**
     * Fetch and format route from Geoapify to match OSRM structure.
     */
    protected function calculateGeoapifyRoute($waypoints, $mode = 'transit', $avoid = null)
    {
        $apiKey = env('GEOAPIFY_KEY');
        if (!$apiKey) {
            Log::error("GEOAPIFY_KEY is missing from environment variables.");
            return null;
        }

        $coordString = implode('|', array_map(fn($wp) => "{$wp[0]},{$wp[1]}", $waypoints));
        $url = "https://api.geoapify.com/v1/routing?waypoints={$coordString}&mode={$mode}&apiKey={$apiKey}";
        
        if ($avoid) {
            $url .= "&avoid={$avoid}";
        }

        try {
            $response = Http::get($url);

            if ($response->failed() || !isset($response['features'][0])) {
                Log::warning("Geoapify Transit Failed: " . $response->body());
                return null;
            }

            $feature = $response['features'][0];
            $props = $feature['properties'];
            $distance = $props['distance'] ?? 0;
            $duration = $props['time'] ?? 0;

            // Extract flat coordinates
            $flatCoords = [];
            if (isset($feature['geometry']['type']) && $feature['geometry']['type'] === 'MultiLineString') {
                foreach ($feature['geometry']['coordinates'] as $line) {
                    foreach ($line as $pt) {
                        $flatCoords[] = $pt;
                    }
                }
            } else {
                $flatCoords = $feature['geometry']['coordinates'] ?? [];
            }

            // Map Geoapify steps to OSRM format
            $osrmSteps = [];
            if (isset($props['legs'])) {
                foreach ($props['legs'] as $leg) {
                    if (isset($leg['steps'])) {
                        foreach ($leg['steps'] as $step) {
                            $fromIdx = $step['from_index'] ?? 0;
                            // Geoapify returns [lng, lat], just like OSRM GeoJSON geometry
                            $location = $flatCoords[$fromIdx] ?? [0, 0];
                            
                            $osrmSteps[] = [
                                'distance' => $step['distance'] ?? 0,
                                'duration' => $step['time'] ?? 0,
                                'name' => $step['instruction']['text'] ?? '',
                                'maneuver' => [
                                    'type' => 'turn',
                                    'modifier' => '',
                                    'location' => $location
                                ]
                            ];
                        }
                    }
                }
            }

            // Return mock OSRM format
            return [
                'routes' => [
                    [
                        'distance' => $distance,
                        'duration' => $duration,
                        'geometry' => [
                            'coordinates' => $flatCoords
                        ],
                        'legs' => [
                            [
                                'distance' => $distance,
                                'duration' => $duration,
                                'steps' => $osrmSteps
                            ]
                        ]
                    ]
                ]
            ];

        } catch (\Exception $e) {
            Log::error("Geoapify Route Exception: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Get alternative routes (Used for "Calculate Route" feature)
     */
    public function getRouteAlternatives($waypoints)
    {
        $route = $this->calculateRoute($waypoints, 'car', true);
        return $route ? $route['routes'] : [];
    }

    /**
     * Extract Speed Limits from Route Data
     */
    public function getSpeedLimits($routeData)
    {
        // OSRM annotations for maxspeed are complex. 
        // We will simulate a simplified list based on steps for the UI.
        
        $limits = [];
        $steps = $routeData['legs'][0]['steps'] ?? [];

        foreach ($steps as $step) {
            $name = $step['name'] ?? 'Unknown Road';
            if (empty($name)) continue;

            // Simple heuristic since free OSRM rarely returns maxspeed data
            // Highway/Way/Ave usually faster
            $speed = 40;
            if (stripos($name, 'Highway') !== false || stripos($name, 'Expressway') !== false) $speed = 80;
            elseif (stripos($name, 'Avenue') !== false || stripos($name, 'Road') !== false) $speed = 60;

            // De-duplicate
            if (!isset($limits[$name])) {
                $limits[$name] = [
                    'name' => $name,
                    'max_speed' => $speed
                ];
            }
        }

        return array_values($limits);
    }

    /**
     * Calculate transit route via Google Maps Transit API (RapidAPI or Direct Key)
     */
    protected function calculateGoogleTransitRoute($waypoints)
    {
        $rapidApiKey = env('RAPIDAPI_KEY');
        $googleKey = env('GOOGLE_MAPS_API_KEY', env('GOOGLE_API_KEY'));

        if (count($waypoints) < 2) return null;

        $origin = "{$waypoints[0][0]},{$waypoints[0][1]}";
        $dest = "{$waypoints[count($waypoints) - 1][0]},{$waypoints[count($waypoints) - 1][1]}";

        $responseData = null;

        // 1. Try RapidAPI Google Directions host if RAPIDAPI_KEY exists
        if ($rapidApiKey) {
            try {
                $res = Http::withHeaders([
                    'x-rapidapi-host' => 'google-maps-geocoding-direction-places.p.rapidapi.com',
                    'x-rapidapi-key' => $rapidApiKey,
                ])->get('https://google-maps-geocoding-direction-places.p.rapidapi.com/directions/json', [
                    'origin' => $origin,
                    'destination' => $dest,
                    'mode' => 'transit',
                ]);

                if ($res->successful() && isset($res['routes'][0])) {
                    $responseData = $res->json();
                }
            } catch (\Exception $e) {
                Log::warning("RapidAPI Google Transit Exception: " . $e->getMessage());
            }
        }

        // 2. Try direct Google Maps API if key exists
        if (!$responseData && $googleKey) {
            try {
                $res = Http::get('https://maps.googleapis.com/maps/api/directions/json', [
                    'origin' => $origin,
                    'destination' => $dest,
                    'mode' => 'transit',
                    'key' => $googleKey,
                ]);

                if ($res->successful() && isset($res['routes'][0])) {
                    $responseData = $res->json();
                }
            } catch (\Exception $e) {
                Log::warning("Direct Google Transit Exception: " . $e->getMessage());
            }
        }

        if (!$responseData || !isset($responseData['routes'][0])) {
            return null;
        }

        return $this->formatGoogleTransitResponse($responseData);
    }

    /**
     * Generate structured provincial public commute fallback when GTFS feeds return ZERO_RESULTS
     */
    protected function generateProvincialTransitFallbackRoute($waypoints, $originName = 'Your Starting Location', $destName = 'Destination')
    {
        $coordString = implode(';', array_map(fn($wp) => "{$wp[1]},{$wp[0]}", $waypoints));
        // Get full driving step-by-step route from OSRM to extract actual road names & coordinates
        $url = "{$this->osrmBaseUrl}/route/v1/driving/{$coordString}?overview=full&geometries=geojson&steps=true";

        $flatCoords = [];
        $distance = 0;
        $duration = 0;
        $osrmSteps = [];

        try {
            $res = Http::get($url);
            if ($res->successful() && isset($res['routes'][0])) {
                $r = $res['routes'][0];
                $distance = $r['distance'] ?? 0;
                $duration = $distance / 6.11; // ~22 km/h average public transport speed
                $flatCoords = $r['geometry']['coordinates'] ?? [];
                $osrmSteps = $r['legs'][0]['steps'] ?? [];
            }
        } catch (\Exception $e) {
            Log::warning("OSRM Transit Polyline Failed: " . $e->getMessage());
        }

        if (empty($flatCoords)) {
            $flatCoords = array_map(fn($w) => [$w[1], $w[0]], $waypoints);
            for ($i = 0; $i < count($waypoints) - 1; $i++) {
                $distance += $this->haversineDistance($waypoints[$i], $waypoints[$i+1]);
            }
            $duration = $distance / 6.11;
        }

        // Extract real road names & first/last leg distances from OSRM steps
        $roadNames = [];
        foreach ($osrmSteps as $step) {
            $rName = trim($step['name'] ?? '');
            if (!empty($rName) && !in_array($rName, $roadNames)) {
                $roadNames[] = $rName;
            }
        }

        $firstStepDist = $osrmSteps[0]['distance'] ?? 0;
        $lastStepDist = count($osrmSteps) > 1 ? ($osrmSteps[count($osrmSteps) - 1]['distance'] ?? 0) : 0;

        $distKm = round($distance / 1000, 1);
        $primaryRoad = $roadNames[0] ?? 'Main Highway';
        $secRoad = $roadNames[1] ?? ($roadNames[0] ?? 'Town Road');
        $tertiaryRoad = $roadNames[2] ?? ($roadNames[1] ?? 'Local Street');

        // Dynamic First Leg: Walk if near main road (<500m), Ride tricycle/jeepney if far (>=500m)
        $isNearOriginHighway = $firstStepDist < 500;
        $firstLegType = $isNearOriginHighway ? 'walk' : 'tricycle';
        $firstLegTitle = $isNearOriginHighway ? "Walk to {$primaryRoad}" : "Local Tricycle / Jeepney to {$primaryRoad}";
        $firstLegInstr = $isNearOriginHighway 
            ? "Walk from {$originName} to nearest loading stop along {$primaryRoad} (~5 mins)"
            : "Board local tricycle or jeepney from {$originName} to {$primaryRoad} highway loading area (~8 mins)";
        $firstLegCost = $isNearOriginHighway ? 0 : 25;
        $firstLegMins = $isNearOriginHighway ? 5 : 8;

        // Dynamic Final Leg: Walk if near highway (<400m), Ride tricycle if far (>=400m)
        $isNearDestHighway = $lastStepDist < 400;
        $finalLegType = $isNearDestHighway ? 'walk' : 'tricycle';
        $finalLegTitle = $isNearDestHighway ? "Walk to {$destName}" : "Local Tricycle to {$destName}";
        $finalLegInstr = $isNearDestHighway
            ? "Alight at drop-off point along {$secRoad} and walk to {$destName} entrance (~2 mins)"
            : "Hire local tricycle from {$secRoad} drop-off point to entrance of {$destName} (~5 mins)";
        $finalLegCost = $isNearDestHighway ? 0 : 25;
        $finalLegMins = $isNearDestHighway ? 2 : 5;

        // Dynamic multi-legged segmentation based on actual distance:
        $transitSegments = [];
        $steps = [];

        if ($distKm < 1.5) {
            // Category 1: Walking Commute (< 1.5 km) -> 1 leg
            $totalMins = max(5, (int)round($distance / 80)); // walking ~4.8 km/h
            $transitSegments = [
                [
                    'id' => 'walk_seg_1',
                    'type' => 'walk',
                    'title' => "Walk to {$destName}",
                    'departureName' => $originName,
                    'arrivalName' => $destName,
                    'durationMinutes' => $totalMins,
                    'costEstimate' => 0,
                    'instructions' => "Walk directly from {$originName} to {$destName} (~{$distKm} km, ~{$totalMins} mins)",
                ]
            ];
            $steps = [
                [
                    'distance' => round($distance),
                    'duration' => $totalMins * 60,
                    'name' => "1. Walk from {$originName} directly to {$destName} (~{$distKm} km, ~{$totalMins} mins)",
                    'maneuver' => ['type' => 'transit', 'modifier' => '', 'location' => [$waypoints[0][1], $waypoints[0][0]]],
                ],
                [
                    'distance' => 0,
                    'duration' => 0,
                    'name' => "2. Arrive at {$destName}",
                    'maneuver' => ['type' => 'arrive', 'modifier' => '', 'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]],
                ]
            ];
        } elseif ($distKm < 8) {
            // Category 2: Local City Commute (1.5 km to 8 km)
            $totalMins = max(10, (int)round($distance / 250));
            $leg2Mins = max(5, (int)round($totalMins * 0.7));

            $transitSegments = [
                [
                    'id' => 'local_seg_1',
                    'type' => $firstLegType,
                    'title' => $firstLegTitle,
                    'departureName' => $originName,
                    'arrivalName' => "{$primaryRoad} Loading Stop",
                    'durationMinutes' => $firstLegMins,
                    'costEstimate' => $firstLegCost,
                    'instructions' => $firstLegInstr,
                ],
                [
                    'id' => 'local_seg_2',
                    'type' => 'jeepney',
                    'title' => "City Jeepney via {$primaryRoad} to {$destName}",
                    'departureName' => "{$primaryRoad} Loading Stop",
                    'arrivalName' => "Drop-off near {$destName}",
                    'durationMinutes' => $leg2Mins,
                    'costEstimate' => 15,
                    'instructions' => "Board city jeepney or multicab along {$primaryRoad} heading towards {$destName} (~{$distKm} km, ~{$leg2Mins} mins)",
                ]
            ];

            if ($isNearDestHighway) {
                $transitSegments[] = [
                    'id' => 'local_seg_3',
                    'type' => 'walk',
                    'title' => "Walk to Entrance of {$destName}",
                    'departureName' => 'Drop-off point',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Alight at drop-off point and walk to main entrance of {$destName} (~2 mins)",
                ];
            } else {
                $transitSegments[] = [
                    'id' => 'local_seg_3',
                    'type' => 'tricycle',
                    'title' => "Local Tricycle to Gate of {$destName}",
                    'departureName' => 'Drop-off point',
                    'arrivalName' => "Gate of {$destName}",
                    'durationMinutes' => 5,
                    'costEstimate' => 25,
                    'instructions' => "Hire local tricycle from drop-off point to gate of {$destName} (~5 mins)",
                ];
                $transitSegments[] = [
                    'id' => 'local_seg_4',
                    'type' => 'walk',
                    'title' => "Walk to Main Entrance",
                    'departureName' => 'Gate',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Walk from gate to main entrance of {$destName} (~2 mins)",
                ];
            }

            $steps = array_map(function($seg, $idx) use ($waypoints) {
                return [
                    'distance' => 100,
                    'duration' => $seg['durationMinutes'] * 60,
                    'name' => ($idx + 1) . ". " . $seg['instructions'],
                    'maneuver' => ['type' => 'transit', 'modifier' => '', 'location' => [$waypoints[0][1], $waypoints[0][0]]],
                ];
            }, $transitSegments, array_keys($transitSegments));

            $steps[] = [
                'distance' => 0,
                'duration' => 0,
                'name' => (count($steps) + 1) . ". Arrive at {$destName}",
                'maneuver' => ['type' => 'arrive', 'modifier' => '', 'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]],
            ];
        } elseif ($distKm < 25) {
            // Category 3: Medium Inter-Town Commute (8 km to 25 km)
            $totalMins = max(20, (int)round($duration / 60));
            $leg2Mins = max(12, (int)round($totalMins * 0.55));
            $leg3Mins = max(8, (int)round($totalMins * 0.3));

            $midDist = round($distKm * 0.6, 1);
            $lastDist = round($distKm * 0.4, 1);

            $transitSegments = [
                [
                    'id' => 'inter_seg_1',
                    'type' => $firstLegType,
                    'title' => $firstLegTitle,
                    'departureName' => $originName,
                    'arrivalName' => "{$primaryRoad} Highway Terminal",
                    'durationMinutes' => $firstLegMins,
                    'costEstimate' => $firstLegCost,
                    'instructions' => $firstLegInstr,
                ],
                [
                    'id' => 'inter_seg_2',
                    'type' => 'bus',
                    'title' => "Inter-Town Bus / Jeepney via {$primaryRoad} (~{$midDist} km)",
                    'departureName' => "{$primaryRoad} Terminal",
                    'arrivalName' => "{$secRoad} Junction",
                    'durationMinutes' => $leg2Mins,
                    'costEstimate' => (int)round($midDist * 2.5),
                    'instructions' => "Board inter-town bus or jeepney along {$primaryRoad} to {$secRoad} junction (~{$midDist} km, ~{$leg2Mins} mins)",
                ],
                [
                    'id' => 'inter_seg_3',
                    'type' => 'jeepney',
                    'title' => "Connecting Feeder Jeepney via {$secRoad} (~{$lastDist} km)",
                    'departureName' => "{$secRoad} Junction",
                    'arrivalName' => "Drop-off near {$destName}",
                    'durationMinutes' => $leg3Mins,
                    'costEstimate' => 20,
                    'instructions' => "Transfer to feeder jeepney along {$secRoad} heading towards {$destName} (~{$lastDist} km, ~{$leg3Mins} mins)",
                ]
            ];

            if ($isNearDestHighway) {
                $transitSegments[] = [
                    'id' => 'inter_seg_4',
                    'type' => 'walk',
                    'title' => "Walk to Entrance of {$destName}",
                    'departureName' => 'Drop-off point',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Alight at drop-off point and walk to main entrance of {$destName} (~2 mins)",
                ];
            } else {
                $transitSegments[] = [
                    'id' => 'inter_seg_4',
                    'type' => 'tricycle',
                    'title' => "Local Tricycle to Gate of {$destName}",
                    'departureName' => 'Feeder Drop-off',
                    'arrivalName' => "Gate of {$destName}",
                    'durationMinutes' => 5,
                    'costEstimate' => 20,
                    'instructions' => "Hire local tricycle from drop-off point to gate of {$destName} (~5 mins)",
                ];
                $transitSegments[] = [
                    'id' => 'inter_seg_5',
                    'type' => 'walk',
                    'title' => "Walk to Main Entrance",
                    'departureName' => 'Gate',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Walk from gate to main entrance of {$destName} (~2 mins)",
                ];
            }

            $steps = array_map(function($seg, $idx) use ($waypoints) {
                return [
                    'distance' => 100,
                    'duration' => $seg['durationMinutes'] * 60,
                    'name' => ($idx + 1) . ". " . $seg['instructions'],
                    'maneuver' => ['type' => 'transit', 'modifier' => '', 'location' => [$waypoints[0][1], $waypoints[0][0]]],
                ];
            }, $transitSegments, array_keys($transitSegments));

            $steps[] = [
                'distance' => 0,
                'duration' => 0,
                'name' => (count($steps) + 1) . ". Arrive at {$destName}",
                'maneuver' => ['type' => 'arrive', 'modifier' => '', 'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]],
            ];
        } elseif ($distKm < 70) {
            // Category 4: Regional Provincial Commute (25 km to 70 km, e.g. Domanpot 60.1 km)
            $totalMins = max(30, (int)round($duration / 60));
            $leg2Mins = max(20, (int)round($totalMins * 0.65));
            $leg3Mins = max(12, (int)round($totalMins * 0.25));

            $busDist = round($distKm * 0.75, 1);
            $secDist = round($distKm * 0.2, 1);

            $transitSegments = [
                [
                    'id' => 'reg_seg_1',
                    'type' => $firstLegType,
                    'title' => $firstLegTitle,
                    'departureName' => $originName,
                    'arrivalName' => "{$primaryRoad} Highway Terminal",
                    'durationMinutes' => $firstLegMins,
                    'costEstimate' => $firstLegCost,
                    'instructions' => $firstLegInstr,
                ],
                [
                    'id' => 'reg_seg_2',
                    'type' => 'bus',
                    'title' => "Regional Express Bus via {$primaryRoad} (~{$busDist} km)",
                    'departureName' => "{$primaryRoad} Terminal",
                    'arrivalName' => "Interchange Junction ({$secRoad})",
                    'durationMinutes' => $leg2Mins,
                    'costEstimate' => (int)round($busDist * 2.2),
                    'instructions' => "Board regional express bus via {$primaryRoad} to {$secRoad} interchange junction (~{$busDist} km, ~" . round($leg2Mins / 60, 1) . " hrs)",
                ],
                [
                    'id' => 'reg_seg_3',
                    'type' => 'jeepney',
                    'title' => "Inter-Town Jeepney along {$secRoad} (~{$secDist} km)",
                    'departureName' => "{$secRoad} Junction",
                    'arrivalName' => "Drop-off near {$destName}",
                    'durationMinutes' => $leg3Mins,
                    'costEstimate' => 35,
                    'instructions' => "Transfer to inter-town jeepney along {$secRoad} heading towards town proper near {$destName} (~{$secDist} km, ~{$leg3Mins} mins)",
                ]
            ];

            if ($isNearDestHighway) {
                $transitSegments[] = [
                    'id' => 'reg_seg_4',
                    'type' => 'walk',
                    'title' => "Walk to Entrance of {$destName}",
                    'departureName' => 'Drop-off point',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Alight at drop-off point and walk to main entrance of {$destName} (~2 mins)",
                ];
            } else {
                $transitSegments[] = [
                    'id' => 'reg_seg_4',
                    'type' => 'tricycle',
                    'title' => "Local Town Tricycle to Gate of {$destName}",
                    'departureName' => 'Drop-off Point',
                    'arrivalName' => "Gate of {$destName}",
                    'durationMinutes' => 5,
                    'costEstimate' => 25,
                    'instructions' => "Hire local town tricycle from drop-off point to gate of {$destName} (~5 mins)",
                ];
                $transitSegments[] = [
                    'id' => 'reg_seg_5',
                    'type' => 'walk',
                    'title' => "Walk to Main Entrance of {$destName}",
                    'departureName' => 'Gate',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Alight at gate and walk to main entrance of {$destName} (~2 mins)",
                ];
            }

            $steps = array_map(function($seg, $idx) use ($waypoints) {
                return [
                    'distance' => 100,
                    'duration' => $seg['durationMinutes'] * 60,
                    'name' => ($idx + 1) . ". " . $seg['instructions'],
                    'maneuver' => ['type' => 'transit', 'modifier' => '', 'location' => [$waypoints[0][1], $waypoints[0][0]]],
                ];
            }, $transitSegments, array_keys($transitSegments));

            $steps[] = [
                'distance' => 0,
                'duration' => 0,
                'name' => (count($steps) + 1) . ". Arrive at {$destName}",
                'maneuver' => ['type' => 'arrive', 'modifier' => '', 'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]],
            ];
        } else {
            // Category 5: Very Long Provincial Commute (> 70 km)
            $totalMins = max(45, (int)round($duration / 60));
            $leg2Mins = max(30, (int)round($totalMins * 0.6));
            $leg3Mins = max(15, (int)round($totalMins * 0.25));
            $leg4Mins = max(10, (int)round($totalMins * 0.1));

            $leg2Km = round($distKm * 0.65, 1);
            $leg3Km = round($distKm * 0.25, 1);
            $leg4Km = round($distKm * 0.08, 1);

            $transitSegments = [
                [
                    'id' => 'vlong_seg_1',
                    'type' => $firstLegType,
                    'title' => $firstLegTitle,
                    'departureName' => $originName,
                    'arrivalName' => "{$primaryRoad} Central Terminal",
                    'durationMinutes' => $firstLegMins,
                    'costEstimate' => $firstLegCost,
                    'instructions' => $firstLegInstr,
                ],
                [
                    'id' => 'vlong_seg_2',
                    'type' => 'bus',
                    'title' => "Regional Express Bus via {$primaryRoad} (~{$leg2Km} km)",
                    'departureName' => "{$primaryRoad} Central Terminal",
                    'arrivalName' => 'Regional Interchange Terminal',
                    'durationMinutes' => $leg2Mins,
                    'costEstimate' => (int)round($leg2Km * 2.2),
                    'instructions' => "Board regional express bus via {$primaryRoad} to regional interchange terminal (~{$leg2Km} km, ~" . round($leg2Mins / 60, 1) . " hrs)",
                ],
                [
                    'id' => 'vlong_seg_3',
                    'type' => 'bus',
                    'title' => "Provincial Feeder Bus / UV Express (~{$leg3Km} km)",
                    'departureName' => 'Interchange Terminal',
                    'arrivalName' => "District Terminal ({$secRoad})",
                    'durationMinutes' => $leg3Mins,
                    'costEstimate' => 65,
                    'instructions' => "Transfer to provincial feeder bus or UV Express along {$secRoad} to district terminal (~{$leg3Km} km, ~{$leg3Mins} mins)",
                ],
                [
                    'id' => 'vlong_seg_4',
                    'type' => 'jeepney',
                    'title' => "Local Town Jeepney via {$tertiaryRoad} (~{$leg4Km} km)",
                    'departureName' => 'District Terminal',
                    'arrivalName' => "Town Proper Junction near {$destName}",
                    'durationMinutes' => $leg4Mins,
                    'costEstimate' => 25,
                    'instructions' => "Board local town jeepney via {$tertiaryRoad} towards {$destName} sector (~{$leg4Km} km, ~{$leg4Mins} mins)",
                ]
            ];

            if ($isNearDestHighway) {
                $transitSegments[] = [
                    'id' => 'vlong_seg_5',
                    'type' => 'walk',
                    'title' => "Walk to Entrance of {$destName}",
                    'departureName' => 'Town Proper Junction',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Alight at town proper junction and walk to main entrance of {$destName} (~2 mins)",
                ];
            } else {
                $transitSegments[] = [
                    'id' => 'vlong_seg_5',
                    'type' => 'tricycle',
                    'title' => "Special Tricycle Ride to Gate of {$destName}",
                    'departureName' => 'Town Proper Junction',
                    'arrivalName' => "Gate of {$destName}",
                    'durationMinutes' => 5,
                    'costEstimate' => 30,
                    'instructions' => "Hire local tricycle from town proper junction directly to {$destName} gate (~5 mins)",
                ];
                $transitSegments[] = [
                    'id' => 'vlong_seg_6',
                    'type' => 'walk',
                    'title' => "Walk to Main Entrance of {$destName}",
                    'departureName' => 'Gate',
                    'arrivalName' => $destName,
                    'durationMinutes' => 2,
                    'costEstimate' => 0,
                    'instructions' => "Walk from gate to main entrance of {$destName} (~2 mins)",
                ];
            }

            $steps = array_map(function($seg, $idx) use ($waypoints) {
                return [
                    'distance' => 100,
                    'duration' => $seg['durationMinutes'] * 60,
                    'name' => ($idx + 1) . ". " . $seg['instructions'],
                    'maneuver' => ['type' => 'transit', 'modifier' => '', 'location' => [$waypoints[0][1], $waypoints[0][0]]],
                ];
            }, $transitSegments, array_keys($transitSegments));

            $steps[] = [
                'distance' => 0,
                'duration' => 0,
                'name' => (count($steps) + 1) . ". Arrive at {$destName}",
                'maneuver' => ['type' => 'arrive', 'modifier' => '', 'location' => [$waypoints[count($waypoints)-1][1], $waypoints[count($waypoints)-1][0]]],
            ];
        }

        return [
            'routes' => [[
                'distance' => $distance,
                'duration' => $duration,
                'is_transit' => true,
                'geometry' => [
                    'coordinates' => $flatCoords
                ],
                'legs' => [[
                    'distance' => $distance,
                    'duration' => $duration,
                    'steps' => $steps
                ]],
                'transit_segments' => $transitSegments
            ]]
        ];
    }

    /**
     * Format Google Directions Transit response into standard OSRM format + transit_segments
     */
    protected function formatGoogleTransitResponse($data)
    {
        $route = $data['routes'][0];
        $leg = $route['legs'][0] ?? [];
        $distance = $leg['distance']['value'] ?? 0;
        $duration = $leg['duration']['value'] ?? 0;

        $flatCoords = [];
        $steps = [];
        $transitSegments = [];

        if (isset($route['overview_polyline']['points'])) {
            $flatCoords = $this->decodeGooglePolyline($route['overview_polyline']['points']);
        }

        if (isset($leg['steps'])) {
            foreach ($leg['steps'] as $idx => $step) {
                $stepDist = $step['distance']['value'] ?? 0;
                $stepDur = $step['duration']['value'] ?? 0;
                $instruction = strip_tags($step['html_instructions'] ?? '');
                $travelMode = $step['travel_mode'] ?? 'WALKING';

                $stepLocation = [
                    $step['start_location']['lng'] ?? 0,
                    $step['start_location']['lat'] ?? 0,
                ];

                $steps[] = [
                    'distance' => $stepDist,
                    'duration' => $stepDur,
                    'name' => $instruction,
                    'maneuver' => [
                        'type' => strtolower($travelMode) === 'transit' ? 'transit' : 'turn',
                        'modifier' => '',
                        'location' => $stepLocation,
                    ],
                ];

                if ($travelMode === 'TRANSIT' && isset($step['transit_details'])) {
                    $td = $step['transit_details'];
                    $vehicleType = strtolower($td['line']['vehicle']['type'] ?? 'bus');
                    $mappedType = match ($vehicleType) {
                        'subway', 'heavy_rail', 'commuter_train', 'rail' => 'train',
                        'ferry' => 'ferry',
                        'tram', 'trolleybus' => 'bus',
                        default => 'bus',
                    };

                    $lineName = $td['line']['short_name'] ?? $td['line']['name'] ?? 'Transit Line';
                    $depStop = $td['departure_stop']['name'] ?? 'Departure Stop';
                    $arrStop = $td['arrival_stop']['name'] ?? 'Arrival Stop';
                    $numStops = $td['num_stops'] ?? 1;

                    $transitSegments[] = [
                        'id' => 'google_seg_' . $idx,
                        'type' => $mappedType,
                        'title' => "{$lineName}: {$depStop} → {$arrStop}",
                        'departureName' => $depStop,
                        'arrivalName' => $arrStop,
                        'durationMinutes' => round($stepDur / 60),
                        'distanceKm' => round($stepDist / 1000, 1),
                        'agency' => $td['line']['agencies'][0]['name'] ?? 'Public Transit',
                        'lineName' => $lineName,
                        'instructions' => "Board {$lineName} at {$depStop} ({$numStops} stops, ~" . round($stepDur / 60) . " mins)",
                    ];
                }
            }
        }

        return [
            'routes' => [
                [
                    'distance' => $distance,
                    'duration' => $duration,
                    'geometry' => [
                        'coordinates' => $flatCoords,
                    ],
                    'legs' => [
                        [
                            'distance' => $distance,
                            'duration' => $duration,
                            'steps' => $steps,
                        ],
                    ],
                    'transit_segments' => $transitSegments,
                ],
            ],
        ];
    }

    /**
     * Decode Google Maps Encoded Polyline algorithm into [lng, lat] coordinates
     */
    protected function decodeGooglePolyline(string $encoded): array
    {
        $length = strlen($encoded);
        $index = 0;
        $points = [];
        $lat = 0;
        $lng = 0;

        while ($index < $length) {
            $b = 0;
            $shift = 0;
            $result = 0;
            do {
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1f) << $shift;
                $shift += 5;
            } while ($b >= 0x20);
            $dlat = (($result & 1) ? ~($result >> 1) : ($result >> 1));
            $lat += $dlat;

            $shift = 0;
            $result = 0;
            do {
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1f) << $shift;
                $shift += 5;
            } while ($b >= 0x20);
            $dlng = (($result & 1) ? ~($result >> 1) : ($result >> 1));
            $lng += $dlng;

            $points[] = [$lng * 1e-5, $lat * 1e-5];
        }

        return $points;
    }
}
