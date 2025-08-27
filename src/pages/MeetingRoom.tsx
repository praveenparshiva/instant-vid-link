import { useSearchParams, useNavigate } from 'react-router-dom';
import { VideoRoom } from '@/components/VideoRoom';

export const MeetingRoom = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const roomId = searchParams.get('id');
  const userName = searchParams.get('name');

  // Redirect if missing required params
  if (!roomId || !userName) {
    navigate('/');
    return null;
  }

  const handleLeaveRoom = () => {
    navigate('/');
  };

  return (
    <VideoRoom
      roomId={roomId}
      userName={userName}
      onLeaveRoom={handleLeaveRoom}
    />
  );
};