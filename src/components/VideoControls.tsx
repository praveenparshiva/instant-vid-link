import { Mic, MicOff, Video, VideoOff, Monitor, Phone, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VideoControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveCall: () => void;
  onSettings?: () => void;
}

export const VideoControls = ({
  isMuted,
  isVideoOff,
  isScreenSharing,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveCall,
  onSettings
}: VideoControlsProps) => {
  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
      <div className="control-bar rounded-2xl px-6 py-4">
        <div className="flex items-center gap-4">
          {/* Mute/Unmute */}
          <button
            onClick={onToggleMute}
            className={`btn-control ${isMuted ? 'danger' : ''}`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {/* Video On/Off */}
          <button
            onClick={onToggleVideo}
            className={`btn-control ${isVideoOff ? 'danger' : ''}`}
            title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
          >
            {isVideoOff ? (
              <VideoOff className="w-5 h-5" />
            ) : (
              <Video className="w-5 h-5" />
            )}
          </button>

          {/* Screen Share */}
          <button
            onClick={onToggleScreenShare}
            className={`btn-control ${isScreenSharing ? 'active' : ''}`}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
          >
            <Monitor className="w-5 h-5" />
          </button>

          {/* Separator */}
          <div className="w-px h-8 bg-border mx-2" />

          {/* Settings (Optional) */}
          {onSettings && (
            <button
              onClick={onSettings}
              className="btn-control"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          {/* Leave Call */}
          <button
            onClick={onLeaveCall}
            className="btn-control danger"
            title="Leave call"
          >
            <Phone className="w-5 h-5 rotate-[135deg]" />
          </button>
        </div>
      </div>
    </div>
  );
};