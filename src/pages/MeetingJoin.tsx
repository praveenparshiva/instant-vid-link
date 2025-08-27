import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Video, Users, Shield, Zap } from 'lucide-react';

export const MeetingJoin = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState(searchParams.get('room') || '');
  const [userName, setUserName] = useState('');

  const handleJoinMeeting = () => {
    if (roomId.trim() && userName.trim()) {
      navigate(`/room?id=${encodeURIComponent(roomId)}&name=${encodeURIComponent(userName)}`);
    }
  };

  const handleCreateMeeting = () => {
    const newRoomId = Math.random().toString(36).substring(2, 12);
    setRoomId(newRoomId);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJoinMeeting();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-video-surface flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        
        {/* Logo and Title */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-6">
            <Video className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            QuickMeet
          </h1>
          <p className="text-muted-foreground">
            Instant video meetings and screen sharing.
          </p>
        </div>

        {/* Join Form */}
        <Card className="p-6 bg-video-surface border-border">
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="roomId" className="text-sm font-medium text-foreground">
                Room ID
              </label>
              <div className="flex gap-2">
                <Input
                  id="roomId"
                  type="text"
                  placeholder="Enter room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 bg-background border-border"
                />
                <Button 
                  variant="outline" 
                  onClick={handleCreateMeeting}
                  className="whitespace-nowrap"
                >
                  New Room
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="userName" className="text-sm font-medium text-foreground">
                Your Name
              </label>
              <Input
                id="userName"
                type="text"
                placeholder="Enter your name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                onKeyPress={handleKeyPress}
                className="bg-background border-border"
              />
            </div>

            <Button
              onClick={handleJoinMeeting}
              disabled={!roomId.trim() || !userName.trim()}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              size="lg"
            >
              Join Meeting
            </Button>
          </div>
        </Card>

        {/* Features */}
        <div className="grid grid-cols-1 gap-4 text-center">
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <Users className="w-4 h-4 text-primary" />
            Small group meetings
          </div>
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-accent" />
            No registration required
          </div>
          <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <Zap className="w-4 h-4 text-warning" />
            Low latency & stable
          </div>
        </div>

        {/* Quick Join with URL */}
        {searchParams.get('room') && (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              You were invited to join this meeting
            </p>
            <div className="text-xs bg-video-surface p-3 rounded-lg border border-border font-mono">
              Room: {searchParams.get('room')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};