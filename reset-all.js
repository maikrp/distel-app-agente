import { createClient } from '@supabase/supabase-js';

// === CONFIGURACIÓN ===
const SUPABASE_URL = 'https://plarayywtxedbiotsmmd.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYXJheXl3dHhlZGJpb3RzbW1kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODEzNDQ1NCwiZXhwIjoyMDczNzEwNDU0fQ.IUPp46RID_hzBLeIutw2Vw0ESZQcjEq_iHWqAkf2eaM';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log('🔍 Leyendo agentes...');
  
  const { data: agentes, error: err1 } = await supabase
    .from('agentes')
    .select('telefono, auth_id')
    .not('auth_id', 'is', null);

  if (err1) {
    console.error('❌ Error leyendo agentes:', err1);
    return;
  }

  for (const ag of agentes) {
    const email = `${ag.telefono}@distel.cr`;

    try {
      const { data, error } = await supabase.auth.admin.updateUserById(ag.auth_id, {
        password: 'distel1',
        email_confirm: true,
      });

      if (error) {
        console.error(`❌ Error con ${email}:`, error.message);
      } else {
        console.log(`✅ Contraseña restablecida: ${email}`);
      }
    } catch (e) {
      console.error(`⚠️ Excepción con ${email}:`, e.message);
    }

    await delay(300); // evita rate limit
  }

  console.log('✅ Proceso completado');
})();
