from passlib.hash import bcrypt
from supabase import create_client

# === Conexión Supabase ===
SUPABASE_URL = "https://plarayywtxedbiotsmmd.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYXJheXl3dHhlZGJpb3RzbW1kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODEzNDQ1NCwiZXhwIjoyMDczNzEwNDU0fQ.IUPp46RID_hzBLeIutw2Vw0ESZQcjEq_iHWqAkf2eaM"

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# === Cifrar todas las claves "1234" ===
clave_plana = "1234"
clave_cifrada = bcrypt.hash(clave_plana)

# Actualizar solo los agentes con clave temporal activa
res = supabase.table("agentes").update({"clave": clave_cifrada}).eq("clave_temporal", True).execute()
print("Claves cifradas:", res)
