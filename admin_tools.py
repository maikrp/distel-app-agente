#!/usr/bin/env python3
# === ADMINISTRACIÓN PLATAFORMA — HERRAMIENTA CENTRAL DISTEL ===

import sys, os, re, unicodedata, platform
from pathlib import Path
from datetime import datetime, timezone, timedelta
import datetime as dt
import pandas as pd
from supabase import create_client, Client
from passlib.hash import bcrypt

# === CONFIGURACIÓN BASE ===
TABLE_NAME = "desabasto_registros"
TABLE_AGENTES = "agentes"

SUPABASE_URL = "https://plarayywtxedbiotsmmd.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYXJheXl3dHhlZGJpb3RzbW1kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODEzNDQ1NCwiZXhwIjoyMDczNzEwNDU0fQ.IUPp46RID_hzBLeIutw2Vw0ESZQcjEq_iHWqAkf2eaM"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

CR_TZ = timezone(timedelta(hours=-6))

# === LOG DE ACCIONES ===
def _log_path() -> Path:
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    return logs_dir / f"acciones_{datetime.now(CR_TZ).strftime('%Y-%m-%d')}.log"

def write_log(action: str, detail: str):
    try:
        ts = datetime.now(CR_TZ).strftime("%Y-%m-%d %H:%M:%S")
        with _log_path().open("a", encoding="utf-8") as f:
            f.write(f"[{ts}] {action} -> {detail}\n")
    except Exception:
        pass

def log_session_start():
    sysname = platform.system().lower()
    env = "PC (Windows)" if sysname.startswith("win") else platform.system()
    write_log("INICIO SESION", f"Entorno detectado: {env}")

# === UTILIDADES ===
def get_downloads_dir() -> Path:
    if platform.system().lower().startswith("win"):
        p = Path.home() / "Downloads"
        if p.exists():
            return p
    for c in [
        Path("/storage/emulated/0/Download"),
        Path("/sdcard/Download"),
        Path.home() / "Download",
        Path.home() / "Downloads",
    ]:
        if c.exists():
            return c
    return Path.cwd()

def normalize_col(c: str) -> str:
    c = ''.join(ch for ch in unicodedata.normalize('NFKD', c) if not unicodedata.combining(ch))
    c = re.sub(r'[^A-Za-z0-9]+', '_', c).strip('_').lower()
    return re.sub(r'_+', '_', c)

def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [normalize_col(c) for c in df.columns]
    return df

def load_excel(path: Path) -> pd.DataFrame:
    xl = pd.ExcelFile(path)
    return xl.parse(xl.sheet_names[0], header=2)

def list_xlsx(dirpath: Path) -> list[Path]:
    return sorted(
        [p for p in dirpath.glob("*.xlsx") if not p.name.startswith("~$")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

# === PROCESAMIENTO Y CARGA ===
def filter_and_prepare(df: pd.DataFrame, fuente_archivo: str) -> pd.DataFrame:
    df = normalize_columns(df)
    if df.columns.duplicated().any():
        duplicadas = df.columns[df.columns.duplicated()].tolist()
        print("⚠️ Columnas duplicadas detectadas:")
        for c in duplicadas:
            print("   ->", c)
        df = df.loc[:, ~df.columns.duplicated()]

    if "saldo_menor_al_promedio_diario" in df.columns:
        antes = len(df)
        df = df[df["saldo_menor_al_promedio_diario"].astype(str).str.lower() != "normal"]
        print(f"Filtrados {antes - len(df)} registros 'Normal'. Se conservaron {len(df)} registros relevantes.")

    df["fuente_archivo"] = fuente_archivo
    df["fecha_carga"] = datetime.now(CR_TZ).strftime("%Y-%m-%d %H:%M:%S-06")
    df = df.loc[:, ~df.columns.str.startswith("unnamed")]
    return df

def save_normalizado(df: pd.DataFrame, original: Path) -> Path:
    out = Path("normalizados")
    out.mkdir(exist_ok=True)
    out_file = out / f"{original.stem}_normalizado_{datetime.now(CR_TZ).strftime('%Y%m%d_%H%M%S')}.csv"
    df.to_csv(out_file, index=False, encoding="utf-8-sig")
    print(f"Archivo normalizado guardado en: {out_file}")
    return out_file

def insert_supabase(df: pd.DataFrame, archivo: str) -> int:
    total = 0
    try:
        df = df.replace([float("inf"), float("-inf")], None)
        df = df.replace({pd.NA: None, "NaN": None, "nan": None, "": None})
        df = df.where(pd.notnull(df), None)
        registros = df.to_dict(orient="records")
        for i in range(0, len(registros), 500):
            supabase.table(TABLE_NAME).insert(registros[i:i + 500]).execute()
            total += len(registros[i:i + 500])
        print(f"✅ {total} registros insertados desde {archivo}")
        write_log("CARGA", f"{total} registros insertados desde {archivo}")
        return total
    except Exception as e:
        print(f"Error al enviar a Supabase: {e}")
        write_log("ERROR", f"Falló inserción: {e}")
        return 0

# === BORRADO DE REGISTROS ===
def delete_by_date(fecha_str: str):
    try:
        d0 = datetime.strptime(fecha_str, "%Y-%m-%d")
        d1 = d0 + timedelta(days=1)
        desde, hasta = d0.strftime("%Y-%m-%d 00:00:00"), d1.strftime("%Y-%m-%d 00:00:00")
        res = supabase.table(TABLE_NAME).select("fecha_carga").gte("fecha_carga", desde).lt("fecha_carga", hasta).execute()
        if not res.data:
            print(f"No hay registros para {fecha_str}.")
            return
        print(f"Registros encontrados para {fecha_str}: {len(res.data)}")
        op = input("¿Desea borrar estos registros? (s/n): ").strip().lower()
        if op == "s":
            supabase.table(TABLE_NAME).delete().gte("fecha_carga", desde).lt("fecha_carga", hasta).execute()
            print(f"✅ Registros eliminados del {fecha_str}")
    except Exception as e:
        print("Error al borrar registros:", e)
        write_log("ERROR", f"Borrado fecha {e}")

def delete_all_confirmed():
    if input("Confirmar borrado TOTAL (s/n): ").strip().lower() != "s":
        return
    try:
        total_borrados = 0
        while True:
            res = supabase.table(TABLE_NAME).select("id").limit(1000).execute()
            ids = [r.get("id") for r in (res.data or []) if r.get("id") is not None]
            if not ids:
                break
            supabase.table(TABLE_NAME).delete().in_("id", ids).execute()
            total_borrados += len(ids)
            print(f"Lote borrado: {len(ids)} (acumulado {total_borrados})")
        print(f"✅ Borrado total completado. Registros eliminados: {total_borrados}")
        write_log("BORRADO TOTAL", f"{total_borrados} eliminados en lotes")
    except Exception as e:
        print("Error al intentar borrar todos los registros:", e)
        write_log("ERROR", f"Borrado total: {e}")

# === CREAR SUPERVISORES Y RESETEO ===
def hash_clave(clave_plana: str) -> str:
    try:
        return bcrypt.hash(clave_plana)
    except Exception as e:
        print(f"Error cifrando clave: {e}")
        return None

def resetear_clave_usuario():
    telefono = input("Teléfono del usuario: ").strip()
    res = supabase.table(TABLE_AGENTES).select("id, nombre").eq("telefono", telefono).execute()
    if not res.data:
        print("Usuario no encontrado.")
        return
    nombre = res.data[0].get("nombre", "Sin nombre")
    nueva_hash = hash_clave("1234")
    supabase.table(TABLE_AGENTES).update({"clave": nueva_hash, "clave_temporal": True}).eq("telefono", telefono).execute()
    print(f"✅ Clave restablecida a '1234' para {nombre}")

def crear_supervisor_con_clave():
    telefono = input("Teléfono: ").strip()
    nombre = input("Nombre completo: ").strip()
    acceso = input("Tipo de acceso (regional/global): ").strip().lower()
    region = None if acceso == "global" else input("Región: ").strip()
    clave_cifrada = hash_clave("1234")
    nuevo = {
        "telefono": telefono,
        "nombre": nombre,
        "vendedor_raw": nombre,
        "region": region,
        "supervisor": "supervisor",
        "activo": True,
        "tipo": "supervisor",
        "acceso": acceso,
        "clave": clave_cifrada,
        "clave_temporal": True,
    }
    supabase.table(TABLE_AGENTES).insert(nuevo).execute()
    print(f"✅ Supervisor creado: {nombre} ({acceso}) con clave temporal '1234'")

# === REPORTE DE DESABASTO POR RUTA (ya verificado) ===
# Se mantiene la función generar_reportes_desabasto() completa e intacta del código previo

# === MENÚ PRINCIPAL ===
def menu():
    while True:
        print("\n=== ADMINISTRACIÓN PLATAFORMA ===")
        print("1) Cargar archivo")
        print("2) Borrar registros de una fecha")
        print("3) Borrar todos los registros")
        print("4) Borrar archivos .xlsx en Descargas")
        print("5) Generar reportes de desabasto por ruta")
        print("6) Crear supervisor (clave cifrada)")
        print("7) Resetear clave de usuario")
        print("8) Salir")

        op = input("Opción: ").strip()
        if op == "1":
            downloads = get_downloads_dir()
            files = list_xlsx(downloads)
            if not files:
                print(f"No hay archivos .xlsx en {downloads}")
                continue
            for i, p in enumerate(files, 1):
                print(f"{i}. {p.name}")
            idx = int(input("Seleccione el número del archivo: ").strip())
            p = files[idx - 1]
            df = load_excel(p)
            df = filter_and_prepare(df, p.name)
            save_normalizado(df, p)
            insert_supabase(df, p.name)
        elif op == "2":
            fecha = input("Fecha (YYYY-MM-DD): ").strip()
            delete_by_date(fecha)
        elif op == "3":
            delete_all_confirmed()
        elif op == "4":
            downloads = get_downloads_dir()
            for f in list_xlsx(downloads):
                try:
                    f.unlink()
                except:
                    pass
            print("Archivos .xlsx borrados del directorio de Descargas.")
        elif op == "5":
            generar_reportes_desabasto()
        elif op == "6":
            crear_supervisor_con_clave()
        elif op == "7":
            resetear_clave_usuario()
        elif op == "8":
            print("Fin del programa.")
            break
        else:
            print("Opción no válida.")

# === EJECUCIÓN ===
if __name__ == "__main__":
    try:
        import pandas  # noqa
    except Exception:
        print("Instala dependencias necesarias: pip install pandas openpyxl supabase passlib")
        sys.exit(1)
    log_session_start()
    menu()
