import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoParticipant } from './VideoParticipant';
import { VideoControls } from './VideoControls';
import { useToast } from '@/hooks/use-toast';
import { io, Socket } from 'socket.io-client';

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
  const socket = useRef<Socket | null>(null);

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
      console.log('Received remote stream from:', participantId);
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
      if (event.candidate && socket.current) {
        socket.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: participantId
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${participantId}:`, pc.connectionState);
    };

    peerConnections.current.set(participantId, pc);
    return pc;
  }, []);

  // Initialize local media and signaling
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        
        // Connect to signaling server
        socket.current = io('http://localhost:3001');
        
        // Join room
        socket.current.emit('join-room', { roomId, userName });
        
        // Handle existing participants
        socket.current.on('existing-participants', (existingParticipants) => {
          console.log('Existing participants:', existingParticipants);
          setParticipants(existingParticipants.map(p => ({
            id: p.id,
            name: p.name,
            isMuted: false,
            isVideoOff: false
          })));
          
          // Create offers for existing participants
          existingParticipants.forEach(async (participant) => {
            const pc = createPeerConnection(participant.id, stream);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            socket.current?.emit('offer', {
              offer,
              to: participant.id
            });
          });
        });
        
        // Handle new user joining
        socket.current.on('user-joined', (data) => {
          console.log('User joined:', data);
          setParticipants(prev => {
            if (prev.find(p => p.id === data.id)) return prev;
            return [...prev, { 
              id: data.id, 
              name: data.name, 
              isMuted: false, 
              isVideoOff: false 
            }];
          });
        });
        
        // Handle WebRTC signaling
        socket.current.on('offer', async (data) => {
          console.log('Received offer from:', data.from);
          const pc = createPeerConnection(data.from, stream);
          await pc.setRemoteDescription(data.offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          
          socket.current?.emit('answer', {
            answer,
            to: data.from
          });
        });
        
        socket.current.on('answer', async (data) => {
          console.log('Received answer from:', data.from);
          const pc = peerConnections.current.get(data.from);
          if (pc) {
            await pc.setRemoteDescription(data.answer);
          }
        });
        
        socket.current.on('ice-candidate', async (data) => {
          console.log('Received ICE candidate from:', data.from);
          const pc = peerConnections.current.get(data.from);
          if (pc) {
            await pc.addIceCandidate(data.candidate);
          }
        });
        
        socket.current.on('user-left', (data) => {
          console.log('User left:', data);
          const pc = peerConnections.current.get(data.id);
          if (pc) {
            pc.close();
            peerConnections.current.delete(data.id);
          }
          setParticipants(prev => prev.filter(p => p.id !== data.id));
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
      // Cleanup
      if (socket.current) {
        socket.current.disconnect();
      }
      
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      peerConnections.current.forEach(pc => pc.close());
      peerConnections.current.clear();
    };
  }, [roomId, toast, userName, createPeerConnection]);

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
        
        if (socket.current) {
          socket.current.emit('offer', {
            offer,
            to: participantId
          });
        }
      } catch (error) {
        console.error('Error updating peer connection for participant:', participantId, error);
      }
    });
  }, []);

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