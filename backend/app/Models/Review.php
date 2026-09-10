<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Review extends Model
{
    protected $fillable = [
        'user_id',
        'trip_id',
        'itinerary_id',
        'place_id',
        'place_name',
        'rating',
        'review_text',
        'photos',
    ];

    protected $casts = [
        'rating' => 'integer',
        'photos' => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function trip()
    {
        return $this->belongsTo(Trip::class);
    }

    public function itinerary()
    {
        return $this->belongsTo(Itinerary::class);
    }
}
