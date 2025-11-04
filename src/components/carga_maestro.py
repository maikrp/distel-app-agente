# carga_desabasto_ver_1.0.2.py
"""
Versión 1.0.2 — Herramienta de carga de clientes / desabasto
Lee archivo Excel desde Descargas, salta dos filas vacías,
normaliza columnas y carga registros nuevos a Supabase (tabla "clientes").
"""

import os
import math
from pathlib import Path
import pandas as pd
import streamlit as st
from supabase import create_client

# === CONFIGURACIÓN SUPABASE ===
URL = "https://plarayywtxedbiotsmmd.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
supabase = create_client(URL, KEY)

# === MAPEO DE COLUMNAS (Excel → Supabase) ===
MAPA = {
    "MDN": "mdn_usuario",
    "ID_SOCIO": "id_socio",
    "PDV": "pdv",
    "ULTIMO_USO_MR": "ultimo_uso_de_mis_recargas",
    "SALDO_MENOR_PROMEDIO_DIARIO": "saldo_menor_al_promedio_diario",
    "SALDO": "saldo",
    "PROMEDIO_RECAUDO_DIARIO": "promadio_diario",
    "COMPRO_SALDO_HOY": "compro_saldo_hoy",
    "FECHA_ULTIMA_COMBRA": "fecha_ultima_compra",
    "MONTO_COMPRADO": "monto_comprado",
    "VENDEDOR": "vendedor",
    "PADRE_VENDEDOR": "padre_vendedor",
    "PROMEDIO_RECAUDO_SEMANA": "promedio_semanal",
    "PROMEDIO_RECAUDO_TRIMESTRAL": "promedio_recargado_en_los_ultimos_3_meses",
    "RECAUDO_MES_ACTUAL": "monto_recargado_este_mes",
    "CANAL": "canal",
    "AGRUPACION": "agrupacion",
    "REGION_COMERCIAL": "region_comercial",
    "JERARQUIA_N2": "jerarquias_n2_region",
    "JERARQUIA_N3": "jerarquias_n3_ruta",
    "ABASTECIMIENTO": "abastecimiento"
}

# === FUNCIONES AUXILIARES ===
def obtener_ids_clientes():
    ids = set()
    page, limit = 0, 1000
    while True:
        resp = supabase.table("clientes").select("id_cliente").range(page*limit, (page+1)*limit-1).execute()
        data = resp.data
        if not data:
            break
        ids.update([c["id_cliente"] for c in data if c.get("id_cliente") is not None])
        if len(data) < limit:
            break
        page += 1
    return ids

def limpiar_registro(r):
    clean = {}
    numeric_fields = ["id_cliente", "id_ruta", "id_sede", "id_punto", "id_rdt", "credito", "dias"]
    for k,v in r.items():
        if v in (None, "", " ", pd.NA):
            clean[k] = None
        elif isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            clean[k] = None
        elif k in numeric_fields:
            try:
                clean[k] = int(v)
            except (ValueError, TypeError):
                clean[k] = None
        else:
            clean[k] = v
    return clean

# === INTERFAZ STREAMLIT ===
st.title("Carga de Base de Clientes / Desabasto")
st.write("Seleccione el archivo Excel (.xlsx) desde la carpeta Descargas para cargar nuevos registros.")

carpeta = Path.home() / "Downloads"
archivos = [f for f in os.listdir(carpeta) if f.lower().endswith((".xls", ".xlsx"))]

if not archivos:
    st.error("No se encontraron archivos Excel en la carpeta Descargas.")
    st.stop()

archivo_sel = st.selectbox("Archivos disponibles", archivos)
ruta_archivo = carpeta / archivo_sel

if st.button("Procesar y Cargar"):
    with st.spinner("Leyendo y procesando..."):
        df = pd.read_excel(ruta_archivo, skiprows=2)  # salta las dos filas vacías
        # Renombrar columnas existentes que estén en MAPA
        df = df.rename(columns={k:v for k,v in MAPA.items() if k in df.columns})
        # Filtrar sólo columnas que renombramos
        df = df.loc[:, [v for v in MAPA.values() if v in df.columns]]
        # Limpieza básica
        for col in df.select_dtypes(include="object").columns:
            df[col] = df[col].astype(str).str.strip().replace({"nan": None, "NaT": None, "": None, " ": None})
        # Campos numéricos
        for col in ["id_cliente", "id_ruta", "id_sede", "id_punto", "id_rdt", "credito", "dias"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        # Detectar nuevos según id_cliente
        db_ids = obtener_ids_clientes()
        if "id_cliente" in df.columns:
            nuevos = df[~df["id_cliente"].isin(db_ids)]
        else:
            nuevos = df.copy()
        st.write(f"Total filas en archivo: {len(df)}")
        st.write(f"Registros nuevos para cargar: {len(nuevos)}")
        if nuevos.empty:
            st.info("No hay registros nuevos para agregar.")
        else:
            if st.confirm("¿Desea continuar con la carga de los registros nuevos?"):
                records = [limpiar_registro(r) for r in nuevos.to_dict(orient="records")]
                batch_size = 500
                insertados = 0
                for i in range(0, len(records), batch_size):
                    batch = records[i:i+batch_size]
                    resp = supabase.table("clientes").insert(batch).execute()
                    if resp.error:
                        st.error(f"Error en lote {i//batch_size + 1}: {resp.error}")
                        break
                    insertados += len(batch)
                    st.progress(insertados/len(records))
                st.success(f"{insertados} registros insertados.")
                total, activos, inactivos = obtener_ids_clientes(), None, None
                # Mostrar resumen simple
                st.write("Carga completada.")
    st.stop()
