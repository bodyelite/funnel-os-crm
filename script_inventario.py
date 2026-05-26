import os
import json
import pandas as pd
from pathlib import Path

REQUIRED_COLUMNS = {
    "precio_lista": ["precio_lista", "precio lista", "price_list", "list_price", "precio", "price", "valor_lista"],
    "precio_credito": ["precio_credito", "precio credito", "credit_price", "price_credit", "valor_credito", "precio_cred"],
}

OPTIONAL_COLUMNS = {
    "sku": ["sku", "codigo", "code", "id", "item_id", "part_number"],
    "nombre": ["nombre", "name", "descripcion", "description", "modelo", "model"],
    "marca": ["marca", "brand", "fabricante", "manufacturer"],
    "stock": ["stock", "cantidad", "quantity", "disponible", "available", "existencia"],
    "categoria": ["categoria", "category", "tipo", "type", "segmento"],
}

def normalize_col(name):
    return str(name).strip().lower().replace(" ", "_").replace("-", "_")

def resolve_column(df_cols_normalized, candidates):
    for candidate in candidates:
        c = normalize_col(candidate)
        if c in df_cols_normalized:
            return df_cols_normalized[c]
    return None

def load_dataframe(filepath):
    ext = Path(filepath).suffix.lower()
    if ext == ".csv":
        for sep in [",", ";", "\t", "|"]:
            try:
                df = pd.read_csv(filepath, sep=sep, dtype=str, encoding="utf-8", thousands=".")
                if df.shape[1] > 1:
                    return df
            except Exception:
                continue
        return pd.read_csv(filepath, dtype=str, encoding="latin-1")
    elif ext in [".xlsx", ".xls"]:
        return pd.read_excel(filepath, dtype=str)
    elif ext == ".json":
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return pd.DataFrame(data)
        for key in ["data", "items", "productos", "inventory", "records"]:
            if key in data and isinstance(data[key], list):
                return pd.DataFrame(data[key])
        return pd.DataFrame([data])
    else:
        raise ValueError(f"Formato no soportado: {ext}")

def clean_price(series):
    return (
        series.astype(str)
        .str.replace(r"[^\d]", "", regex=True)
        .apply(lambda x: int(x) if x != "" else None)
    )

def extract_inventory(filepath):
    df = load_dataframe(filepath)
    col_map_normalized = {normalize_col(c): c for c in df.columns}

    missing = []
    resolved_required = {}
    for field, candidates in REQUIRED_COLUMNS.items():
        original = resolve_column(col_map_normalized, candidates)
        if original is None:
            missing.append(field)
        else:
            resolved_required[field] = original

    if missing:
        print(f"[ERROR] Columnas obligatorias no encontradas: {missing}")
        print(f"[INFO] Columnas disponibles en el archivo: {list(df.columns)}")
        raise SystemExit(1)

    resolved_optional = {}
    for field, candidates in OPTIONAL_COLUMNS.items():
        original = resolve_column(col_map_normalized, candidates)
        if original:
            resolved_optional[field] = original

    output = pd.DataFrame()

    for field, original in resolved_optional.items():
        output[field] = df[original].astype(str).str.strip()

    output["precio_lista"] = clean_price(df[resolved_required["precio_lista"]])
    output["precio_credito"] = clean_price(df[resolved_required["precio_credito"]])

    before = len(output)
    output = output.dropna(subset=["precio_lista", "precio_credito"])
    dropped = before - len(output)
    if dropped:
        print(f"[WARN] {dropped} filas eliminadas por precios inválidos o vacíos.")

    output = output.reset_index(drop=True)

    out_path = Path(filepath).with_name(Path(filepath).stem + "_sync.json")
    records = output.to_dict(orient="records")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"[OK] {len(records)} registros sincronizados.")
    print(f"[OK] Archivo generado: {out_path}")
    print(f"[INFO] precio_lista  -> columna origen: '{resolved_required['precio_lista']}'")
    print(f"[INFO] precio_credito -> columna origen: '{resolved_required['precio_credito']}'")

    sample = output[["precio_lista", "precio_credito"]].head(5)
    print("\n[SAMPLE] Primeras filas:")
    print(sample.to_string(index=False))

    return records

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        candidates = list(Path(".").glob("*.csv")) + list(Path(".").glob("*.xlsx")) + list(Path(".").glob("*.json"))
        candidates = [c for c in candidates if "_sync" not in c.name]
        if not candidates:
            print("[ERROR] No se encontraron archivos de inventario en la carpeta.")
            raise SystemExit(1)
        filepath = str(candidates[0])
        print(f"[AUTO] Archivo detectado: {filepath}")
    else:
        filepath = sys.argv[1]

    extract_inventory(filepath)
