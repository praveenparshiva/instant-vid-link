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
  const { toast } = useToast();

  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const participantId = useRef(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`).current;

  // WebRTC Configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Handle signaling - defined first to avoid dependency issues
  const handleSignalReceived = useCallback(async (signal: any) => {
    const { sender_id, type, payload } = signal;
    console.log(`Handling ${type} signal from ${sender_id}:`, payload);
    
    try {
      if (type === 'offer') {
        console.log('Processing offer from:', sender_id);
        let pc = peerConnections.current.get(sender_id);
        if (!pc) {
          // Create new peer connection for incoming offer
          pc = new RTCPeerConnection(rtcConfig);
          
          // Add local stream to peer connection
          if (localStream) {
            console.log('📹 Adding local tracks to incoming offer peer connection for:', sender_id, 'tracks:', localStream.getTracks().length);
            localStream.getTracks().forEach(track => {
              console.log('➕ Adding track:', track.kind, 'enabled:', track.enabled, 'to peer connection for:', sender_id);
              pc!.addTrack(track, localStream);
            });
          } else {
            console.warn('⚠️ No local stream available when processing offer from:', sender_id);
          }

          // Handle incoming stream
          pc.ontrack = (event) => {
            console.log('🎥 Received remote stream from:', sender_id, 'streams:', event.streams.length);
            if (event.streams && event.streams[0]) {
              const [remoteStream] = event.streams;
              console.log('Setting remote stream for participant:', sender_id, 'tracks:', remoteStream.getTracks().length);
              setParticipants(prev => {
                const updated = prev.map(p => 
                  p.id === sender_id 
                    ? { ...p, stream: remoteStream }
                    : p
                );
                console.log('Updated participants with stream:', updated);
                return updated;
              });
            }
          };

          // Handle ICE candidates
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              console.log('Sending ICE candidate to:', sender_id);
              sendSignal(sender_id, 'ice', event.candidate);
            } else {
              console.log('ICE gathering complete for:', sender_id);
            }
          };

          // Handle connection state changes
          pc.onconnectionstatechange = () => {
            console.log(`🔄 Connection state with ${sender_id}:`, pc!.connectionState);
            if (pc!.connectionState === 'failed') {
              console.error('Connection failed with:', sender_id);
            }
          };

          // Handle ICE connection state changes
          pc.oniceconnectionstatechange = () => {
            console.log(`🧊 ICE connection state with ${sender_id}:`, pc!.iceConnectionState);
          };

          peerConnections.current.set(sender_id, pc);
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('Sending answer to:', sender_id);
        await sendSignal(sender_id, 'answer', answer);
      } else if (type === 'answer') {
        console.log('Processing answer from:', sender_id);
        const pc = peerConnections.current.get(sender_id);
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          console.log('Answer set successfully for:', sender_id);
        }
      } else if (type === 'ice') {
        console.log('Processing ICE candidate from:', sender_id);
        const pc = peerConnections.current.get(sender_id);
        if (pc && pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
          console.log('ICE candidate added for:', sender_id);
        }
      }
    } catch (error) {
      console.error(`Error handling ${type} signal from ${sender_id}:`, error);
    }
  }, [localStream]);

  // Create peer connection
  const createPeerConnection = useCallback((targetParticipantId: string, currentStream: MediaStream | null) => {
    console.log('🔗 Creating peer connection for:', targetParticipantId);
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Add local stream to peer connection IMMEDIATELY
    if (currentStream) {
      console.log('📹 Adding local tracks to peer connection for:', targetParticipantId, 'tracks:', currentStream.getTracks().length);
      currentStream.getTracks().forEach(track => {
        console.log('➕ Adding track:', track.kind, 'enabled:', track.enabled, 'to peer connection for:', targetParticipantId);
        pc.addTrack(track, currentStream);
      });
    } else {
      console.warn('⚠️ No local stream available when creating peer connection for:', targetParticipantId);
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
      console.log('🎥 Received remote stream from:', targetParticipantId, 'streams:', event.streams.length);
      if (event.streams && event.streams[0]) {
        const [remoteStream] = event.streams;
        console.log('Setting remote stream for participant:', targetParticipantId, 'tracks:', remoteStream.getTracks().length);
        setParticipants(prev => {
          const updated = prev.map(p => 
            p.id === targetParticipantId 
              ? { ...p, stream: remoteStream }
              : p
          );
          console.log('Updated participants with stream:', updated);
          return updated;
        });
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', targetParticipantId);
        sendSignal(targetParticipantId, 'ice', event.candidate);
      } else {
        console.log('ICE gathering complete for:', targetParticipantId);
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`🔄 Connection state with ${targetParticipantId}:`, pc.connectionState);
      if (pc.connectionState === 'failed') {
        console.error('Connection failed with:', targetParticipantId);
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE connection state with ${targetParticipantId}:`, pc.iceConnectionState);
    };

    peerConnections.current.set(targetParticipantId, pc);
    return pc;
  }, []);

  // Supabase signaling hooks
  const { joinRoom, leaveRoom, sendSignal, getExistingParticipants } = useSupabaseSignaling({
    roomId,
    participantId,
    displayName: userName,
    onParticipantJoined: (participant) => {
      console.log('🙋 New participant joined:', participant);
      setParticipants(prev => {
        if (prev.find(p => p.id === participant.participant_id)) return prev;
        const newParticipants = [...prev, {
          id: participant.participant_id,
          name: participant.display_name,
          isMuted: false,
          isVideoOff: false
        }];
        
        // Create peer connection for new participant if we have local stream
        if (localStream) {
          (async () => {
            console.log('🤝 Creating peer connection for new participant:', participant.participant_id, 'local stream tracks:', localStream.getTracks().length);
            const pc = createPeerConnection(participant.participant_id, localStream);
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true
            });
            await pc.setLocalDescription(offer);
            console.log('📤 Sending offer to new participant:', participant.participant_id, 'offer SDP length:', offer.sdp?.length);
            await sendSignal(participant.participant_id, 'offer', offer);
          })();
        } else {
          console.warn('⚠️ No local stream available for new participant:', participant.participant_id);
        }
        
        return newParticipants;
      });
    },
    onParticipantLeft: (participantId) => {
      console.log('Participant left:', participantId);
      const pc = peerConnections.current.get(participantId);
      if (pc) {
        pc.close();
        peerConnections.current.delete(participantId);
      }
      setParticipants(prev => prev.filter(p => p.id !== participantId));
    },
    onSignalReceived: handleSignalReceived
  });

  // Initialize local media and join room
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        
        // Join room via Supabase
        await joinRoom();
        
        // Get existing participants and create peer connections
        const existingParticipants = await getExistingParticipants();
        console.log('👥 Existing participants:', existingParticipants);
        
        if (existingParticipants.length > 0) {
          setParticipants(existingParticipants.map(p => ({
            id: p.participant_id,
            name: p.display_name,
            isMuted: false,
            isVideoOff: false
          })));
          
          // Create offers for existing participants - ensure stream is ready
          console.log('🎯 Creating peer connections for existing participants with stream tracks:', stream.getTracks().length);
          for (const participant of existingParticipants) {
            console.log('🚀 Creating offer for existing participant:', participant.participant_id);
            const pc = createPeerConnection(participant.participant_id, stream);
            
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true
            });
            await pc.setLocalDescription(offer);
            console.log('📤 Sending offer to existing participant:', participant.participant_id, 'offer SDP length:', offer.sdp?.length);
            await sendSignal(participant.participant_id, 'offer', offer);
          }
        }
        
        toast({
          title: "Connected to meeting",
          description: `Welcome to room ${roomId}!`,
        });
      } catch (error) {
        console.error('Error accessing media devices:', error);
        toast({
          title: "Camera/microphone access denied",
          description: "Please allow access to join the video call.",
          variant: "destructive",
        });
      }
    };

    initializeMedia();

    return () => {
      // Cleanup
      leaveRoom();
      
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
    };
  }, [roomId, toast, userName, createPeerConnection, joinRoom, leaveRoom, getExistingParticipants, sendSignal]);

  // Toggle mute
  const handleToggleMute = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, [localStream]);

  // Toggle video
  const handleToggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  }, [localStream]);

  // Update all peer connections with new stream
  const updatePeerConnectionStreams = useCallback((newStream: MediaStream) => {
    peerConnections.current.forEach(async (pc, participantId) => {
      try {
        // Remove old tracks
        const senders = pc.getSenders();
        for (const sender of senders) {
          if (sender.track) {
            pc.removeTrack(sender);
          }
        }
        
        // Add new tracks
        newStream.getTracks().forEach(track => {
          pc.addTrack(track, newStream);
        });

        // Create and send new offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(participantId, 'offer', offer);
      } catch (error) {
        console.error('Error updating peer connection for participant:', participantId, error);
      }
    });
  }, [sendSignal]);

  // Screen sharing
  const handleToggleScreenShare = useCallback(async () => {
    try {
      if (isScreenSharing) {
        // Stop screen sharing, return to camera
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        setIsScreenSharing(false);
        setIsMuted(false);
        setIsVideoOff(false);
        
        // Update all peer connections with camera stream
        updatePeerConnectionStreams(stream);
        
        toast({
          title: "Screen sharing stopped",
          description: "Switched back to camera",
        });
      } else {
        // Start screen sharing
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }
        
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false, // Don't capture system audio by default
        });
        setLocalStream(screenStream);
        setIsScreenSharing(true);
        
        // Update all peer connections with screen share stream
        updatePeerConnectionStreams(screenStream);
        
        toast({
          title: "Screen sharing started",
          description: "Your screen is now being shared",
        });

        // Handle screen share ending (when user clicks "Stop sharing" in browser)
        screenStream.getVideoTracks()[0].addEventListener('ended', async () => {
          console.log('Screen sharing ended by user');
          try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
            setLocalStream(cameraStream);
            setIsScreenSharing(false);
            setIsMuted(false);
            setIsVideoOff(false);
            
            // Update all peer connections with camera stream
            updatePeerConnectionStreams(cameraStream);
            
            toast({
              title: "Screen sharing ended",
              description: "Switched back to camera",
            });
          } catch (error) {
            console.error('Error returning to camera after screen share ended:', error);
          }
        });
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      toast({
        title: "Screen sharing failed",
        description: "Unable to share your screen. Please try again.",
        variant: "destructive",
      });
    }
  }, [isScreenSharing, localStream, updatePeerConnectionStreams, toast]);

  // Leave call
  const handleLeaveCall = useCallback(async () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.current.forEach(pc => pc.close());
    await leaveRoom();
    onLeaveRoom();
  }, [localStream, onLeaveRoom, leaveRoom]);

  // Calculate grid layout class
  const getGridClass = () => {
    const totalParticipants = participants.length + 1; // +1 for local user
    if (totalParticipants === 1) return 'video-grid-single';
    if (totalParticipants === 2) return 'video-grid-dual';
    return 'video-grid';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-video-surface relative">
      {/* Meeting Header */}
      <div className="absolute top-6 left-6 z-40">
        <div className="bg-video-surface/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-border">
          <h2 className="text-sm font-medium text-foreground">
            Meeting: {roomId}
          </h2>
          <p className="text-xs text-muted-foreground">
            {participants.length + 1} participant{participants.length !== 0 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Video Grid */}
      <div className="p-6 pt-20">
        <div className={`${getGridClass()} max-w-7xl mx-auto`}>
          {/* Local video */}
          <VideoParticipant
            stream={localStream || undefined}
            name={userName}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            isLocal={true}
          />
          
          {/* Remote participants */}
          {participants.map((participant) => (
            <VideoParticipant
              key={participant.id}
              stream={participant.stream}
              name={participant.name}
              isMuted={participant.isMuted}
              isVideoOff={participant.isVideoOff}
            />
          ))}
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