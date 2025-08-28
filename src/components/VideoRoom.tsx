import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoParticipant } from './VideoParticipant';
import { VideoControls } from './VideoControls';
import { useToast } from '@/hooks/use-toast';

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

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const signalingChannel = useRef<BroadcastChannel | null>(null);

  // WebRTC Configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Create peer connection
  const createPeerConnection = useCallback((participantId: string, currentStream: MediaStream | null) => {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Add local stream to peer connection
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        pc.addTrack(track, currentStream);
      });
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setParticipants(prev => 
        prev.map(p => 
          p.id === participantId 
            ? { ...p, stream: remoteStream }
            : p
        )
      );
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && signalingChannel.current) {
        signalingChannel.current.postMessage({
          type: 'ice-candidate',
          candidate: event.candidate,
          from: userName,
          to: participantId,
          roomId
        });
      }
    };

    peerConnections.current.set(participantId, pc);
    return pc;
  }, [userName, roomId]);

  // Initialize local media and signaling
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        
        // Initialize signaling channel
        signalingChannel.current = new BroadcastChannel(`meeting-${roomId}`);
        
        // Handle signaling messages
        signalingChannel.current.onmessage = async (event) => {
          const { type, from, to, roomId: msgRoomId, ...data } = event.data;
          
          // Only process messages for this room and directed to us or broadcast
          if (msgRoomId !== roomId || (to && to !== userName)) return;
          
          switch (type) {
            case 'user-joined':
              if (from !== userName) {
                // Add participant and create offer
                setParticipants(prev => {
                  if (prev.find(p => p.id === from)) return prev;
                  return [...prev, { 
                    id: from, 
                    name: from, 
                    isMuted: false, 
                    isVideoOff: false 
                  }];
                });
                
                // Create offer for new participant
                const pc = createPeerConnection(from, stream);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                signalingChannel.current?.postMessage({
                  type: 'offer',
                  offer,
                  from: userName,
                  to: from,
                  roomId
                });
              }
              break;
              
            case 'offer':
              const pc = createPeerConnection(from, stream);
              await pc.setRemoteDescription(data.offer);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              
              signalingChannel.current?.postMessage({
                type: 'answer',
                answer,
                from: userName,
                to: from,
                roomId
              });
              break;
              
            case 'answer':
              const existingPc = peerConnections.current.get(from);
              if (existingPc) {
                await existingPc.setRemoteDescription(data.answer);
              }
              break;
              
            case 'ice-candidate':
              const candidatePc = peerConnections.current.get(from);
              if (candidatePc) {
                await candidatePc.addIceCandidate(data.candidate);
              }
              break;
              
            case 'user-left':
              const leavingPc = peerConnections.current.get(from);
              if (leavingPc) {
                leavingPc.close();
                peerConnections.current.delete(from);
              }
              setParticipants(prev => prev.filter(p => p.id !== from));
              break;
          }
        };
        
        // Announce joining
        signalingChannel.current.postMessage({
          type: 'user-joined',
          from: userName,
          roomId
        });
        
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
      // Announce leaving
      if (signalingChannel.current) {
        try {
          signalingChannel.current.postMessage({
            type: 'user-left',
            from: userName,
            roomId
          });
        } catch (error) {
          // Channel might already be closed, ignore the error
          console.log('BroadcastChannel already closed');
        }
        signalingChannel.current.close();
      }
      
      // Cleanup
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      peerConnections.current.forEach(pc => pc.close());
    };
  }, [roomId, toast, userName]);

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
        
        if (signalingChannel.current) {
          signalingChannel.current.postMessage({
            type: 'offer',
            offer,
            from: userName,
            to: participantId,
            roomId
          });
        }
      } catch (error) {
        console.error('Error updating peer connection for participant:', participantId, error);
      }
    });
  }, [userName, roomId]);

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
  const handleLeaveCall = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    peerConnections.current.forEach(pc => pc.close());
    onLeaveRoom();
  }, [localStream, onLeaveRoom]);

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