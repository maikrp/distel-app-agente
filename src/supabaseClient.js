// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://plarayywtxedbiotsmmd.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYXJheXl3dHhlZGJpb3RzbW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxMzQ0NTQsImV4cCI6MjA3MzcxMDQ1NH0.s585WUBDWj9F3O9r5c_mzUTdPGbpSFhez2FgJhyya9w";

export const supabase = createClient(supabaseUrl, supabaseKey);
