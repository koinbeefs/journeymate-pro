/**
 * Call Signaling Service (frontend-only mock)
 *
 * Same public API as the Supabase-backed original, but the signaling
 * transport is a BroadcastChannel so two browser tabs/windows on the
 * same origin can run a real WebRTC 1-on-1 call without any backend.
 *
 * Swap the `MockChannel` block for a Supabase `supabase.channel(...)`
 * subscription when Cloud is enabled — public API stays identical.
 */

import echo from '@/lib/echo';
import { callSignalApi } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalType =
  | "offer"
  | "answer"
  | "ice-candidate"
  | "hangup"
  | "reject"
  | "busy"
  | "remote-stream";

export type CallMode = "video" | "audio";

export interface SignalPayload {
  type: SignalType;
  from: string;
  to: string;
  conversationId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit | null;
  stream?: MediaStream;
  mode?: CallMode;
}

export type SignalCallback = (payload: SignalPayload) => void;

// ---------------------------------------------------------------------------
// STUN config (TURN omitted in mock — same-origin tabs don't need it)
// ---------------------------------------------------------------------------

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    }
  ],
  iceTransportPolicy: "all",
};

const ICE_DISCONNECTED_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Module state (singleton — only one call at a time)
// ---------------------------------------------------------------------------

let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let currentRemoteUserId: string | null = null;
let isRemoteDescriptionSet = false;
let pendingIceCandidates: RTCIceCandidateInit[] = [];
let signalListeners: SignalCallback[] = [];
let currentConversationId: string | null = null;
let currentLocalUserId: string | null = null;
let currentMode: CallMode = "video";
let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannelName(conversationId: string): string {
  return `call-signal-${conversationId}`;
}

export function isOfferer(localUserId: string, remoteUserId: string): boolean {
  return localUserId < remoteUserId;
}

function clearDisconnectedTimer(): void {
  if (disconnectedTimer) {
    clearTimeout(disconnectedTimer);
    disconnectedTimer = null;
  }
}

/**
 * Strip problematic `a=ssrc:... msid:...` lines that newer Chrome Unified Plan
 * parsers reject. The msid info is already carried by `a=msid:` lines.
 */
function sanitizeSdp(sdp: string | undefined): string {
  if (!sdp) return "";
  // Ensure proper CRLF line endings required by the SDP spec
  const normalized = sdp.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .filter((line) => {
      // Remove all a=ssrc attribute lines (msid, cname, label, mslabel) — the
      // info is already carried by a=msid and a=ssrc-group in Unified Plan
      if (/^a=ssrc:\d+ (?:msid|cname|label|mslabel):/.test(line)) return false;
      return true;
    })
    .join("\r\n");
}

// ---------------------------------------------------------------------------
// Mock signaling channel (BroadcastChannel — cross-tab, same origin)
// ---------------------------------------------------------------------------

let currentEchoChannel: any = null;

function ensureSignalingChannel(conversationId: string, localUserId: string): void {
  if (currentConversationId === conversationId) return;

  currentConversationId = conversationId;
  currentLocalUserId = localUserId;

  if (currentEchoChannel) {
    echo.leave(`user.${localUserId}`);
    currentEchoChannel = null;
  }

  currentEchoChannel = echo.private(`user.${localUserId}`)
    .listen('CallSignalSent', async (payload: any) => {
      // The WebSocket event now just sends a tiny ping.
      // We must fetch the actual large signal payloads via the API.
      try {
        const response = await callSignalApi.receive();
        const pendingSignals = response.data;

        for (const signal of pendingSignals) {
          const signalData = signal.payload;
          
          const outPayload: SignalPayload = {
            type: signalData.type,
            from: String(signal.from_id || signalData.from_id || signalData.from),
            to: String(signal.to_id || signalData.to_id || signalData.to),
            conversationId: signal.conversation_id || signalData.conversation_id || signalData.conversationId,
            sdp: signalData.sdp ? decodeURIComponent(signalData.sdp) : undefined,
            candidate: signalData.candidate,
            mode: signalData.mode,
          };

          if (outPayload.type === "offer") {
            currentRemoteUserId = outPayload.from;
          }

          for (const listener of signalListeners) listener(outPayload);
          void handleIncomingSignal(outPayload);
        }
      } catch (err) {
        console.error("[Call] Failed to receive pending signals:", err);
      }
    });
}

export function setSignalingSpeed(speed: "fast" | "slow"): void {
  // No-op since we use WebSockets now instead of polling
}

async function sendSignal(payload: SignalPayload): Promise<void> {
  const targetId = payload.to || currentRemoteUserId;
  if (!targetId) {
    console.warn("[Call] No remote user ID for signal", payload.type);
    return;
  }
  try {
    const outPayload = { ...payload };
    if (outPayload.sdp) {
      outPayload.sdp = encodeURIComponent(outPayload.sdp);
    }
    await callSignalApi.send(outPayload.conversationId, Number(targetId), outPayload);
  } catch (err) {
    console.error("[Call] Failed to send signal:", err);
  }
}

// ---------------------------------------------------------------------------
// Media stream helpers
// ---------------------------------------------------------------------------

export async function acquireLocalMedia(videoEnabled = true): Promise<MediaStream> {
  if (videoEnabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      localStream = stream;
      return stream;
    } catch (err) {
      console.warn("[Call] Camera unavailable, falling back to audio-only:", err);
      const audioOnlyStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStream = audioOnlyStream;
      return audioOnlyStream;
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  localStream = stream;
  return stream;
}

export function stopLocalMedia(): void {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
}

// ---------------------------------------------------------------------------
// Peer connection management
// ---------------------------------------------------------------------------

function createPeerConnection(conversationId: string, localUserId: string): RTCPeerConnection {
  if (peerConnection) peerConnection.close();

  clearDisconnectedTimer();
  isRemoteDescriptionSet = false;
  remoteStream = new MediaStream();

  const pc = new RTCPeerConnection(RTC_CONFIG);

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream!));
  }

  pc.ontrack = (event) => {
    if (remoteStream && event.track) {
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
    }
    for (const listener of signalListeners) {
      listener({
        type: "remote-stream",
        from: "system",
        to: localUserId,
        conversationId,
        stream: remoteStream || undefined,
      });
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: "ice-candidate",
        from: localUserId,
        to: currentRemoteUserId || "",
        conversationId,
        candidate: event.candidate.toJSON(),
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    switch (state) {
      case "connected":
      case "completed":
        clearDisconnectedTimer();
        break;
      case "disconnected":
        clearDisconnectedTimer();
        disconnectedTimer = setTimeout(() => {
          if (peerConnection && peerConnection.iceConnectionState === "disconnected") {
            endCall("hangup");
          }
        }, ICE_DISCONNECTED_TIMEOUT_MS);
        break;
      case "failed":
        clearDisconnectedTimer();
        endCall("hangup");
        break;
      case "closed":
        clearDisconnectedTimer();
        break;
    }
  };

  peerConnection = pc;
  return pc;
}

async function flushPendingCandidates(): Promise<void> {
  if (!peerConnection || !isRemoteDescriptionSet) return;
  for (const candidate of pendingIceCandidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("[Call] Failed to add buffered ICE candidate:", err);
    }
  }
  pendingIceCandidates = [];
}

async function handleIncomingSignal(signal: SignalPayload): Promise<void> {
  switch (signal.type) {
    case "answer": {
      if (!peerConnection) return;
      try {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: sanitizeSdp(signal.sdp) })
        );
        isRemoteDescriptionSet = true;
        await flushPendingCandidates();
      } catch (err) {
        console.error("[Call] Failed to set remote answer:", err);
      }
      break;
    }
    case "ice-candidate": {
      if (!signal.candidate) return;
      if (!peerConnection || !isRemoteDescriptionSet) {
        pendingIceCandidates.push(signal.candidate);
        return;
      }
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (err) {
        console.warn("[Call] Failed to add ICE candidate:", err);
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function startCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string,
  mode: CallMode = "video"
): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
  ensureSignalingChannel(conversationId, localUserId);
  setSignalingSpeed("fast");
  currentRemoteUserId = remoteUserId;
  currentMode = mode;
  pendingIceCandidates = [];

  const stream = await acquireLocalMedia(mode === "video");
  const pc = createPeerConnection(conversationId, localUserId);

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: mode === "video",
  });
  await pc.setLocalDescription(offer);

  sendSignal({
    type: "offer",
    from: localUserId,
    to: remoteUserId,
    conversationId,
    sdp: offer.sdp,
    mode,
  });

  return { localStream: stream, remoteStream: remoteStream! };
}

export async function acceptCall(
  conversationId: string,
  localUserId: string,
  remoteUserId: string,
  offerSdp: string,
  mode: CallMode = "video"
): Promise<{ localStream: MediaStream; remoteStream: MediaStream }> {
  ensureSignalingChannel(conversationId, localUserId);
  setSignalingSpeed("fast");
  currentRemoteUserId = remoteUserId;
  currentMode = mode;

  let stream: MediaStream;
  try {
    stream = await acquireLocalMedia(mode === "video");
  } catch (err) {
    sendSignal({ type: "hangup", from: localUserId, to: remoteUserId, conversationId });
    cleanupCall();
    throw err;
  }

  const pc = createPeerConnection(conversationId, localUserId);
  await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sanitizeSdp(offerSdp) }));
  isRemoteDescriptionSet = true;
  await flushPendingCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  sendSignal({
    type: "answer",
    from: localUserId,
    to: remoteUserId,
    conversationId,
    sdp: answer.sdp,
    mode,
  });

  return { localStream: stream, remoteStream: remoteStream! };
}

export function endCall(reason: "hangup" | "reject" | "busy" = "hangup"): void {
  if (currentConversationId && currentLocalUserId) {
    sendSignal({
      type: reason,
      from: currentLocalUserId,
      to: currentRemoteUserId || "",
      conversationId: currentConversationId,
    });
  }
  cleanupCall();
}

export function subscribeToCallSignals(conversationId: string, localUserId: string): void {
  ensureSignalingChannel(conversationId, localUserId);
}

export function onSignal(callback: SignalCallback): () => void {
  signalListeners.push(callback);
  return () => {
    signalListeners = signalListeners.filter((cb) => cb !== callback);
  };
}

export function toggleMute(muted: boolean): void {
  localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
}

export function toggleVideo(videoOff: boolean): void {
  localStream?.getVideoTracks().forEach((t) => (t.enabled = !videoOff));
}

let currentFacingMode: "user" | "environment" = "user";

export async function switchCamera(): Promise<MediaStream | null> {
  if (!localStream || !peerConnection) return null;
  const newFacing = currentFacingMode === "user" ? "environment" : "user";

  try {
    const newVideoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: newFacing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    const newVideoTrack = newVideoStream.getVideoTracks()[0];
    if (!newVideoTrack) return null;

    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) {
      oldVideoTrack.stop();
      localStream.removeTrack(oldVideoTrack);
    }
    localStream.addTrack(newVideoTrack);

    const videoSender = peerConnection.getSenders().find((s) => s.track?.kind === "video");
    if (videoSender) await videoSender.replaceTrack(newVideoTrack);

    currentFacingMode = newFacing;
    return localStream;
  } catch (err) {
    console.warn("[Call] Failed to switch camera:", err);
    return null;
  }
}

export function cleanupCall(): void {
  clearDisconnectedTimer();
  stopLocalMedia();

  if (remoteStream) {
    remoteStream.getTracks().forEach((t) => t.stop());
    remoteStream = null;
  }
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.onicecandidate = null;
    peerConnection.oniceconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  isRemoteDescriptionSet = false;
  pendingIceCandidates = [];
  setSignalingSpeed("slow");
}

export function cleanup(): void {
  cleanupCall();
  if (currentEchoChannel && currentLocalUserId) {
    import('@/lib/echo').then(({ default: echo }) => {
      echo.leave(`user.${currentLocalUserId}`);
    });
    currentEchoChannel = null;
  }
  currentConversationId = null;
  currentLocalUserId = null;
  currentRemoteUserId = null;
}

export function getCallDebugInfo(): Record<string, unknown> {
  return {
    hasPC: !!peerConnection,
    pcState: peerConnection?.iceConnectionState ?? "none",
    signalingState: peerConnection?.signalingState ?? "none",
    hasLocalStream: !!localStream,
    localTracks: localStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    hasRemoteStream: !!remoteStream,
    remoteTracks: remoteStream?.getTracks().map((t) => `${t.kind}:${t.enabled}`) ?? [],
    remoteDescSet: isRemoteDescriptionSet,
    pendingCandidates: pendingIceCandidates.length,
    conversationId: currentConversationId,
    mode: currentMode,
  };
}
