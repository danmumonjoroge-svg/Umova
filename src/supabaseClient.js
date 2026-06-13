// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL     = "https://tejzcwftbvcojvpczxbm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlanpjd2Z0YnZjb2p2cGN6eGJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDMyNzgsImV4cCI6MjA4ODYxOTI3OH0.1EnpfkK8q81Tc4pludB5qH22pIF8GvJos_E05yTH_S8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage:          window.sessionStorage,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,
  },
});