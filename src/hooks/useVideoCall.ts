/**
 * useVideoCall — bridges the call signaling service to React state.
 * State machine: idle → calling → ringing → active → ended.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  startCall,
  acceptCall,
  endCall,
  cleanup,
  cleanupCall,
  onSignal,
  subscribeToCallSignals,
  toggleMute,
  toggleVideo,
  switchCamera,
  type SignalPayload,
  type CallMode,
} from "@/services/callSignaling";

export type CallStatus = "idle" | "calling" | "ringing" | "active" | "ended";

export interface IncomingCallInfo {
  from: string;
  conversationId: string;
  offerSdp: string;
  mode: CallMode;
}

export interface UseVideoCallReturn {
  callStatus: CallStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: IncomingCallInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isFrontCamera: boolean;
  callDuration: number;
  initiateCall: (remoteUserId: string, callMode?: CallMode) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => void;
  hangUp: () => void;
  toggleMuteAudio: () => void;
  toggleCameraOff: () => void;
  switchCameraFacing: () => Promise<void>;
}

export function useVideoCall(
  conversationId: string,
  localUserId: string | undefined,
  mode: CallMode = "video",
): UseVideoCallReturn {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [callDuration, setCallDuration] = useState(0);

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStatusRef = useRef<CallStatus>("idle");

  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);

  useEffect(() => {
    if (callStatus === "active") {
      setCallDuration(0);
      durationIntervalRef.current = setInterval(() => setCallDuration((p) => p + 1), 1000);
    } else if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [callStatus]);

  const resetToEnded = useCallback(() => {
    setCallStatus("ended");
    setIncomingCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsVideoOff(false);
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    setTimeout(() => setCallStatus("idle"), 500);
  }, []);



  useEffect(() => {
    if (!conversationId || !localUserId) return;
    subscribeToCallSignals(conversationId, localUserId);

    const unsubscribe = onSignal((signal: SignalPayload) => {
      switch (signal.type) {
        case "offer":
          if (callStatusRef.current === "idle") {
            setIncomingCall({
              from: signal.from,
              conversationId: signal.conversationId,
              offerSdp: signal.sdp ?? "",
              mode: signal.mode ?? "video",
            });
            setCallStatus("ringing");
          } else {
            endCall("busy");
          }
          break;
        case "answer":
          if (callStatusRef.current === "calling") setCallStatus("active");
          break;
        case "hangup":
          if (callStatusRef.current !== "idle" && callStatusRef.current !== "ended") {
            cleanupCall();
            resetToEnded();
          }
          break;
        case "reject":
        case "busy":
          cleanupCall();
          resetToEnded();
          break;
        case "remote-stream":
          if (signal.stream) setRemoteStream(signal.stream);
          break;
      }
    });

    return () => { unsubscribe(); };
  }, [conversationId, localUserId, resetToEnded]);

  useEffect(() => {
    return () => {
      if (callStatusRef.current !== "idle") endCall("hangup");
      cleanup();
    };
  }, []);

  const initiateCall = useCallback(async (remoteUserId: string, callMode?: CallMode) => {
    if (!localUserId || !conversationId) return;
    const effectiveMode = callMode || mode;
    try {
      setCallStatus("calling");
      const { localStream: ls, remoteStream: rs } = await startCall(
        conversationId, localUserId, remoteUserId, effectiveMode,
      );
      setLocalStream(ls);
      setRemoteStream(rs);
    } catch (err) {
      console.error("[Call] Failed to start call:", err);
      setCallStatus("idle");
      cleanupCall();
    }
  }, [conversationId, localUserId, mode]);

  const acceptIncomingCall = useCallback(async () => {
    if (!localUserId || !incomingCall) return;
    try {
      const { localStream: ls, remoteStream: rs } = await acceptCall(
        incomingCall.conversationId,
        localUserId,
        incomingCall.from,
        incomingCall.offerSdp,
        incomingCall.mode
      );
      setLocalStream(ls);
      setRemoteStream(rs);
      setCallStatus("active");
      setIncomingCall(null);
    } catch (err) {
      console.error("[Call] Failed to accept call:", err);
      setCallStatus("idle");
      setIncomingCall(null);
      cleanupCall();
    }
  }, [localUserId, incomingCall]);

  const rejectIncomingCall = useCallback(() => {
    endCall("reject");
    setCallStatus("idle");
    setIncomingCall(null);
  }, []);

  const hangUp = useCallback(() => {
    endCall("hangup");
    resetToEnded();
  }, [resetToEnded]);

  useEffect(() => {
    if (callStatus === "calling" || callStatus === "ringing") {
      ringingTimeoutRef.current = setTimeout(() => {
        if (callStatusRef.current === "calling" || callStatusRef.current === "ringing") {
          console.warn("[Call] Ringing/calling timeout. Hanging up.");
          hangUp();
        }
      }, 30000);
    } else {
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
        ringingTimeoutRef.current = null;
      }
    }
    return () => {
      if (ringingTimeoutRef.current) {
        clearTimeout(ringingTimeoutRef.current);
      }
    };
  }, [callStatus, hangUp]);

  const toggleMuteAudio = useCallback(() => {
    setIsMuted((prev) => { toggleMute(!prev); return !prev; });
  }, []);

  const toggleCameraOff = useCallback(() => {
    setIsVideoOff((prev) => { toggleVideo(!prev); return !prev; });
  }, []);

  const switchCameraFacing = useCallback(async () => {
    const updated = await switchCamera();
    if (updated) {
      setLocalStream(updated);
      setIsFrontCamera((p) => !p);
    }
  }, []);

  return {
    callStatus, localStream, remoteStream, incomingCall,
    isMuted, isVideoOff, isFrontCamera, callDuration,
    initiateCall, acceptIncomingCall, rejectIncomingCall, hangUp,
    toggleMuteAudio, toggleCameraOff, switchCameraFacing,
  };
}
