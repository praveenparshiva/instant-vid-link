import { useSearchParams, useNavigate } from 'react-router-dom';
import { VideoRoom } from '@/components/VideoRoom';
import { useEffect, useState } from 'react';

export const MeetingRoom = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  
  const roomId = searchParams.get('id');
  const userName = searchParams.get('name');

  useEffect(() => {
    // Add a small delay to ensure proper initialization
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Show loading state briefly to prevent redirect flicker
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-video-surface flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Joining meeting...</p>
        </div>
      </div>
    );
  }

  // Redirect if missing required params
  if (!roomId || !userName) {
    console.log('Missing params, redirecting to home. RoomId:', roomId, 'UserName:', userName);
    navigate('/', { replace: true });
    return null;
  }

  const handleLeaveRoom = () => {
    navigate('/', { replace: true });
  };

  return (
    <VideoRoom
      roomId={roomId}
      userName={userName}
      onLeaveRoom={handleLeaveRoom}
    />
  );
};