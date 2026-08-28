<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserInteraction;
use Illuminate\Http\Request;

class LocationController extends Controller
{
    public function updateLocation(Request $request)
    {
        $request->validate([
            'lat' => 'required|numeric',
            'lng' => 'required|numeric',
        ]);

        $user = $request->user();
        $user->last_location_lat = $request->lat;
        $user->last_location_lng = $request->lng;
        $user->last_active_at = now();
        $user->save();

        $trips = \App\Models\Trip::where('user_id', $user->id)
            ->orWhereHas('users', function ($q) use ($user) {
                $q->where('user_id', $user->id)->where('trip_user.status', 'accepted');
            })->pluck('id');

        $locationData = [
            'user_id' => $user->id,
            'lat' => $request->lat,
            'lng' => $request->lng,
        ];

        foreach ($trips as $tripId) {
            broadcast(new \App\Events\LocationUpdated($locationData, $tripId))->toOthers();
        }

        return response()->json(['message' => 'Location updated']);
    }

    public function heatmap(Request $request)
    {
        // Simple heatmap based on user interactions
        $interactions = UserInteraction::select('place_id', 'place_name')->get();
        // Since user interactions don't have lat/lng directly in the current schema (wait, do they?), 
        // we'll return a basic structure. Wait, trip_visits has lat/lng.
        // Let's use trip_visits!
        
        $visits = \Illuminate\Support\Facades\DB::table('trip_visits')
                    ->select('lat', 'lng', 'place_name')
                    ->get();
                    
        $heatmapData = $visits->map(function ($visit) {
            return [$visit->lat, $visit->lng, 1, $visit->place_name ?? 'Unknown Location']; // lat, lng, intensity, name
        });



        return response()->json($heatmapData);
    }
}
