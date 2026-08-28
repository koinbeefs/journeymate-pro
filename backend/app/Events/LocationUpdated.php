<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class LocationUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $locationData;
    public $tripId;

    public function __construct($locationData, $tripId)
    {
        $this->locationData = $locationData;
        $this->tripId = $tripId;
    }

    public function broadcastOn(): array
    {
        return [
            new PresenceChannel('trip.' . $this->tripId),
        ];
    }
}
