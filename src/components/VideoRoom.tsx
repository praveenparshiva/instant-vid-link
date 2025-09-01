import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoParticipant } from './VideoParticipant';
import { VideoControls } from './VideoControls';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseSignaling } from '@/hooks/useSupabaseSignaling';

interface Participant {
  id: string;
  name: string;
  stream?: MediaStream;
  isMuted: boolean;
  isVideoOff: boolean;
}

interface VideoRoomProps {
  roomId: string;
  userName: string;
  onLeaveRoom: () => void;
}

export const VideoRoom = ({ roomId, userName, onLeaveRoom }: VideoRoomProps) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [pinnedParticipant, setPinnedParticipant] = useState<string | null>(null);
  const { toast } = useToast();

  // One RTCPeerConnection per remote participant
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Queue ICE candidates that arrive before remoteDescription is set
  const iceQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const participantId = useRef(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`).current;

  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // ---- helpers ----
  const ensureRemoteEntry = useCallback((id: string, name: string) => {
    setParticipants(prev => (prev.some(p => p.id === id)
      ? prev
      : [...prev, { id, name, isMuted: false, isVideoOff: false }]));
  }, []);

  const attachRemoteTrackHandler = useCallback((pc: RTCPeerConnection, targetId: string) => {
    pc.ontrack = (event: RTCTrackEvent) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) return;

      // Log tracks for debugging
      remoteStream.getTracks().forEach(t =>
        console.log(`📡 Remote ${t.kind} track from ${targetId}:`, t.id, t.readyState)
      );

      // Set/merge the participant stream
      setParticipants(prev =>
        prev.map(p => (p.id === targetId ? { ...p, stream: remoteStream } : p))
      );
    };
  }, []);

  const addLocalToPCOrTransceive = useCallback((pc: RTCPeerConnection, stream: MediaStream | null) => {
    const haveLocal = !!stream && stream.getTracks().length > 0;

    // If we have local tracks, add sendrecv transceivers with those tracks
    if (haveLocal) {
      const addedKinds: Record<string, boolean> = {};
      stream!.getTracks().forEach(track => {
        pc.addTransceiver(track, { direction: 'sendrecv', streams: [stream!] });
        addedKinds[track.kind] = true;
      });

      // If we don’t have one of the kinds locally (e.g., camera off → no video track yet),
      // still add a recvonly transceiver so we can receive from remote.
      if (!addedKinds['video']) pc.addTransceiver('video', { direction: 'recvonly' });
      if (!addedKinds['audio']) pc.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      // No local media yet → be explicit that we want to receive
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
  }, []);

  const flushQueuedIce = useCallback(async (targetId: string) => {
    const pc = peerConnections.current.get(targetId);
    if (!pc || !pc.remoteDescription) return;
    const q = iceQueue.current.get(targetId);
    if (!q || q.length === 0) return;

    for (const c of q) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (e) {
        console.warn('Failed to add queued ICE for', targetId, e);
      }
    }
    iceQueue.current.set(targetId, []);
  }, []);

  // ---- signaling (Supabase) ----
  const { joinRoom, leaveRoom, sendSignal, getExistingParticipants } = useSupabaseSignaling({
    roomId,
    participantId,
    displayName: userName,
    onParticipantJoined: (participant) => {
      const targetId = participant.participant_id;
      const displayName = participant.display_name;
      console.log('🙋 participant joined:', targetId, displayName);

      ensureRemoteEntry(targetId, displayName);

      // Create the PC immediately (we may still be acquiring local)
      const pc = createPeerConnection(targetId, localStream);
      // Proactively negotiate (offer) once PC is ready
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await sendSignal(targetId, 'offer', offer);
        } catch (e) {
          console.error('❌ createOffer failed for new participant', targetId, e);
        }
      })();
    },
    onParticipantLeft: (id: string) => {
      console.log('👋 participant left:', id);
      const pc = peerConnections.current.get(id);
      if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.close();
        peerConnections.current.delete(id);
      }
      setParticipants(prev => prev.filter(p => p.id !== id));
      iceQueue.current.delete(id);
    },
    onSignalReceived: (signal) => handleSignalReceived(signal),
  });

  // ---- create peer connection ----
  const createPeerConnection = useCallback((targetId: string, currentStream: MediaStream | null) => {
    let pc = peerConnections.current.get(targetId);
    if (pc) return pc;

    console.log('🔗 creating RTCPeerConnection for', targetId);
    pc = new RTCPeerConnection(rtcConfig);

    attachRemoteTrackHandler(pc, targetId);
    addLocalToPCOrTransceive(pc, currentStream);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetId, 'ice', event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`🔄 ${targetId} connectionState:`, pc!.connectionState);
      if (pc!.connectionState === 'failed') {
        console.warn('connection failed; consider ICE restart');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🧊 ${targetId} iceConnectionState:`, pc!.iceConnectionState);
    };

    peerConnections.current.set(targetId, pc);
    // Ensure we have a queue for early ICE
    if (!iceQueue.current.has(targetId)) iceQueue.current.set(targetId, []);
    return pc;
  }, [addLocalToPCOrTransceive, attachRemoteTrackHandler, rtcConfig, sendSignal]);

  // ---- incoming signals ----
  const handleSignalReceived = useCallback(async (signal: any) => {
    const { sender_id, type, payload } = signal;
    try {
      let pc = peerConnections.current.get(sender_id);
      if (!pc) {
        pc = createPeerConnection(sender_id, localStream);
      }

      if (type === 'offer') {
        console.log('📥 offer from', sender_id);
        await pc.setRemoteDescription(payload);
        await flushQueuedIce(sender_id);

        // If local media is available and not yet attached as senders, upgrade directions to sendrecv
        if (localStream) {
          const haveVideoSender = pc.getSenders().some(s => s.track?.kind === 'video');
          const haveAudioSender = pc.getSenders().some(s => s.track?.kind === 'audio');

          // If we had only recvonly transceivers earlier, attach tracks now
          localStream.getTracks().forEach(track => {
            const sameKindSender = pc!.getSenders().find(s => s.track?.kind === track.kind);
            if (!sameKindSender) {
              pc!.addTrack(track, localStream);
            }
          });

          // (Optional) you could also iterate transceivers and set direction = 'sendrecv'
          pc.getTransceivers().forEach(t => {
            if (t.sender && t.sender.track) t.direction = 'sendrecv';
          });

          console.log('senders after attaching:', pc.getSenders().map(s => s.track?.kind));
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(sender_id, 'answer', answer);
      }

      else if (type === 'answer') {
        console.log('📥 answer from', sender_id);
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(payload);
          await flushQueuedIce(sender_id);
        }
      }

      else if (type === 'ice') {
        const candidate: RTCIceCandidateInit = payload;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('addIceCandidate failed (live)', e);
          }
        } else {
          // queue until remoteDescription is set
          const q = iceQueue.current.get(sender_id) ?? [];
          q.push(candidate);
          iceQueue.current.set(sender_id, q);
        }
      }
    } catch (err) {
      console.error(`Error handling ${type} from ${sender_id}`, err);
    }
  }, [createPeerConnection, localStream, flushQueuedIce, sendSignal]);

  // ---- init local media & join room ----
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
          },
        });
        if (cancelled) return;

        setLocalStream(stream);
        await joinRoom();

        const existing = await getExistingParticipants();
        console.log('👥 existing participants:', existing);

        // Ensure roster straight away
        existing.forEach(p => ensureRemoteEntry(p.participant_id, p.display_name));

        // Create/offer to each existing participant
        for (const p of existing) {
          const pc = createPeerConnection(p.participant_id, stream);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await sendSignal(p.participant_id, 'offer', offer);
          } catch (e) {
            console.error('❌ createOffer failed for existing participant', p.participant_id, e);
          }
        }

        toast({ title: 'Connected to meeting', description: `Welcome to room ${roomId}!` });
      } catch (e) {
        console.error('getUserMedia error:', e);
        toast({
          title: 'Camera/microphone access denied',
          description: 'Please allow access to join the video call.',
          variant: 'destructive',
        });
      }
    };

    init();

    return () => {
      cancelled = true;
      leaveRoom();
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
      iceQueue.current.clear();
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]); // keep deps minimal; helpers are stable via useCallback

  // ---- replace media across PCs ----
  const updatePeerConnectionStreams = useCallback(async (newStream: MediaStream) => {
    console.log('🔄 updating all PCs with new stream');
    const entries = Array.from(peerConnections.current.entries());
    await Promise.all(entries.map(async ([id, pc]) => {
      const newTracks = newStream.getTracks();

      // replace existing sender tracks by kind
      for (const kind of ['audio', 'video'] as const) {
        const newTrack = newTracks.find(t => t.kind === kind);
        const sender = pc.getSenders().find(s => s.track?.kind === kind);

        if (sender && newTrack) {
          await sender.replaceTrack(newTrack);
        } else if (!sender && newTrack) {
          pc.addTrack(newTrack, newStream);
        } else if (sender && !newTrack) {
          pc.removeTrack(sender);
        }
      }

      // Negotiate after changes
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(id, 'offer', offer);
      } catch (e) {
        console.error('Renegotiation failed for', id, e);
      }
    }));
  }, [sendSignal]);

  // ---- controls ----
  const handleToggleMute = useCallback(async () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (audioTrack.readyState === 'ended') {
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoOff ? false : true });
        setLocalStream(fresh);
        setIsMuted(false);
        await updatePeerConnectionStreams(fresh);
      } catch (e) {
        console.error('Failed to recreate audio', e);
        toast({ title: 'Microphone error', description: 'Unable to restart microphone.', variant: 'destructive' });
      }
      return;
    }

    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  }, [localStream, isVideoOff, updatePeerConnectionStreams, toast]);

  const handleToggleVideo = useCallback(async () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack && videoTrack.readyState !== 'ended') {
      const next = !videoTrack.enabled;
      videoTrack.enabled = next;
      setIsVideoOff(!next);
      // Not strictly required to renegotiate when just toggling enabled
      return;
    }

    // Need to add/create a new video track
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      const newVideo = cam.getVideoTracks()[0];
      const newStream = new MediaStream([...(localStream.getAudioTracks()), newVideo].filter(Boolean) as MediaStreamTrack[]);
      setLocalStream(newStream);
      setIsVideoOff(false);
      await updatePeerConnectionStreams(newStream);
    } catch (e) {
      console.error('Failed to (re)enable video', e);
      toast({ title: 'Camera error', description: 'Unable to access camera.', variant: 'destructive' });
    }
  }, [localStream, updatePeerConnectionStreams, toast]);

  const handleToggleScreenShare = useCallback(async () => {
    try {
      if (isScreenSharing) {
        // back to camera
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        setLocalStream(cam);
        setIsScreenSharing(false);
        setIsMuted(false);
        setIsVideoOff(false);
        await updatePeerConnectionStreams(cam);
        toast({ title: 'Screen sharing stopped', description: 'Switched back to camera' });
      } else {
        const currentAudio = localStream?.getAudioTracks().find(t => t.readyState === 'live') ?? null;
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

        const combined = new MediaStream();
        display.getVideoTracks().forEach(t => combined.addTrack(t));
        if (currentAudio) {
          combined.addTrack(currentAudio);
        } else {
          try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            mic.getAudioTracks().forEach(t => combined.addTrack(t));
          } catch (e) {
            console.warn('No mic available for screenshare', e);
          }
        }

        setLocalStream(combined);
        setIsScreenSharing(true);
        await updatePeerConnectionStreams(combined);
        toast({ title: 'Screen sharing started', description: 'Your screen is now being shared' });

        display.getVideoTracks()[0].addEventListener('ended', async () => {
          try {
            const cam = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            setLocalStream(cam);
            setIsScreenSharing(false);
            setIsMuted(false);
            setIsVideoOff(false);
            await updatePeerConnectionStreams(cam);
            toast({ title: 'Screen sharing ended', description: 'Switched back to camera' });
          } catch (err) {
            console.error('Error returning to camera after screenshare', err);
          }
        });
      }
    } catch (e) {
      console.error('Screen share error', e);
      toast({ title: 'Screen sharing failed', description: 'Unable to share your screen.', variant: 'destructive' });
    }
  }, [isScreenSharing, localStream, updatePeerConnectionStreams, toast]);

  const handleLeaveCall = useCallback(async () => {
    localStream?.getTracks().forEach(t => t.stop());
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
    iceQueue.current.clear();
    await leaveRoom();
    onLeaveRoom();
  }, [localStream, onLeaveRoom, leaveRoom]);

  // ---- layout helpers ----
  const getGridClass = () => {
    if (pinnedParticipant) return 'video-grid-pinned';
    const total = participants.length + 1;
    if (total === 1) return 'video-grid-single';
    if (total === 2) return 'video-grid-dual';
    return 'video-grid';
  };

  const handlePinParticipant = (id: string) => {
    setPinnedParticipant(pinnedParticipant === id ? null : id);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-video-surface relative">
      {/* Header */}
      <div className="absolute top-6 left-6 z-40">
        <div className="bg-video-surface/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-border">
          <h2 className="text-sm font-medium text-foreground">Meeting: {roomId}</h2>
          <p className="text-xs text-muted-foreground">
            {participants.length + 1} participant{participants.length !== 0 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Grid */}
      <div className="p-6 pt-20">
        <div className={`${getGridClass()} max-w-7xl mx-auto`}>
          {pinnedParticipant ? (
            <>
              {pinnedParticipant === 'local' ? (
                <VideoParticipant
                  stream={localStream || undefined}
                  name={userName}
                  isMuted={isMuted}
                  isVideoOff={isVideoOff}
                  isLocal
                  isPinned
                  onPin={() => handlePinParticipant('local')}
                />
              ) : (
                participants
                  .filter(p => p.id === pinnedParticipant)
                  .map(p => (
                    <VideoParticipant
                      key={p.id}
                      stream={p.stream}
                      name={p.name}
                      isMuted={p.isMuted}
                      isVideoOff={p.isVideoOff}
                      isPinned
                      onPin={() => handlePinParticipant(p.id)}
                    />
                  ))
              )}

              <div className="video-thumbnails">
                {pinnedParticipant !== 'local' && (
                  <VideoParticipant
                    stream={localStream || undefined}
                    name={userName}
                    isMuted={isMuted}
                    isVideoOff={isVideoOff}
                    isLocal
                    isThumbnail
                    onPin={() => handlePinParticipant('local')}
                  />
                )}
                {participants
                  .filter(p => p.id !== pinnedParticipant)
                  .map(p => (
                    <VideoParticipant
                      key={p.id}
                      stream={p.stream}
                      name={p.name}
                      isMuted={p.isMuted}
                      isVideoOff={p.isVideoOff}
                      isThumbnail
                      onPin={() => handlePinParticipant(p.id)}
                    />
                  ))}
              </div>
            </>
          ) : (
            <>
              <VideoParticipant
                stream={localStream || undefined}
                name={userName}
                isMuted={isMuted}
                isVideoOff={isVideoOff}
                isLocal
                onPin={() => handlePinParticipant('local')}
              />
              {participants.map(p => (
                <VideoParticipant
                  key={p.id}
                  stream={p.stream}
                  name={p.name}
                  isMuted={p.isMuted}
                  isVideoOff={p.isVideoOff}
                  onPin={() => handlePinParticipant(p.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <VideoControls
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isScreenSharing={isScreenSharing}
        onToggleMute={handleToggleMute}
        onToggleVideo={handleToggleVideo}
        onToggleScreenShare={handleToggleScreenShare}
        onLeaveCall={handleLeaveCall}
      />
    </div>
  );
};
