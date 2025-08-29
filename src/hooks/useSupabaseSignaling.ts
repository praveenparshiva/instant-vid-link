import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

interface Participant {
  id: string;
  room_id: string;
  participant_id: string;
  display_name: string;
  joined_at: string;
}

interface Signal {
  id: string;
  room_id: string;
  sender_id: string;
  target_id: string | null;
  type: 'offer' | 'answer' | 'ice';
  payload: any;
  created_at: string;
}

interface UseSupabaseSignalingProps {
  roomId: string;
  participantId: string;
  displayName: string;
  onParticipantJoined: (participant: Participant) => void;
  onParticipantLeft: (participantId: string) => void;
  onSignalReceived: (signal: Signal) => void;
}

export const useSupabaseSignaling = ({
  roomId,
  participantId,
  displayName,
  onParticipantJoined,
  onParticipantLeft,
  onSignalReceived
}: UseSupabaseSignalingProps) => {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isJoined = useRef(false);

  // Join room by inserting participant record
  const joinRoom = useCallback(async () => {
    if (isJoined.current) return;

    try {
      // Insert or update room
      await supabase
        .from('rooms')
        .upsert([{ room_id: roomId, name: `Room ${roomId}` }], { onConflict: 'room_id' });

      // Insert participant
      const { error } = await supabase
        .from('participants')
        .insert([{
          room_id: roomId,
          participant_id: participantId,
          display_name: displayName
        }]);

      if (error && !error.message.includes('duplicate')) {
        throw error;
      }

      isJoined.current = true;
      console.log('Joined room:', roomId);
    } catch (error) {
      console.error('Error joining room:', error);
    }
  }, [roomId, participantId, displayName]);

  // Leave room by removing participant record
  const leaveRoom = useCallback(async () => {
    if (!isJoined.current) return;

    try {
      await supabase.rpc('cleanup_participant', {
        p_participant_id: participantId,
        p_room_id: roomId
      });
      
      isJoined.current = false;
      console.log('Left room:', roomId);
    } catch (error) {
      console.error('Error leaving room:', error);
    }
  }, [roomId, participantId]);

  // Send signal
  const sendSignal = useCallback(async (targetId: string | null, type: 'offer' | 'answer' | 'ice', payload: any) => {
    try {
      await supabase
        .from('signals')
        .insert([{
          room_id: roomId,
          sender_id: participantId,
          target_id: targetId,
          type,
          payload
        }]);
    } catch (error) {
      console.error('Error sending signal:', error);
    }
  }, [roomId, participantId]);

  // Get existing participants
  const getExistingParticipants = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('participants')
        .select('*')
        .eq('room_id', roomId)
        .neq('participant_id', participantId);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching participants:', error);
      return [];
    }
  }, [roomId, participantId]);

  // Setup realtime subscriptions
  useEffect(() => {
    const channel = supabase.channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'participants',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const participant = payload.new as Participant;
          if (participant.participant_id !== participantId) {
            console.log('Participant joined:', participant);
            onParticipantJoined(participant);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'participants',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const participant = payload.old as Participant;
          if (participant.participant_id !== participantId) {
            console.log('Participant left:', participant);
            onParticipantLeft(participant.participant_id);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signals',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const signal = payload.new as Signal;
          if (signal.sender_id !== participantId && 
              (signal.target_id === participantId || signal.target_id === null)) {
            console.log('Signal received:', signal);
            onSignalReceived(signal);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, participantId, onParticipantJoined, onParticipantLeft, onSignalReceived]);

  return {
    joinRoom,
    leaveRoom,
    sendSignal,
    getExistingParticipants
  };
};