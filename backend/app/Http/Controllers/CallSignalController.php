<?php declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\CallSignal;
use Illuminate\Http\Request;

class CallSignalController extends Controller
{
    // POST /calls/signal
    public function send(Request $request)
    {
        $request->validate([
            'conversation_id' => 'required|string',
            'to_id' => 'required|integer',
            'payload' => 'required|array',
        ]);

        $signal = CallSignal::create([
            'conversation_id' => $request->conversation_id,
            'from_id' => $request->user()->id,
            'to_id' => $request->to_id,
            'payload' => $request->payload,
        ]);

        broadcast(new \App\Events\CallSignalSent(['id' => $signal->id, 'type' => 'ping'], $request->to_id));

        return response()->json($signal, 201);
    }

    // GET /calls/signals
    public function receive(Request $request)
    {
        $userId = $request->user()->id;

        // Fetch all pending signals directed to the current user
        $signals = CallSignal::where('to_id', $userId)
            ->orderBy('created_at', 'asc')
            ->get();

        // Delete the retrieved signals so they are only consumed once
        if ($signals->isNotEmpty()) {
            CallSignal::whereIn('id', $signals->pluck('id'))->delete();
        }

        return response()->json($signals);
    }
}
