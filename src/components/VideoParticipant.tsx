import { useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, User } from 'lucide-react';

interface VideoParticipantProps {
  stream?: MediaStream;
  name: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isLocal?: boolean;
}

export const VideoParticipant = ({ 
  stream, 
  name, 
  isMuted, 
  isVideoOff, 
  isLocal = false 
}: VideoParticipantProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-surface relative rounded-xl overflow-hidden aspect-video">
      {!isVideoOff && stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isLocal}
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-video-surface flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-primary-foreground" />
            </div>
            <span className="text-foreground font-medium">{name}</span>
          </div>
        </div>
      )}
      
      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
        <div className="flex items-center justify-between">
          <span className="text-white font-medium text-sm">
            {name} {isLocal && '(You)'}
          </span>
          <div className="flex items-center gap-2">
            {isMuted ? (
              <MicOff className="w-4 h-4 text-destructive" />
            ) : (
              <Mic className="w-4 h-4 text-success" />
            )}
            {isVideoOff && (
              <VideoOff className="w-4 h-4 text-destructive" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};