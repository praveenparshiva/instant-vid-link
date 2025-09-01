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
          
          // CRITICAL: Set up ontrack handler FIRST
          pc.ontrack = (event) => {
            console.log('🎥 Received remote stream from:', sender_id, 'streams:', event.streams.length);
            if (event.streams && event.streams[0]) {
              const [remoteStream] = event.streams;
              console.log('🎯 Setting remote stream for participant:', sender_id, 'tracks:', remoteStream.getTracks().length);
              
              // Log track details for debugging
              remoteStream.getTracks().forEach(track => {
                console.log(`📡 Remote ${track.kind} track:`, track.id, 'enabled:', track.enabled, 'muted:', track.muted, 'state:', track.readyState);
              });
              
              setParticipants(prev => {
                const updated = prev.map(p => 
                  p.id === sender_id 
                    ? { ...p, stream: remoteStream }
                    : p
                );
                console.log('✅ Updated participants with stream:', updated.find(p => p.id === sender_id));
                return updated;
              });
            } else {
              console.warn('⚠️ No stream received in track event from:', sender_id);
            }
          };
          
          // Add local stream to peer connection AFTER setting up handlers
          if (localStream && localStream.getTracks().length > 0) {
            console.log('📹 Adding local tracks to incoming offer peer connection for:', sender_id, 'tracks:', localStream.getTracks().length);
            localStream.getTracks().forEach(track => {
              if (track.readyState === 'live') {
                console.log('➕ Adding live track:', track.kind, 'enabled:', track.enabled, 'to peer connection for:', sender_id);
                pc!.addTrack(track, localStream);
              } else {
                console.warn('⚠️ Skipping dead track:', track.kind, 'state:', track.readyState);
              }
            });
          } else {
            console.warn('⚠️ No local stream or tracks available when processing offer from:', sender_id);
          }

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
    
    // CRITICAL: Set up ontrack handler FIRST before adding any tracks
    pc.ontrack = (event) => {
      console.log('🎥 Received remote stream from:', targetParticipantId, 'streams:', event.streams.length);
      if (event.streams && event.streams[0]) {
        const [remoteStream] = event.streams;
        console.log('🎯 Setting remote stream for participant:', targetParticipantId, 'tracks:', remoteStream.getTracks().length);
        
        // Force immediate update of participant stream
        setParticipants(prev => {
          const updated = prev.map(p => 
            p.id === targetParticipantId 
              ? { ...p, stream: remoteStream }
              : p
          );
          console.log('✅ Updated participants with stream:', updated.find(p => p.id === targetParticipantId));
          return updated;
        });
      } else {
        console.warn('⚠️ No stream received in track event from:', targetParticipantId);
      }
    };
    
    // Add local stream to peer connection AFTER setting up handlers
    if (currentStream && currentStream.getTracks().length > 0) {
      console.log('📹 Adding local tracks to peer connection for:', targetParticipantId, 'tracks:', currentStream.getTracks().length);
      currentStream.getTracks().forEach(track => {
        if (track.readyState === 'live') {
          console.log('➕ Adding live track:', track.kind, 'enabled:', track.enabled, 'to peer connection for:', targetParticipantId);
          pc.addTrack(track, currentStream);
        } else {
          console.warn('⚠️ Skipping dead track:', track.kind, 'state:', track.readyState);
        }
      });
    } else {
      console.warn('⚠️ No local stream or tracks available when creating peer connection for:', targetParticipantId);
    }

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
        if (localStream && localStream.getTracks().length > 0) {
          // Small delay to ensure stream is ready
          setTimeout(async () => {
            console.log('🤝 Creating peer connection for new participant:', participant.participant_id, 'local stream tracks:', localStream.getTracks().length);
            const pc = createPeerConnection(participant.participant_id, localStream);
            
            // Create offer with explicit constraints
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
              iceRestart: false
            });
            await pc.setLocalDescription(offer);
            console.log('📤 Sending offer to new participant:', participant.participant_id, 'tracks in offer:', pc.getSenders().length);
            await sendSignal(participant.participant_id, 'offer', offer);
          }, 100);
        } else {
          console.warn('⚠️ No local stream or tracks available for new participant:', participant.participant_id);
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
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1
          },
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
          // Add delay to ensure stream tracks are fully ready
          setTimeout(async () => {
            for (const participant of existingParticipants) {
              try {
                console.log('🚀 Creating offer for existing participant:', participant.participant_id);
                const pc = createPeerConnection(participant.participant_id, stream);
                
                const offer = await pc.createOffer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true,
                  iceRestart: false
                });
                await pc.setLocalDescription(offer);
                console.log('📤 Sending offer to existing participant:', participant.participant_id, 'tracks in offer:', pc.getSenders().length);
                await sendSignal(participant.participant_id, 'offer', offer);
              } catch (error) {
                console.error('❌ Failed to create offer for existing participant:', participant.participant_id, error);
              }
            }
          }, 300);
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

  // Update all peer connections with new stream
  const updatePeerConnectionStreams = useCallback(async (newStream: MediaStream) => {
    console.log('🔄 Updating peer connections with new stream, tracks:', newStream.getTracks().length);
    
    const updatePromises = Array.from(peerConnections.current.entries()).map(async ([participantId, pc]) => {
      try {
        // Remove old tracks using replaceTrack when possible, otherwise remove and add
        const senders = pc.getSenders();
        const newTracks = newStream.getTracks();
        
        // Replace existing tracks with new ones
        for (const sender of senders) {
          if (sender.track) {
            const newTrack = newTracks.find(track => track.kind === sender.track!.kind);
            if (newTrack) {
              console.log('🔄 Replacing track:', sender.track.kind, 'for participant:', participantId);
              await sender.replaceTrack(newTrack);
            } else {
              console.log('🗑️ Removing track:', sender.track.kind, 'for participant:', participantId);
              pc.removeTrack(sender);
            }
          }
        }
        
        // Add any new tracks that don't have senders
        for (const track of newTracks) {
          const existingSender = senders.find(sender => sender.track?.kind === track.kind);
          if (!existingSender) {
            console.log('➕ Adding new track:', track.kind, 'enabled:', track.enabled, 'to participant:', participantId);
            pc.addTrack(track, newStream);
          }
        }

        // Always renegotiate to ensure changes are communicated
        console.log('🤝 Renegotiating with participant:', participantId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(participantId, 'offer', offer);
        
      } catch (error) {
        console.error('Error updating peer connection for participant:', participantId, error);
      }
    });
    
    await Promise.all(updatePromises);
  }, [sendSignal]);

  // Toggle mute
  const handleToggleMute = useCallback(async () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        // Check if track is stopped
        if (audioTrack.readyState === 'ended') {
          console.log('Audio track was stopped, recreating stream...');
          try {
            // Create new stream
            const newStream = await navigator.mediaDevices.getUserMedia({
              video: !isVideoOff ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
              } : false,
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
              },
            });
            
            setLocalStream(newStream);
            setIsMuted(false);
            
            // Update all peer connections
            await updatePeerConnectionStreams(newStream);
          } catch (error) {
            console.error('Error recreating audio stream:', error);
            toast({
              title: "Microphone error",
              description: "Unable to restart microphone. Please check permissions.",
              variant: "destructive",
            });
          }
        } else {
          // Simply toggle the track enabled state
          audioTrack.enabled = !audioTrack.enabled;
          setIsMuted(!audioTrack.enabled);
          console.log('🎤 Audio track toggled:', audioTrack.enabled ? 'enabled' : 'disabled');
        }
      }
    }
  }, [localStream, isVideoOff, updatePeerConnectionStreams, toast]);

  // Toggle video
  const handleToggleVideo = useCallback(async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      
      if (videoTrack && videoTrack.readyState === 'ended') {
        // Track is stopped, need to recreate stream
        console.log('Video track was stopped, recreating stream...');
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 }
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1
            },
          });
          
          setLocalStream(newStream);
          setIsVideoOff(false);
          
          // Update all peer connections with new stream
          await updatePeerConnectionStreams(newStream);
          
          toast({
            title: "Camera reactivated",
            description: "Your camera is now working again",
          });
        } catch (error) {
          console.error('Error recreating video stream:', error);
          toast({
            title: "Camera error",
            description: "Unable to restart camera. Please check permissions.",
            variant: "destructive",
          });
        }
      } else if (videoTrack) {
        // Track exists and is active, just toggle enabled state
        const newVideoState = !videoTrack.enabled;
        videoTrack.enabled = newVideoState;
        setIsVideoOff(!newVideoState);
        
        console.log('📹 Video track toggled:', newVideoState ? 'enabled' : 'disabled');
        
        // Force renegotiation to ensure remote participants see the change
        await updatePeerConnectionStreams(localStream);
      } else {
        // No video track exists, create one
        console.log('No video track found, creating new stream...');
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 }
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1
            },
          });
          
          setLocalStream(newStream);
          setIsVideoOff(false);
          
          await updatePeerConnectionStreams(newStream);
        } catch (error) {
          console.error('Error creating video stream:', error);
          toast({
            title: "Camera error", 
            description: "Unable to access camera. Please check permissions.",
            variant: "destructive",
          });
        }
      }
    }
  }, [localStream, isMuted, updatePeerConnectionStreams, toast]);

  // Screen sharing
  const handleToggleScreenShare = useCallback(async () => {
    try {
      if (isScreenSharing) {
        // Stop screen sharing, return to camera
        if (localStream) {
          localStream.getTracks().forEach(track => track.stop());
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1
          },
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
        // Start screen sharing - KEEP MICROPHONE AUDIO
        const currentAudioTrack = localStream ? localStream.getAudioTracks()[0] : null;
        
        if (localStream) {
          // Only stop video tracks, keep audio
          localStream.getVideoTracks().forEach(track => track.stop());
        }
        
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false, // We'll keep the existing microphone audio
        });
        
        // Create combined stream with screen video + microphone audio
        const combinedStream = new MediaStream();
        
        // Add screen video track
        screenStream.getVideoTracks().forEach(track => {
          combinedStream.addTrack(track);
        });
        
        // Add existing microphone audio track or create new one
        if (currentAudioTrack && currentAudioTrack.readyState === 'live') {
          console.log('🎤 Keeping existing microphone audio during screen share');
          combinedStream.addTrack(currentAudioTrack);
        } else {
          console.log('🎤 Creating new microphone audio for screen share');
          try {
            const micStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
              }
            });
            micStream.getAudioTracks().forEach(track => {
              combinedStream.addTrack(track);
            });
          } catch (audioError) {
            console.warn('⚠️ Could not get microphone for screen share:', audioError);
          }
        }
        
        setLocalStream(combinedStream);
        setIsScreenSharing(true);
        
        // Update all peer connections with combined stream
        updatePeerConnectionStreams(combinedStream);
        
        toast({
          title: "Screen sharing started",
          description: "Your screen is now being shared",
        });

        // Handle screen share ending (when user clicks "Stop sharing" in browser)
        screenStream.getVideoTracks()[0].addEventListener('ended', async () => {
          console.log('Screen sharing ended by user');
          try {
            const cameraStream = await navigator.mediaDevices.getUserMedia({
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
              },
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
              },
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
    if (pinnedParticipant) return 'video-grid-pinned';
    const totalParticipants = participants.length + 1; // +1 for local user
    if (totalParticipants === 1) return 'video-grid-single';
    if (totalParticipants === 2) return 'video-grid-dual';
    return 'video-grid';
  };

  // Handle pin/unpin participant
  const handlePinParticipant = (participantId: string) => {
    setPinnedParticipant(pinnedParticipant === participantId ? null : participantId);
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
          {pinnedParticipant ? (
            <>
              {/* Pinned participant (full screen) */}
              {pinnedParticipant === 'local' ? (
                <VideoParticipant
                  stream={localStream || undefined}
                  name={userName}
                  isMuted={isMuted}
                  isVideoOff={isVideoOff}
                  isLocal={true}
                  isPinned={true}
                  onPin={() => handlePinParticipant('local')}
                />
              ) : (
                participants
                  .filter(p => p.id === pinnedParticipant)
                  .map((participant) => (
                    <VideoParticipant
                      key={participant.id}
                      stream={participant.stream}
                      name={participant.name}
                      isMuted={participant.isMuted}
                      isVideoOff={participant.isVideoOff}
                      isPinned={true}
                      onPin={() => handlePinParticipant(participant.id)}
                    />
                  ))
              )}
              
              {/* Thumbnail grid for other participants */}
              <div className="video-thumbnails">
                {pinnedParticipant !== 'local' && (
                  <VideoParticipant
                    stream={localStream || undefined}
                    name={userName}
                    isMuted={isMuted}
                    isVideoOff={isVideoOff}
                    isLocal={true}
                    isThumbnail={true}
                    onPin={() => handlePinParticipant('local')}
                  />
                )}
                {participants
                  .filter(p => p.id !== pinnedParticipant)
                  .map((participant) => (
                    <VideoParticipant
                      key={participant.id}
                      stream={participant.stream}
                      name={participant.name}
                      isMuted={participant.isMuted}
                      isVideoOff={participant.isVideoOff}
                      isThumbnail={true}
                      onPin={() => handlePinParticipant(participant.id)}
                    />
                  ))}
              </div>
            </>
          ) : (
            <>
              {/* Local video */}
              <VideoParticipant
                stream={localStream || undefined}
                name={userName}
                isMuted={isMuted}
                isVideoOff={isVideoOff}
                isLocal={true}
                onPin={() => handlePinParticipant('local')}
              />
              
              {/* Remote participants */}
              {participants.map((participant) => (
                <VideoParticipant
                  key={participant.id}
                  stream={participant.stream}
                  name={participant.name}
                  isMuted={participant.isMuted}
                  isVideoOff={participant.isVideoOff}
                  onPin={() => handlePinParticipant(participant.id)}
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