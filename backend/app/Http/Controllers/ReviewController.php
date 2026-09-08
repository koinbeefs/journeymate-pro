<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\Review;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class ReviewController extends Controller
{
    /**
     * Get reviews (filtered by trip_id, place_name, or place_id)
     */
    public function index(Request $request)
    {
        try {
            $tripId = $request->query('trip_id');
            $placeName = $request->query('place_name');
            $placeId = $request->query('place_id');
            
            $query = Review::with('user');

            if ($tripId) {
                $query->where('trip_id', $tripId);
            }

            // Only query place_id if the column exists in the database table
            if ($placeId && Schema::hasColumn('reviews', 'place_id')) {
                $query->where('place_id', $placeId);
            } elseif ($placeName) {
                $query->where('place_name', $placeName);
            }

            return response()->json($query->latest()->get());
        } catch (\Exception $e) {
            Log::error("ReviewController index query error: " . $e->getMessage());
            return response()->json([]);
        }
    }

    /**
     * Create a new review
     */
    public function store(Request $request)
    {
        $request->validate([
            'trip_id' => 'nullable|exists:trips,id',
            'place_id' => 'nullable|string',
            'place_name' => 'required|string',
            'rating' => 'required|integer|min:1|max:5',
            'review_text' => 'nullable|string',
            'photos' => 'nullable|array',
            'photos.*' => 'string',
        ]);

        try {
            $payload = [
                'user_id' => Auth::id(),
                'place_name' => $request->place_name,
                'rating' => $request->rating,
                'review_text' => $request->review_text,
            ];

            if ($request->trip_id) {
                $payload['trip_id'] = $request->trip_id;
            }

            if ($request->place_id && Schema::hasColumn('reviews', 'place_id')) {
                $payload['place_id'] = $request->place_id;
            }

            if ($request->photos && Schema::hasColumn('reviews', 'photos')) {
                $payload['photos'] = $request->photos;
            }

            $review = Review::create($payload);

            return response()->json($review->load('user'), 201);
        } catch (\Exception $e) {
            Log::error("ReviewController store error: " . $e->getMessage());
            return response()->json(['message' => 'Failed to save review: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Delete a review
     */
    public function destroy($id)
    {
        $review = Review::findOrFail($id);

        if ($review->user_id !== Auth::id()) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $review->delete();

        return response()->json(['message' => 'Review deleted']);
    }
}
