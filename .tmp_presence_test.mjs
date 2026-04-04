import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const a = createClient(url, key);
const b = createClient(url, key);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function join(client, id, label) {
  const channel = client.channel('aquarium-debug', { config: { presence: { key: id } } });
  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState();
    console.log(label, 'sync', JSON.stringify(state));
  });
  channel.subscribe(async (status) => {
    console.log(label, 'status', status);
    if (status === 'SUBSCRIBED') {
      await channel.track({ name: label, x: 1, y: 2, z: 3, hp: 100, kills: 0, dead: false, color: '#fff' });
    }
  });
  return channel;
}

const aCh = join(a, 'A-' + Math.random().toString(36).slice(2), 'alpha');
const bCh = join(b, 'B-' + Math.random().toString(36).slice(2), 'beta');
await wait(7000);
await aCh.unsubscribe();
await bCh.unsubscribe();
