<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PlaceService
{
    protected $geoapifyKey;
    protected $rapidApiKey;

    public function __construct()
    {
        $this->geoapifyKey = env('GEOAPIFY_KEY');
        $this->rapidApiKey = env('RAPIDAPI_KEY');
    }

    public function search($lat, $lng, $category = null, $query = null)
    {
        if (!empty($query) && strlen($query) > 1) {
            if ($this->rapidApiKey) {
                $results = $this->searchRapidApiText($lat, $lng, $query);
                if (!empty($results)) {
                    return $results;
                }
            }
            return $this->searchGeoapifyText($lat, $lng, $query);
        }
        if (!empty($category) && $category !== 'all') {
            return $this->searchGeoapifyCategory($lat, $lng, $category);
        }
        // Fallback to returning popular nearby places
        return $this->getPopular($lat, $lng);
    }

    public function getPopular($lat, $lng)
    {
        $places = $this->fetchFromRapidApi($lat, $lng, 'tourist_attraction', 'prominence');
        if (empty($places)) {
            Log::info("RapidAPI empty/failed, falling back to Geoapify for Popular");
            return $this->searchGeoapifyCategory($lat, $lng, 'attractions');
        }
        return $places;
    }

    public function getHighRated($lat, $lng)
    {
        $places = $this->fetchFromRapidApi($lat, $lng, 'restaurant', 'prominence');
        if (empty($places)) {
             return $this->searchGeoapifyCategory($lat, $lng, 'restaurant');
        }

        // Filter > 4.0
        $filtered = array_filter($places, fn($p) => ($p['rating'] ?? 0) >= 4.0);

        // FIX: array_values() converts sparse array back to a list
        return array_values($filtered); 
    }

    // --- INTERNAL HELPER METHODS ---

    private function fetchFromRapidApi($lat, $lng, $type, $rankby)
    {
        // Round lat and lng to 3 decimal places (~111 meters) to cache for nearby locations
        $cacheKey = "rapidapi_{$type}_" . round((float)$lat, 3) . "_" . round((float)$lng, 3);
        
        if (\Illuminate\Support\Facades\Cache::has($cacheKey)) {
            Log::info("Serving RapidAPI (v2) from cache for {$type} at {$lat},{$lng}");
            return \Illuminate\Support\Facades\Cache::get($cacheKey);
        }

        $url = 'https://google-map-places-new-v2.p.rapidapi.com/v1/places:searchNearby';
        
        try {
            Log::info("Trying RapidAPI (v2) for {$type} at {$lat},{$lng}");

            // Map old type format if needed or use directly
            $includedTypes = [];
            if ($type === 'tourist_attraction') {
                $includedTypes = ['tourist_attraction', 'historical_landmark', 'museum', 'park'];
            } else {
                $includedTypes = [$type];
            }

            $response = Http::withHeaders([
                'x-rapidapi-host' => 'google-map-places-new-v2.p.rapidapi.com',
                'x-rapidapi-key' => $this->rapidApiKey,
                'X-Goog-FieldMask' => 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.reviews,places.types,places.editorialSummary'
            ])->withoutVerifying()->post($url, [
                'includedTypes' => $includedTypes,
                'maxResultCount' => 20,
                'locationRestriction' => [
                    'circle' => [
                        'center' => [
                            'latitude' => (float) $lat,
                            'longitude' => (float) $lng
                        ],
                        'radius' => 5000.0
                    ]
                ]
            ]);

            if ($response->failed()) {
                Log::error("RapidAPI HTTP Error: " . $response->body());
                return [];
            }

            $places = $response->json()['places'] ?? [];
            
            $results = array_map(function ($place) use ($type) {
                // Safely access photos (up to 6)
                $photoReferences = [];
                if (isset($place['photos']) && is_array($place['photos'])) {
                    foreach (array_slice($place['photos'], 0, 6) as $photo) {
                        $photoReferences[] = $photo['name'];
                    }
                }
                
                // Map reviews
                $reviewsData = [];
                if (isset($place['reviews']) && is_array($place['reviews'])) {
                    foreach (array_slice($place['reviews'], 0, 5) as $rev) {
                        $reviewsData[] = [
                            'author' => $rev['authorAttribution']['displayName'] ?? 'Google User',
                            'avatar' => $rev['authorAttribution']['photoUri'] ?? '',
                            'rating' => $rev['rating'] ?? 0,
                            'text' => $rev['text']['text'] ?? '',
                            'timestamp' => $rev['publishTime'] ?? now()->toIso8601String(),
                            'source' => 'Google'
                        ];
                    }
                }
                
                // Infer type
                $inferredType = 'poi';
                $gTypes = $place['types'] ?? [];
                if (array_intersect($gTypes, ['restaurant', 'food', 'cafe', 'bar', 'eating_establishment'])) {
                    $inferredType = 'restaurant';
                } elseif (array_intersect($gTypes, ['hotel', 'accommodation', 'lodging', 'motel'])) {
                    $inferredType = 'hotel';
                } elseif (array_intersect($gTypes, ['gas_station'])) {
                    $inferredType = 'gas-station';
                } elseif (array_intersect($gTypes, ['tourist_attraction', 'museum', 'historical_landmark', 'park', 'landmark'])) {
                    $inferredType = 'landmark';
                }
                
                return [
                    'id' => $place['id'],
                    'name' => $place['displayName']['text'] ?? 'Unknown Place',
                    'lat' => $place['location']['latitude'],
                    'lng' => $place['location']['longitude'],
                    'address' => $place['formattedAddress'] ?? '',
                    'category' => 'google_place',
                    'type' => $inferredType,
                    'rating' => $place['rating'] ?? null,
                    'user_ratings_total' => $place['userRatingCount'] ?? 0,
                    'reviews' => $place['userRatingCount'] ?? 0,
                    'photo_reference' => $photoReferences[0] ?? null,
                    'photo_references' => $photoReferences,
                    'reviews_data' => $reviewsData,
                    'editorial_summary' => $place['editorialSummary']['text'] ?? null,
                    'source' => 'google'
                ];
            }, $places);

            // Cache for 24 hours
            \Illuminate\Support\Facades\Cache::put($cacheKey, $results, now()->addHours(24));
            
            return $results;
        } catch (\Exception $e) {
            Log::error("RapidAPI Exception: " . $e->getMessage());
            return [];
        }
    }

    private function searchGeoapifyCategory($lat, $lng, $category)
    {
        $categoryMap = [
            'restaurant' => 'catering',
            'hotel' => 'accommodation',
            'shopping' => 'commercial',
            'hospitals' => 'healthcare',
            'banks' => 'service.financial',
            'attractions' => 'tourism',
            'coffee' => 'catering.cafe',
            'gas' => 'commercial.gas',
            'gas-station' => 'commercial.gas',
            'landmark' => 'tourism',
            'viewpoint' => 'tourism.sights',
        ];

        $geoCategory = $categoryMap[strtolower($category)] ?? 'tourism';
        $url = "https://api.geoapify.com/v2/places?categories={$geoCategory}&filter=circle:{$lng},{$lat},10000&limit=20&apiKey={$this->geoapifyKey}";

        try {
            $response = Http::withoutVerifying()->get($url);
            if ($response->failed()) {
                Log::error("Geoapify Error: " . $response->body());
                return [];
            }
            return $this->formatGeoapify($response->json()['features'] ?? []);
        } catch (\Exception $e) {
            Log::error("Geoapify Exception: " . $e->getMessage());
            return [];
        }
    }

    private function searchGeoapifyText($lat, $lng, $query)
    {
        $url = "https://api.geoapify.com/v2/places?text=" . urlencode($query) . "&filter=circle:{$lng},{$lat},10000&limit=20&apiKey={$this->geoapifyKey}";
        
        try {
            $response = Http::withoutVerifying()->get($url);
            if ($response->failed()) return [];
            return $this->formatGeoapify($response->json()['features'] ?? []);
        } catch (\Exception $e) {
            return [];
        }
    }

    private function searchRapidApiText($lat, $lng, $query)
    {
        $cacheKey = "rapidapi_search_" . md5(strtolower($query)) . "_" . round((float)$lat, 3) . "_" . round((float)$lng, 3);
        
        if (\Illuminate\Support\Facades\Cache::has($cacheKey)) {
            Log::info("Serving RapidAPI (v2) text search from cache for query '{$query}'");
            return \Illuminate\Support\Facades\Cache::get($cacheKey);
        }

        $url = 'https://google-map-places-new-v2.p.rapidapi.com/v1/places:searchText';
        
        try {
            Log::info("Trying RapidAPI (v2) text search for query '{$query}'");
            
            $response = Http::withHeaders([
                'x-rapidapi-host' => 'google-map-places-new-v2.p.rapidapi.com',
                'x-rapidapi-key' => $this->rapidApiKey,
                'X-Goog-FieldMask' => 'places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.photos,places.reviews,places.types,places.editorialSummary'
            ])->withoutVerifying()->post($url, [
                'textQuery' => $query,
                'locationBias' => [
                    'circle' => [
                        'center' => [
                            'latitude' => (float) $lat,
                            'longitude' => (float) $lng
                        ],
                        'radius' => 5000.0
                    ]
                ]
            ]);

            if ($response->failed()) {
                Log::error("RapidAPI text search HTTP Error: " . $response->body());
                return [];
            }

            $places = $response->json()['places'] ?? [];
            
            $results = array_map(function ($place) {
                $photoReferences = [];
                if (isset($place['photos']) && is_array($place['photos'])) {
                    foreach (array_slice($place['photos'], 0, 6) as $photo) {
                        $photoReferences[] = $photo['name'];
                    }
                }
                
                $reviewsData = [];
                if (isset($place['reviews']) && is_array($place['reviews'])) {
                    foreach (array_slice($place['reviews'], 0, 5) as $rev) {
                        $reviewsData[] = [
                            'author' => $rev['authorAttribution']['displayName'] ?? 'Google User',
                            'avatar' => $rev['authorAttribution']['photoUri'] ?? '',
                            'rating' => $rev['rating'] ?? 0,
                            'text' => $rev['text']['text'] ?? '',
                            'timestamp' => $rev['publishTime'] ?? now()->toIso8601String(),
                            'source' => 'Google'
                        ];
                    }
                }
                
                // Infer type
                $inferredType = 'poi';
                $gTypes = $place['types'] ?? [];
                if (array_intersect($gTypes, ['restaurant', 'food', 'cafe', 'bar', 'eating_establishment'])) {
                    $inferredType = 'restaurant';
                } elseif (array_intersect($gTypes, ['hotel', 'accommodation', 'lodging', 'motel'])) {
                    $inferredType = 'hotel';
                } elseif (array_intersect($gTypes, ['gas_station'])) {
                    $inferredType = 'gas-station';
                } elseif (array_intersect($gTypes, ['tourist_attraction', 'museum', 'historical_landmark', 'park', 'landmark'])) {
                    $inferredType = 'landmark';
                }
                
                return [
                    'id' => $place['id'],
                    'name' => $place['displayName']['text'] ?? 'Unknown Place',
                    'lat' => $place['location']['latitude'],
                    'lng' => $place['location']['longitude'],
                    'address' => $place['formattedAddress'] ?? '',
                    'category' => 'google_place',
                    'type' => $inferredType,
                    'rating' => $place['rating'] ?? null,
                    'user_ratings_total' => $place['userRatingCount'] ?? 0,
                    'reviews' => $place['userRatingCount'] ?? 0,
                    'photo_reference' => $photoReferences[0] ?? null,
                    'photo_references' => $photoReferences,
                    'reviews_data' => $reviewsData,
                    'editorial_summary' => $place['editorialSummary']['text'] ?? null,
                    'source' => 'google'
                ];
            }, $places);

            \Illuminate\Support\Facades\Cache::put($cacheKey, $results, now()->addHours(24));
            
            return $results;
            
        } catch (\Exception $e) {
            Log::error("RapidAPI text search Exception: " . $e->getMessage());
            return [];
        }
    }

    private function formatGeoapify($features)
    {
        return array_map(function ($feature) {
            $props = $feature['properties'];
            $category = $props['categories'][0] ?? 'unknown';
            $type = 'poi';
            if (str_starts_with($category, 'accommodation')) $type = 'hotel';
            elseif (str_starts_with($category, 'catering')) $type = 'restaurant';
            elseif (str_starts_with($category, 'commercial.gas')) $type = 'gas-station';
            elseif (str_starts_with($category, 'tourism.sights')) $type = 'viewpoint';
            elseif (str_starts_with($category, 'tourism')) $type = 'landmark';
            
            return [
                'id' => $props['place_id'] ?? uniqid(),
                'name' => $props['name'] ?? 'Unnamed Place',
                'lat' => $feature['geometry']['coordinates'][1],
                'lng' => $feature['geometry']['coordinates'][0],
                'address' => $props['address_line2'] ?? $props['formatted'] ?? '',
                'category' => $category,
                'type' => $type,
                'rating' => null,
                'reviews' => 0,
                'photo_reference' => null,
                'source' => 'geoapify'
            ];
        }, $features);
    }

    public function reverseGeocode($lat, $lng)
    {
        $url = "https://api.geoapify.com/v1/geocode/reverse?lat={$lat}&lon={$lng}&apiKey={$this->geoapifyKey}";
        
        try {
            $response = Http::withoutVerifying()->get($url);
            if ($response->failed()) return "Unknown Location";
            
            $props = $response->json()['features'][0]['properties'] ?? [];
            
            // Return City, Country (e.g., "Manila, Philippines")
            $city = $props['city'] ?? $props['town'] ?? $props['village'] ?? 'Unknown';
            $country = $props['country'] ?? '';
            
            return "{$city}, {$country}";
        } catch (\Exception $e) {
            return "Unknown Location";
        }
    }

    public function getPhoto($photoReference)
    {
        // Cache the resolved URL (e.g. for 12 hours) to avoid hitting RapidAPI quota limits
        $cacheKey = "photo_uri_" . md5($photoReference);
        
        if (\Illuminate\Support\Facades\Cache::has($cacheKey)) {
            Log::info("Serving photo URI from cache for reference: {$photoReference}");
            return redirect(\Illuminate\Support\Facades\Cache::get($cacheKey));
        }

        // Google Places Photo API via RapidAPI V2
        // $photoReference should be formatted like "places/PLACE_ID/photos/PHOTO_ID"
        $url = "https://google-map-places-new-v2.p.rapidapi.com/v1/{$photoReference}/media?maxWidthPx=400&maxHeightPx=400&skipHttpRedirect=true";

        try {
            $response = Http::withHeaders([
                'x-rapidapi-host' => 'google-map-places-new-v2.p.rapidapi.com',
                'x-rapidapi-key' => $this->rapidApiKey
            ])->withoutVerifying()->get($url);

            if ($response->failed()) {
                // If rate limited or failed, redirect to a nicer travel placeholder
                $seed = urlencode($photoReference);
                return redirect("https://picsum.photos/seed/{$seed}/400/300");
            }

            $data = $response->json();
            
            // The v2 endpoint with skipHttpRedirect=true returns a JSON with photoUri
            if (isset($data['photoUri'])) {
                \Illuminate\Support\Facades\Cache::put($cacheKey, $data['photoUri'], now()->addHours(12));
                return redirect($data['photoUri']);
            }
            
            $seed = urlencode($photoReference);
            return redirect("https://picsum.photos/seed/{$seed}/400/300");

        } catch (\Exception $e) {
            Log::error("Failed to fetch photo from RapidAPI: " . $e->getMessage());
            $seed = urlencode($photoReference);
            return redirect("https://picsum.photos/seed/{$seed}/400/300");
        }
    }

    public function autocomplete($query, $lat, $lng)
    {
        // 1. Try Geoapify Autocomplete API first
        $url = "https://api.geoapify.com/v1/geocode/autocomplete?text=" . urlencode($query) . "&filter=countrycode:ph&bias=proximity:{$lng},{$lat}&limit=8&apiKey={$this->geoapifyKey}";
        
        try {
            $response = Http::withoutVerifying()->get($url);
            if ($response->successful()) {
                $features = $response->json()['features'] ?? [];
                if (!empty($features)) {
                    return array_map(function($f) {
                        $p = $f['properties'];
                        return [
                            'id' => (string) ($p['place_id'] ?? uniqid()),
                            'name' => $p['name'] ?? $p['formatted'] ?? 'Unknown Place',
                            'address' => $p['address_line2'] ?? $p['city'] ?? $p['formatted'] ?? '',
                            'lat' => (float) $p['lat'],
                            'lng' => (float) $p['lon']
                        ];
                    }, $features);
                }
            }
        } catch (\Exception $e) {
            Log::warning("Geoapify autocomplete failed: " . $e->getMessage());
        }

        // 2. Fallback: Nominatim OpenStreetMap (Nationwide PH Search)
        try {
            $nomUrl = "https://nominatim.openstreetmap.org/search?q=" . urlencode($query) . "&format=json&countrycodes=ph&limit=8&addressdetails=1";
            $response = Http::withHeaders([
                'User-Agent' => 'Mozilla/5.0 (compatible; IntelliTravel/1.0; +http://localhost)'
            ])->withoutVerifying()->get($nomUrl);

            if ($response->successful()) {
                $items = $response->json() ?? [];
                return array_map(function($item) {
                    $parts = explode(',', $item['display_name'] ?? '');
                    $name = $item['name'] ?? trim($parts[0] ?? 'Unknown Place');
                    return [
                        'id' => (string) ($item['place_id'] ?? uniqid()),
                        'name' => !empty($name) ? $name : ($parts[0] ?? 'Unknown Place'),
                        'address' => $item['display_name'] ?? '',
                        'lat' => (float) $item['lat'],
                        'lng' => (float) $item['lon']
                    ];
                }, $items);
            }
        } catch (\Exception $e) {
            Log::error("Nominatim fallback autocomplete failed: " . $e->getMessage());
        }

        return [];
    }

    public function getRecommended($lat, $lng, $userId)
    {
        // 1. Get User's Last Interaction Category
        $lastInteraction = \App\Models\UserInteraction::where('user_id', $userId)
            ->latest()
            ->first();

        // 2. Determine Preference (Default to 'attractions' if new user)
        $category = $lastInteraction ? $lastInteraction->category : 'attractions';

        Log::info("Recommending category: {$category} for User {$userId}");

        // 3. Fetch from Geoapify (or RapidAPI if you prefer)
        return $this->searchGeoapifyCategory($lat, $lng, $category);
    }
}
