import { useRef, useEffect } from 'react';
import { Mic, MicOff, Video, VideoOff, User, Pin } from 'lucide-react';

interface VideoParticipantProps {
  stream?: MediaStream;
  name: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isLocal?: boolean;
  isPinned?: boolean;
  isThumbnail?: boolean;
  onPin?: () => void;
}

export const VideoParticipant = ({ 
  stream, 
  name, 
  isMuted, 
  isVideoOff, 
  isLocal = false,
  isPinned = false,
  isThumbnail = false,
  onPin
}: VideoParticipantProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const containerClass = isPinned 
    ? "video-surface-pinned relative rounded-xl overflow-hidden w-full h-full" 
    : isThumbnail 
    ? "video-surface-thumbnail relative rounded-lg overflow-hidden aspect-video cursor-pointer hover:ring-2 hover:ring-primary transition-all"
    : "video-surface relative rounded-xl overflow-hidden aspect-video cursor-pointer group";

  return (
    <div className={containerClass} onClick={isThumbnail ? onPin : undefined}>
      {!isVideoOff && stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isLocal}
          playsInline
          className="w-full h-full object-cover"
          onLoadedMetadata={() => console.log('Video metadata loaded for:', name)}
          onError={(e) => console.error('Video error for:', name, e)}
        />
      ) : (
        <div className="w-full h-full bg-video-surface flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className={`${isThumbnail ? 'w-8 h-8' : 'w-16 h-16'} bg-primary rounded-full flex items-center justify-center`}>
              <User className={`${isThumbnail ? 'w-4 h-4' : 'w-8 h-8'} text-primary-foreground`} />
            </div>
            <span className={`text-foreground font-medium ${isThumbnail ? 'text-xs' : ''}`}>{name}</span>
          </div>
        </div>
      )}
      
      {/* Pin button */}
      {!isThumbnail && onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin();
          }}
          className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Pin className="w-4 h-4" />
        </button>
      )}
      
      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
        <div className="flex items-center justify-between">
          <span className={`text-white font-medium ${isThumbnail ? 'text-xs' : 'text-sm'}`}>
            {name} {isLocal && '(You)'}
          </span>
          <div className="flex items-center gap-2">
            {isMuted ? (
              <MicOff className={`${isThumbnail ? 'w-3 h-3' : 'w-4 h-4'} text-destructive`} />
            ) : (
              <Mic className={`${isThumbnail ? 'w-3 h-3' : 'w-4 h-4'} text-success`} />
            )}
            {isVideoOff && (
              <VideoOff className={`${isThumbnail ? 'w-3 h-3' : 'w-4 h-4'} text-destructive`} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};