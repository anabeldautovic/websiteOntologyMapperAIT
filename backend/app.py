from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, text
import numpy as np
from rdflib import Graph
from rdflib.namespace import RDF, RDFS, OWL
import pandas as pd
import os
import io
import zipfile
from typing import List, Optional
import logging
import re
import glob

UPLOAD_DIR = os.path.abspath("uploads")

# -----------------------------
# Config
# -----------------------------
DB_USER = "postgres"
DB_PASS = "airpdat20"
DB_HOST = "10.101.252.38"
DB_PORT = 5432
DB_NAME = "postgres"

# Simple engine
engine = create_engine(f"postgresql+psycopg2://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{DB_NAME}")

# -----------------------------
# App Setup
# -----------------------------
app = FastAPI(title="Data Ingest & Ontology API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Models
# -----------------------------
class TableLoadConfig(BaseModel):
    table_name: str
    if_exists: str = "append"


ONTOLOGY_GRAPH = None

logger = logging.getLogger("uvicorn.error")  # FastAPI runs under uvicorn

# -----------------------------
# Routes
# -----------------------------
@app.post("/connect-db")
def connect_db(creds: dict = Body(...)):
    """
    Test connection using input credentials.
    creds should be a dict with keys: host, port, user, password, database
    """
    host = creds.get("host")
    port = creds.get("port")
    user = creds.get("user")
    password = creds.get("password")
    database = creds.get("database")

    # Create engine dynamically
    try:
        engine = create_engine(f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}")
        with engine.begin() as conn:
            result = conn.execute(text("SELECT version();"))
            version = result.scalar()
        return {"ok": True, "message": "Connection successful", "version": version}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database connection error: {e}")

@app.post("/run-query")
def run_query(sql: str = Body(..., embed=True)):
    """
    Execute a SQL query on Postgres and return results.
    """
    try:
        with engine.begin() as conn:
            result = conn.execute(text(sql))
            if result.returns_rows:
                df = pd.DataFrame(result.fetchall(), columns=result.keys())
                return {"ok": True, "rows": df.to_dict(orient="records")}
            else:
                return {"ok": True, "message": f"{result.rowcount} rows affected."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query failed: {e}")


@app.post("/upload-files")
async def upload_files(files: List[UploadFile] = File(...)):
    upload_dir = os.path.abspath("uploads")
    os.makedirs(upload_dir, exist_ok=True)
    report = []

    for uf in files:
        raw = await uf.read()
        target_path = os.path.join(upload_dir, uf.filename)
        with open(target_path, "wb") as f:
            f.write(raw)

        processed = {"filename": uf.filename, "saved_to": target_path, "actions": []}
        name_lower = uf.filename.lower()
        try:
            if name_lower.endswith(".zip"):
                processed["actions"].append("zip_saved")
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    extract_dir = os.path.join(upload_dir, os.path.splitext(uf.filename)[0])
                    os.makedirs(extract_dir, exist_ok=True)
                    zf.extractall(extract_dir)
                    processed["actions"].append(f"zip_extracted_to:{extract_dir}")
            elif name_lower.endswith((".xlsx", ".xls")):
                df = pd.read_excel(io.BytesIO(raw))
                preview_path = os.path.join(upload_dir, uf.filename + ".preview.csv")
                df.head(50).to_csv(preview_path, index=False)
                processed["actions"].append(f"excel_parsed_preview:{preview_path}")
            elif name_lower.endswith((".csv", ".tsv")):
                sep = "," if name_lower.endswith(".csv") else "\t"
                df = pd.read_csv(io.BytesIO(raw), sep=sep)
                preview_path = os.path.join(upload_dir, uf.filename + ".preview.csv")
                df.head(50).to_csv(preview_path, index=False)
                processed["actions"].append(f"csv_parsed_preview:{preview_path}")
            else:
                processed["actions"].append("saved_only")
        except Exception as e:
            processed["error"] = str(e)
        report.append(processed)

    return {"ok": True, "report": report}

    
@app.post("/upload-ontology")
async def upload_ontology(ttl: UploadFile = File(...)):
    """
    Upload, parse, and store an ontology (.ttl).
    Also saves file + creates .nt export.
    """
    upload_dir = os.path.abspath("uploads")
    os.makedirs(upload_dir, exist_ok=True)

    if not ttl.filename.lower().endswith(".ttl"):
        raise HTTPException(status_code=400, detail="File must have .ttl extension")

    raw = await ttl.read()
    target_path = os.path.join(upload_dir, ttl.filename)
    with open(target_path, "wb") as f:
        f.write(raw)

    try:
        global ONTOLOGY_GRAPH
        g = Graph()
        g.parse(data=raw.decode("utf-8"), format="turtle")
        ONTOLOGY_GRAPH = g
        triple_count = len(g)

        # Export N-Triples
        nt_path = target_path + ".nt"
        g.serialize(destination=nt_path, format="nt")

        # Count classes, properties, instances
        classes = set()
        for s, _, _ in g.triples((None, RDF.type, OWL.Class)):
            classes.add(str(s))
        for s, _, _ in g.triples((None, RDF.type, RDFS.Class)):
            classes.add(str(s))

        props = set()
        for s, _, _ in g.triples((None, RDF.type, RDF.Property)):
            props.add(str(s))
        for s, _, _ in g.triples((None, RDF.type, OWL.ObjectProperty)):
            props.add(str(s))
        for s, _, _ in g.triples((None, RDF.type, OWL.DatatypeProperty)):
            props.add(str(s))

        instances = set()
        for s, _, o in g.triples((None, RDF.type, None)):
            if o not in (OWL.Class, RDFS.Class):
                instances.add(str(s))

        return {
            "ok": True,
            "filename": ttl.filename,
            "saved_to": target_path,
            "triples": triple_count,
            "classes_count": len(classes),
            "properties_count": len(props),
            "instances_count": len(instances),
            "ntriples_export": nt_path
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ontology parse failed: {e}")

# --- replace your current /ontology/properties with this ---
@app.get("/ontology/properties")
def list_ontology_properties(
    page: int = 1,
    limit: int = 50,
    q: str = Query(None, description="Search query")
):
    if not ONTOLOGY_GRAPH:
        raise HTTPException(status_code=400, detail="No ontology loaded")

    props = set()

    # 1) Properties explicitly declared
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, RDF.Property)):
        props.add(str(s))
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, OWL.ObjectProperty)):
        props.add(str(s))
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, OWL.DatatypeProperty)):
        props.add(str(s))

    # 2) PLUS: every predicate actually used in any triple
    for _, p, _ in ONTOLOGY_GRAPH:
        props.add(str(p))

    items = sorted(props)

    if q:
        ql = q.lower()
        items = [i for i in items if ql in i.lower()]

    total = len(items)
    start = max(0, (page - 1) * limit)
    end = start + limit
    items = items[start:end]

    return {"ok": True, "predicates": items, "total": total, "page": page, "limit": limit}


# --- add this new endpoint ---
@app.get("/ontology/entities")
def list_ontology_entities(
    page: int = 1,
    limit: int = 50,
    q: str = Query(None, description="Search query")
):
    if not ONTOLOGY_GRAPH:
        raise HTTPException(status_code=400, detail="No ontology loaded")

    classes = set()
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, OWL.Class)):
        classes.add(str(s))
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, RDFS.Class)):
        classes.add(str(s))

    instances = set()
    for s, _, o in ONTOLOGY_GRAPH.triples((None, RDF.type, None)):
        if o not in (OWL.Class, RDFS.Class):
            instances.add(str(s))

    # merge, stable sorted
    items = sorted(classes | instances)

    if q:
        ql = q.lower()
        items = [i for i in items if ql in i.lower()]

    total = len(items)
    start = max(0, (page - 1) * limit)
    end = start + limit
    items = items[start:end]

    return {"ok": True, "entities": items, "total": total, "page": page, "limit": limit}


@app.get("/ontology/classes")
def list_ontology_classes(
    page: int = 1,
    limit: int = 50,
    q: str = Query(None, description="Search query")
):
    if not ONTOLOGY_GRAPH:
        raise HTTPException(status_code=400, detail="No ontology loaded")

    classes = set()
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, OWL.Class)):
        classes.add(str(s))
    for s, _, _ in ONTOLOGY_GRAPH.triples((None, RDF.type, RDFS.Class)):
        classes.add(str(s))

    items = sorted(classes)

    if q:
        items = [i for i in items if q.lower() in i.lower()]

    total = len(items)
    start = (page - 1) * limit
    end = start + limit
    items = items[start:end]

    return {"ok": True, "classes": items, "total": total, "page": page, "limit": limit}


@app.get("/ontology/instances")
def list_ontology_instances(
    page: int = 1,
    limit: int = 50,
    q: str = Query(None, description="Search query")
):
    if not ONTOLOGY_GRAPH:
        raise HTTPException(status_code=400, detail="No ontology loaded")

    instances = set()
    for s, _, o in ONTOLOGY_GRAPH.triples((None, RDF.type, None)):
        if o not in (OWL.Class, RDFS.Class):
            instances.add(str(s))

    items = sorted(instances)

    if q:
        items = [i for i in items if q.lower() in i.lower()]

    total = len(items)
    start = (page - 1) * limit
    end = start + limit
    items = items[start:end]

    return {"ok": True, "instances": items, "total": total, "page": page, "limit": limit}

@app.post("/regex/apply")
def apply_regex(data: dict = Body(...)):
    regex = data.get("regex", "").strip()
    datapoints = data.get("datapoints", [])

    if not regex:
        raise HTTPException(status_code=400, detail="Missing regex")
    if not isinstance(datapoints, list):
        raise HTTPException(status_code=400, detail="datapoints must be a list of strings")

    try:
        pat = re.compile(regex)
    except re.error as e:
        raise HTTPException(status_code=400, detail=f"Invalid regex: {e}")

    matches = []
    total_matches = 0

    for i, raw in enumerate(datapoints):
        dp = "" if raw is None else str(raw)
        m = pat.search(dp)
        if m:
            groups = m.groupdict() or {}
            groups["_"] = m.group(0)
            matches.append({"datapoint": dp, "groups": groups})
            total_matches += 1
        # only log first 5 datapoints for debugging
        if i < 5:
            if m:
                logger.info(f"[regex/apply] dp[{i}] MATCH: {repr(dp)} groups={groups}")
            else:
                logger.info(f"[regex/apply] dp[{i}] NO MATCH: {repr(dp)}")

    logger.info(
        f"[regex/apply] regex={regex!r}, tested={len(datapoints)}, "
        f"total_matches={total_matches}"
    )

    return {
        "ok": True,
        "regex": regex,
        "tested": len(datapoints),
        "total_matches": total_matches,
        "matches": matches,   # return ALL matches now
        "sample": matches[:5] # small preview
    }


@app.post("/preview")
async def preview_file(file: UploadFile = File(...)):
    try:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext in [".xlsx", ".xls"]:
            df = pd.read_excel(file.file)
        else:
            df = pd.read_csv(file.file)

        df_preview = df.head(5).replace({np.nan: None, np.inf: None, -np.inf: None})

        return {
            "type": "table",   
            "columns": df.columns.tolist(),
            "rows": df_preview.to_dict(orient="records"),
        }
    except Exception as e:
        return {"error": str(e)}


    
@app.post("/extract")
async def extract(column: str = Form(...), file: UploadFile = File(...)):
    import pandas as pd, io
    content = await file.read()
    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(content))
    else:
        df = pd.read_excel(io.BytesIO(content))
    if column not in df.columns:
        return {"ok": False, "error": f"Column {column} not found"}
    return {"ok": True, "datapoints": df[column].dropna().astype(str).tolist()}


@app.get("/uploads/list")
def list_uploads():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    files = []
    for path in glob.glob(os.path.join(UPLOAD_DIR, "*")):
        if os.path.isfile(path):
            fn = os.path.basename(path)
            if fn.lower().endswith((".csv",".tsv",".xlsx",".xls")):
                files.append({"filename": fn, "size": os.path.getsize(path)})
    return {"ok": True, "files": files}

@app.delete("/uploads/delete")
def delete_upload(filename: str = Query(...)):
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    os.remove(path)
    return {"ok": True, "deleted": filename}

@app.get("/preview/upload")
def preview_uploaded(filename: str = Query(...)):
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".xlsx",".xls"):
        df = pd.read_excel(path)
    elif ext in (".csv",".tsv"):
        sep = "\t" if ext == ".tsv" else ","
        df = pd.read_csv(path, sep=sep)
    else:
        return {"error": f"Unsupported: {filename}"}
    prev = df.head(5).replace({np.nan: None, np.inf: None, -np.inf: None})
    return {"ok": True, "type": "table", "columns": list(df.columns), "rows": prev.to_dict(orient="records")}

@app.post("/extract-upload")
def extract_uploaded(column: str = Form(...), filename: str = Form(...)):
    path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(filename)[1].lower()
    if ext in (".xlsx",".xls"):
        df = pd.read_excel(path)
    elif ext in (".csv",".tsv"):
        sep = "\t" if ext == ".tsv" else ","
        df = pd.read_csv(path, sep=sep)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported: {filename}")
    if column not in df.columns:
        return {"ok": False, "error": f"Column {column} not found"}
    return {"ok": True, "datapoints": df[column].dropna().astype(str).tolist()}
