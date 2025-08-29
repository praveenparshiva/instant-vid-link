-- Fix security warnings by setting search_path for functions
CREATE OR REPLACE FUNCTION public.cleanup_old_signals()
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.signals WHERE created_at < now() - interval '1 hour';
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_participant(p_participant_id TEXT, p_room_id TEXT)
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.participants WHERE participant_id = p_participant_id AND room_id = p_room_id;
  DELETE FROM public.signals WHERE sender_id = p_participant_id AND room_id = p_room_id;
  DELETE FROM public.signals WHERE target_id = p_participant_id AND room_id = p_room_id;
END;
$$;