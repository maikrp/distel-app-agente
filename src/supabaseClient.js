import { createClient } from "@supabase/supabase-js";

console.log("🔍 Variables de entorno:", import.meta.env);

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
