<?php

namespace App\Http\Controllers;

use App\Models\Trip;
use App\Models\User;
use App\Models\Notification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TripInvitationController extends Controller
{
    // POST /trips/{id}/invite
    public function invite(Request $request, $tripId)
    {
        $request->validate([
            'username' => 'required_without:email|string',
            'email' => 'required_without:username|email',
        ]);
        
        $trip = Trip::findOrFail($tripId);

        // Only owner can invite
        if ($request->user()->id !== $trip->user_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Search by username or email
        $invitee = null;
        if ($request->has('username')) {
            $invitee = User::where('username', $request->username)->first();
        } elseif ($request->has('email')) {
            $invitee = User::where('email', $request->email)->first();
        }

        if (!$invitee) {
            return response()->json(['message' => 'User not found'], 404);
        }

        // Check if already invited (in notifications, not trip_user)
        $existingNotification = Notification::where('user_id', $invitee->id)
            ->where('type', 'trip_invite')
            ->where('data->trip_id', $trip->id)
            ->first();

        if ($existingNotification) {
            return response()->json(['message' => 'Invitation already sent'], 400);
        }

        // Check if user is already in trip_user (from old invites)
        $existingTripUser = DB::table('trip_user')
            ->where('trip_id', $tripId)
            ->where('user_id', $invitee->id)
            ->first();

        if ($existingTripUser) {
            if ($existingTripUser->status === 'accepted') {
                return response()->json(['message' => 'User is already a collaborator'], 400);
            }
            // If pending, just create notification (user already in trip_user)
        } else {
            // Add to trip_user with pending status
            $trip->users()->syncWithoutDetaching([$invitee->id => [
                'role' => 'editor',
                'status' => 'pending'
            ]]);
        }

        // Create notification for the invitee
        $notification = Notification::create([
            'user_id' => $invitee->id,
            'type' => 'trip_invite',
            'title' => 'Trip Invitation',
            'message' => "{$request->user()->username} invited you to join \"{$trip->title}\"",
            'icon' => 'users',
            'read' => false,
            'data' => [
                'trip_id' => $trip->id,
                'trip_title' => $trip->title,
                'inviter_name' => $request->user()->username,
                'inviter_id' => $request->user()->id,
            ],
            'action_label' => 'Accept',
            'action_type' => 'accept_invite',
        ]);

        broadcast(new \App\Events\NotificationReceived($notification, $invitee->id));

        return response()->json(['message' => 'Invitation sent!', 'user' => [
            'id' => $invitee->id,
            'name' => $invitee->username,
            'email' => $invitee->email,
            'avatar' => $invitee->profile_pic,
        ]]);
    }

    // GET /trips/{id}/collaborators
    public function collaborators($tripId)
    {
        $trip = Trip::findOrFail($tripId);
        // Return invited users; owner is included separately via /user endpoint
        $users = $trip->user()->get();
        
        return response()->json($users->map(function ($u) {
            return [
                'id' => $u->id,
                'name' => $u->username,
                'email' => $u->email,
                'avatar' => $u->profile_pic,
                'role' => $u->pivot->role ?? 'editor',
            ];
        }));
    }
}
