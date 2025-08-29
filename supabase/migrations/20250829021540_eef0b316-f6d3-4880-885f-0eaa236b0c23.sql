-- Create rooms table
CREATE TABLE public.rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create participants table
CREATE TABLE public.participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(room_id, participant_id)
);

-- Create signals table for WebRTC signaling
CREATE TABLE public.signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  target_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('offer', 'answer', 'ice')),
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for rooms
CREATE POLICY "Anyone can view rooms" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "Anyone can create rooms" ON public.rooms FOR INSERT WITH CHECK (true);

-- RLS Policies for participants
CREATE POLICY "Users can view participants in their room" ON public.participants 
FOR SELECT USING (true);

CREATE POLICY "Users can insert their own participant record" ON public.participants 
FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can delete their own participant record" ON public.participants 
FOR DELETE USING (true);

-- RLS Policies for signals
CREATE POLICY "Users can view signals in their room" ON public.signals 
FOR SELECT USING (true);

CREATE POLICY "Users can insert signals" ON public.signals 
FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can delete old signals" ON public.signals 
FOR DELETE USING (created_at < now() - interval '1 hour');

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;

-- Set replica identity for realtime updates
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.participants REPLICA IDENTITY FULL;
ALTER TABLE public.signals REPLICA IDENTITY FULL;

-- Function to clean up old signals
CREATE OR REPLACE FUNCTION public.cleanup_old_signals()
RETURNS void AS $$
BEGIN
  DELETE FROM public.signals WHERE created_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to remove participant and cleanup
CREATE OR REPLACE FUNCTION public.cleanup_participant(p_participant_id TEXT, p_room_id TEXT)
RETURNS void AS $$
BEGIN
  DELETE FROM public.participants WHERE participant_id = p_participant_id AND room_id = p_room_id;
  DELETE FROM public.signals WHERE sender_id = p_participant_id AND room_id = p_room_id;
  DELETE FROM public.signals WHERE target_id = p_participant_id AND room_id = p_room_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;