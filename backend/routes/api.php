<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PlaceController;
use App\Http\Controllers\InteractionController;
use App\Http\Controllers\TripController;
use App\Http\Controllers\ItineraryController;
use App\Http\Controllers\UserPreferenceController;
use App\Http\Controllers\TripInvitationController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ReviewController;
use App\Http\Controllers\WeatherController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\LocationController;
use App\Http\Controllers\ExpenseController;
use App\Http\Controllers\BudgetController;
use App\Http\Controllers\CurrencyController;

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);
Route::get('/auth/google', [AuthController::class, 'googleRedirect']);
Route::get('/auth/google/callback', [AuthController::class, 'googleCallback']);

use Illuminate\Support\Facades\Broadcast;
Broadcast::routes(['middleware' => ['auth:sanctum']]);

// Currency (Public or Auth, keeping it Public for now so anyone can convert)
Route::get('/currency/rates', [CurrencyController::class, 'latest']);

// Public photo proxy for img src tags
Route::get('/places/photo', [PlaceController::class, 'photo']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/interactions', [InteractionController::class, 'store']);
    
    // Trips
    Route::post('trips/{id}/activate', [TripController::class, 'activate']);
    Route::get('trips/{id}/recommendations', [TripController::class, 'getRecommendations']);
    Route::post('/trips/{id}/invite', [TripInvitationController::class, 'invite']);
    Route::get('/trips/{id}/collaborators', [TripInvitationController::class, 'collaborators']);
    
    Route::get('/trips/{id}/messages', [ChatController::class, 'index']);
    Route::post('/trips/{id}/messages', [ChatController::class, 'store']);
    
    // Expenses & Budgets
    Route::get('/trips/{tripId}/expenses', [ExpenseController::class, 'index']);
    Route::post('/trips/{tripId}/expenses', [ExpenseController::class, 'store']);
    Route::delete('/expenses/{id}', [ExpenseController::class, 'destroy']);
    
    Route::get('/trips/{tripId}/budget', [BudgetController::class, 'show']);
    Route::put('/trips/{tripId}/budget', [BudgetController::class, 'update']);
    
    Route::resource('trips', TripController::class); // Generic last
    
    // Tracking & Maps
    Route::post('/users/location', [LocationController::class, 'updateLocation']);
    Route::get('/heatmap', [LocationController::class, 'heatmap']);

    // Call Signaling
    Route::post('/calls/signal', [\App\Http\Controllers\CallSignalController::class, 'send']);
    Route::get('/calls/signals', [\App\Http\Controllers\CallSignalController::class, 'receive']);
    
    // Itineraries - SPECIFIC ROUTES MUST BE FIRST
    Route::get('itineraries/search-places', [ItineraryController::class, 'searchPlaces']); // <--- MOVED UP
    Route::get('itineraries/suggest-places', [ItineraryController::class, 'suggestPlaces']); // <--- MOVED UP
    Route::get('trips/{tripId}/itineraries', [ItineraryController::class, 'byTrip']);
    Route::post('trips/{tripId}/calculate-route', [ItineraryController::class, 'calculateRoute']);
    Route::post('route/calculate', [ItineraryController::class, 'calculateGenericRoute']);
    Route::get('trips/{tripId}/route-details', [ItineraryController::class, 'routeDetails']);
    Route::post('trips/{tripId}/rearrange', [ItineraryController::class, 'rearrange']);
    Route::post('trips/{tripId}/auto-plan', [ItineraryController::class, 'autoPlan']);
    
    // Itineraries - GENERIC RESOURCE LAST
    Route::resource('itineraries', ItineraryController::class);
    // Remove the explicit 'show' route if resource already covers it, or keep it if resource is partial. 
    // Since your controller doesn't have 'show', standard 'resource' will try to call it and fail if you hit /itineraries/{id}.
    // If you don't implement show, use: Route::resource('itineraries', ItineraryController::class)->except(['show']);

    // User Search (for inviting)
    Route::get('/users/search', [App\Http\Controllers\UserSearchController::class, 'search']);
    
    // User Preferences
    Route::get('preferences', [UserPreferenceController::class, 'show']);
    Route::put('preferences', [UserPreferenceController::class, 'update']);
    Route::post('preferences/analyze', [UserPreferenceController::class, 'analyzeHistory']);
    
    // Places
    Route::get('/places/recommended', [PlaceController::class, 'recommended']);
    Route::get('/places/popular', [PlaceController::class, 'popular']);
    Route::get('/places/high-rated', [PlaceController::class, 'highRated']);
    Route::get('/places/reverse', [PlaceController::class, 'reverseGeocode']);
    Route::get('/places/autocomplete', [PlaceController::class, 'autocomplete']);
    Route::get('/places/search', [PlaceController::class, 'search']);

    // Reviews
    Route::get('/reviews', [ReviewController::class, 'index']);
    Route::post('/reviews', [ReviewController::class, 'store']);
    Route::delete('/reviews/{id}', [ReviewController::class, 'destroy']);

    // Weather
    Route::get('/weather', [WeatherController::class, 'getWeather']);

    // Notifications
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::put('/notifications/{id}/read', [NotificationController::class, 'markRead']);
    Route::put('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::delete('/notifications/{id}', [NotificationController::class, 'destroy']);
    Route::post('/notifications/{id}/action', [NotificationController::class, 'handleAction']);
});
