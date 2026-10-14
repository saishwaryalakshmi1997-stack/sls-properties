import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://eeipznbutvklaqfeaclu.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlaXB6bmJ1dHZrbGFxZmVhY2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NTQxNzgsImV4cCI6MjEwNzUzMDE3OH0.it1Aq3anRPQ0wR0Am-dEruZRwVx3gNcvqtFnnug-QVw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
