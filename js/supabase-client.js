// /js/supabase-client.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://jmzufmxgcnlxxzcpqlok.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptenVmbXhnY25seHh6Y3BxbG9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcxMjM2NjMsImV4cCI6MjA3MjY5OTY2M30.3yKCYZqoq88xV0_558Nx_g9pCbrvZuP9qSMH3R6G14A";

// 挂到全局给其它脚本用
window.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
