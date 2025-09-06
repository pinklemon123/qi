import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://wtscvbbibduvccpudytb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c2N2YmJpYmR1dmNjcHVkeXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxMTk5MjMsImV4cCI6MjA3MjY5NTkyM30.Y12kKHZN8WZPr8u00D7U_n0F3Ix88Rofihj3QAfw_ak";

window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  }
});
