ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS system BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created
  ON public.chat_messages(room, created_at DESC);
