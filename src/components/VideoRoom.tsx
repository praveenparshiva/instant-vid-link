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

  // Supabase signaling hooks
  const { joinRoom, leaveRoom, sendSignal, getExistingParticipants } = useSupabaseSignaling({
    roomId,
    participantId,
    displayName: userName,
    onParticipantJoined: (participant) => {
      console.log('New participant joined:', participant);
      setParticipants(prev => {
        if (prev.find(p => p.id === participant.participant_id)) return prev;
        return [...prev, {
          id: participant.participant_id,
          name: participant.display_name,
          isMuted: false,
          isVideoOff: false
        }];
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

  // Handle signaling
  async function handleSignalReceived(signal: any) {
    const { sender_id, type, payload } = signal;
    
    try {
      if (type === 'offer') {
        const pc = createPeerConnection(sender_id, localStream);
        await pc.setRemoteDescription(payload);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(sender_id, 'answer', answer);
      } else if (type === 'answer') {
        const pc = peerConnections.current.get(sender_id);
        if (pc) {
          await pc.setRemoteDescription(payload);
        }
      } else if (type === 'ice') {
        const pc = peerConnections.current.get(sender_id);
        if (pc) {
          await pc.addIceCandidate(payload);
        }
      }
    } catch (error) {
      console.error('Error handling signal:', error);
    }
  }

  // Create peer connection
  const createPeerConnection = useCallback((targetParticipantId: string, currentStream: MediaStream | null) => {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Add local stream to peer connection
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        pc.addTrack(track, currentStream);
      });
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
      console.log('Received remote stream from:', targetParticipantId);
      const [remoteStream] = event.streams;
      setParticipants(prev => 
        prev.map(p => 
          p.id === targetParticipantId 
            ? { ...p, stream: remoteStream }
            : p
        )
      );
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetParticipantId, 'ice', event.candidate);
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${targetParticipantId}:`, pc.connectionState);
    };

    peerConnections.current.set(targetParticipantId, pc);
    return pc;
  }, [sendSignal]);

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
        console.log('Existing participants:', existingParticipants);
        
        if (existingParticipants.length > 0) {
          setParticipants(existingParticipants.map(p => ({
            id: p.participant_id,
            name: p.display_name,
            isMuted: false,
            isVideoOff: false
          })));
          
          // Create offers for existing participants
          for (const participant of existingParticipants) {
            const pc = createPeerConnection(participant.participant_id, stream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
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