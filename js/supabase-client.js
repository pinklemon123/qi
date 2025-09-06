import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "你的 Supabase URL";
const SUPABASE_ANON_KEY = "你的 anon key";

window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',         // 关键：改为 implicit，支持跨设备魔法链接
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  }
});
