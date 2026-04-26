CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room text NOT NULL DEFAULT 'work',
  sender text NOT NULL,
  color text NOT NULL DEFAULT '#70a1ff',
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read chat messages"
  ON public.chat_messages FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert chat messages"
  ON public.chat_messages FOR INSERT
  WITH CHECK (true);

CREATE INDEX chat_messages_room_created_idx
  ON public.chat_messages (room, created_at DESC);