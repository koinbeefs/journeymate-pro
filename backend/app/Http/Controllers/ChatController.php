<?php

namespace App\Http\Controllers;

use App\Models\Trip;
use App\Models\ChatMessage;
use Illuminate\Http\Request;

class ChatController extends Controller
{
    // GET /trips/{id}/messages
    public function index(Request $request, $tripId)
    {
        // Simple authorization: Must be part of trip
        $trip = Trip::findOrFail($tripId);
        
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        return ChatMessage::where('trip_id', $tripId)
            ->with('user:id,username,profile_pic')
            ->orderBy('created_at', 'asc')
            ->get();
    }

    // POST /trips/{id}/messages
    public function store(Request $request, $tripId)
    {
        $trip = Trip::findOrFail($tripId);
        
        $isCollaborator = $trip->user_id === $request->user()->id || 
            $trip->users()->where('trip_user.user_id', $request->user()->id)->where('trip_user.status', 'accepted')->exists();

        if (!$isCollaborator) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'content' => 'required|string',
            'type' => 'nullable|string'
        ]);

        $message = ChatMessage::create([
            'trip_id' => $tripId,
            'user_id' => $request->user()->id,
            'content' => $request->input('content'),
            'type' => $request->input('type', 'text')
        ]);

        $message->load('user');
        broadcast(new \App\Events\MessageSent($message, $tripId))->toOthers();

        return response()->json($message, 201);
    }
}
