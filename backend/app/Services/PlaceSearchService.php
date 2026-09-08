<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PlaceSearchService
{
    protected $baseUrl = 'https://nominatim.openstreetmap.org';

    /**
     * Search for places
     */
    public function searchPlaces($query, $lat = null, $lng = null, $radius = 10000)
    {
        $params = [
            'q' => $query,
            'format' => 'json',
            'addressdetails' => 1,
            'limit' => 10,
            'countrycodes' => 'ph',
        ];

        // Soft bias towards user location if provided
        if ($lat && $lng) {
            $delta = 0.5; // Approx 50km viewbox preference
            $params['viewbox'] = ($lng - $delta) . ',' . ($lat - $delta) . ',' . ($lng + $delta) . ',' . ($lat + $delta);
            // bounded = 0 (default): soft preference for nearby, but still returns nationwide matches
        }

        try {
            Log::info("Searching Nominatim: $query");

            // 1. Force User-Agent (Required by Nominatim Policy)
            // 2. Disable SSL Verification (verify => false) for local dev
            $response = Http::withOptions([
                'verify' => false, 
            ])
            ->withHeaders([
                'User-Agent' => 'Mozilla/5.0 (compatible; IntelliTravel/1.0; +http://localhost)' 
            ])
            ->get("{$this->baseUrl}/search", $params);

            if ($response->failed()) {
                Log::error("Nominatim API Error: " . $response->status() . " - " . $response->body());
                return [];
            }

            return $this->formatResults($response->json());

        } catch (\Exception $e) {
            Log::error("PlaceSearchService Exception: " . $e->getMessage());
            return [];
        }
    }

    public function searchNearby($lat, $lng, $categories = [])
    {
        $query = is_array($categories) ? implode(',', $categories) : ($categories ?? 'tourism');
        
        $params = [
            'q' => $query,
            'format' => 'json',
            'addressdetails' => 1,
            'limit' => 20,
            'countrycodes' => 'ph',
            'viewbox' => ($lng-0.05) . ',' . ($lat-0.05) . ',' . ($lng+0.05) . ',' . ($lat+0.05),
            'bounded' => 1
        ];

        try {
            $response = Http::withOptions(['verify' => false])
                ->withHeaders(['User-Agent' => 'Mozilla/5.0 (compatible; IntelliTravel/1.0; +http://localhost)'])
                ->get("{$this->baseUrl}/search", $params);

            return $this->formatResults($response->json());
        } catch (\Exception $e) {
            Log::error("Nearby Search Error: " . $e->getMessage());
            return [];
        }
    }

    public function findGasStations($lat, $lng)
    {
        return $this->searchNearby($lat, $lng, 'gas station');
    }

    protected function formatResults($data)
    {
        if (empty($data) || !is_array($data)) return [];

        return array_map(function ($item) {
            return [
                'place_id' => (string) ($item['place_id'] ?? uniqid()),
                'name' => $item['name'] ?? explode(',', $item['display_name'])[0],
                'address' => $item['display_name'],
                'lat' => (float) $item['lat'],
                'lng' => (float) $item['lon'],
                'category' => $item['class'] ?? 'unknown',
                'type' => $item['type'] ?? 'place',
                'source' => 'openstreetmap'
            ];
        }, $data);
    }
}
