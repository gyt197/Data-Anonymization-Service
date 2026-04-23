"""
FastAPI backend for AnonymizationUI.
Endpoints: metadata, config, scan, synthetic generate/download.
Run: uvicorn src.api:app --reload
After pip install: python -m spacy download en_core_web_sm
"""

import io
import json
import logging
import math
import os
from typing import Any, List, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from src.generate_metada import generate_metadata, save_user_metadata_config
    from src.Gaussian_Coupla_syntheticdata_generator import generate_synthetic_data_with_config
except ImportError:
    from generate_metada import generate_metadata, save_user_metadata_config
    from Gaussian_Coupla_syntheticdata_generator import generate_synthetic_data_with_config

app = FastAPI(title="AnonymizationUI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _check_presidio():
    """Verify Presidio is available at startup. Log clear instructions if not."""
    try:
        from presidio_analyzer import AnalyzerEngine
        _ = AnalyzerEngine()
        logging.info("Presidio AnalyzerEngine initialized successfully")
    except ImportError:
        logging.warning(
            "presidio_analyzer not installed. Run: pip install presidio-analyzer spacy && python -m spacy download en_core_web_sm"
        )
    except (OSError, Exception) as e:
        msg = str(e).lower()
        if "en_core" in msg or "spacy" in msg or "model" in msg:
            logging.warning("spacy language model missing. Run: python -m spacy download en_core_web_sm")
        else:
            logging.warning("Presidio init failed: %s", e)


_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SYNTHETIC_DIR = os.path.join(_PROJECT_ROOT, "results", "GaussianCopula_results", "synthetic_data")
_SCORES_DIR = os.path.join(_PROJECT_ROOT, "results", "GaussianCopula_results", "overall_scores")
_UPLOADED_DATA_DIR = os.path.join(_PROJECT_ROOT, "results", "uploaded_data")
_UI_DIR = os.path.join(_PROJECT_ROOT, "ui")
_SRC_DIR = os.path.join(_PROJECT_ROOT, "src")
_MAX_CELL_LENGTH = 10_000  # truncate cells longer than this for Presidio


def _json_safe(value: Any):
    """Recursively convert NaN/Inf floats to None for JSON-safe responses."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


class MetadataGenerateRequest(BaseModel):
    input_path: str
    table_name: Optional[str] = None  # If set, only process this table


class MetadataGenerateFromUploadedRequest(BaseModel):
    """Generate metadata from results/uploaded_data. No path needed."""
    table_name: Optional[str] = None  # If set, only process this table; else all


class ConfigSaveRequest(BaseModel):
    source_file_path: str
    user_config: dict


class SyntheticGenerateRequest(BaseModel):
    input_path: Optional[str] = None  # Default: results/uploaded_data


class ScanRequest(BaseModel):
    """Request body for PII scan. Accepts flexible types; backend normalizes to strings."""
    headers: Optional[List[Any]] = None
    rows: Optional[List[List[Any]]] = None


@app.post("/api/metadata/generate")
def api_metadata_generate(req: MetadataGenerateRequest):
    """Generate SDV metadata for CSVs in the given folder. Returns status report."""
    path = req.input_path
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail=f"Input path not found: {path}")
    if os.path.isfile(path):
        path = os.path.dirname(path)
    return generate_metadata(path, table_name=req.table_name)


@app.post("/api/metadata/generate-from-uploaded")
def api_metadata_generate_from_uploaded(req: Optional[MetadataGenerateFromUploadedRequest] = None):
    """Generate metadata for tables in results/uploaded_data. Body: { table_name?: string }."""
    os.makedirs(_UPLOADED_DATA_DIR, exist_ok=True)
    table_name = req.table_name if req else None
    return generate_metadata(_UPLOADED_DATA_DIR, table_name=table_name)


@app.post("/api/metadata/generate-from-upload")
async def api_metadata_generate_from_upload(files: List[UploadFile] = File(...)):
    """
    Upload CSV/Excel files, persist to results/uploaded_data, then generate metadata.
    Excel files are converted to CSV for later synthetic generation.
    Returns the same status report as generate_metadata.
    """
    supported = (".csv", ".xls", ".xlsx")
    valid_files = [f for f in files if f.filename and f.filename.lower().endswith(supported)]
    if not valid_files:
        raise HTTPException(status_code=400, detail="No CSV or Excel files provided")

    os.makedirs(_UPLOADED_DATA_DIR, exist_ok=True)
    for f in valid_files:
        content = await f.read()
        ext = os.path.splitext(f.filename)[1].lower()
        base_name = os.path.splitext(f.filename)[0]
        csv_path = os.path.join(_UPLOADED_DATA_DIR, f"{base_name}.csv")
        if ext == ".csv":
            with open(csv_path, "wb") as out:
                out.write(content)
        else:
            df = pd.read_excel(io.BytesIO(content))
            df.to_csv(csv_path, index=False)
    return generate_metadata(_UPLOADED_DATA_DIR)


@app.post("/api/config/save")
def api_config_save(req: ConfigSaveRequest):
    """Save user config (exempt_columns, force_pii_columns) for a table."""
    return save_user_metadata_config(req.source_file_path, req.user_config)


@app.post("/api/anonymize")
async def api_anonymize(
    files: List[UploadFile] = File(...),
    user_config: Optional[str] = Form(None),
    config_for_table: Optional[str] = Form(None),
):
    """
    One-click anonymization: upload files → generate metadata → save config → GaussianCopula synthesis.
    FormData: files (multipart), user_config (JSON string), config_for_table (e.g. "mydata.csv").
    """
    supported = (".csv", ".xls", ".xlsx")
    valid_files = [f for f in files if f.filename and f.filename.lower().endswith(supported)]
    if not valid_files:
        raise HTTPException(status_code=400, detail="No CSV or Excel files provided")

    os.makedirs(_UPLOADED_DATA_DIR, exist_ok=True)

    # 1. Save files to results/uploaded_data
    for f in valid_files:
        content = await f.read()
        ext = os.path.splitext(f.filename)[1].lower()
        base_name = os.path.splitext(f.filename)[0]
        csv_path = os.path.join(_UPLOADED_DATA_DIR, f"{base_name}.csv")
        if ext == ".csv":
            with open(csv_path, "wb") as out:
                out.write(content)
        else:
            df = pd.read_excel(io.BytesIO(content))
            df.to_csv(csv_path, index=False)

    # 2. Generate metadata
    meta_report = generate_metadata(_UPLOADED_DATA_DIR)
    if meta_report.get("status") == "error":
        raise HTTPException(status_code=500, detail=meta_report.get("summary", "Metadata generation failed"))

    # 3. Save user config if provided
    if user_config and config_for_table:
        try:
            cfg = json.loads(user_config)
            if isinstance(cfg, dict):
                save_user_metadata_config(config_for_table, cfg)
        except json.JSONDecodeError:
            logging.warning("Invalid user_config JSON in /api/anonymize, skipping config save")

    # 4. Run GaussianCopula synthesis
    synth_report = generate_synthetic_data_with_config(_UPLOADED_DATA_DIR)
    safe_report = _json_safe(synth_report)
    return {
        "status": safe_report.get("status", "unknown"),
        "processed_files": safe_report.get("processed_files", []),
        "errors": safe_report.get("errors", []),
        "summary": safe_report.get("summary", ""),
    }


def _normalize_scan_input(headers: Optional[List[Any]], rows: Optional[List[List[Any]]]) -> Tuple[List[str], List[List[str]]]:
    """Normalize headers and rows for Presidio: all strings, bounded length, consistent row length."""
    h = list(headers) if headers else []
    r = list(rows) if rows else []
    if not h:
        h = [f"col_{i}" for i in range(max((len(row) for row in r), default=1))]
    headers_out = [str(x) if x is not None and not (isinstance(x, float) and pd.isna(x)) else "" for x in h]
    ncols = len(headers_out)

    def _cell(v: Any) -> str:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return ""
        s = str(v).strip()
        if len(s) > _MAX_CELL_LENGTH:
            return s[:_MAX_CELL_LENGTH]
        return s

    rows_out = []
    for row in r:
        if not isinstance(row, (list, tuple)):
            continue
        arr = list(row)[:ncols]
        while len(arr) < ncols:
            arr.append("")
        rows_out.append([_cell(c) for c in arr])
    return headers_out, rows_out


@app.post("/api/scan")
def api_scan(req: ScanRequest):
    """PII scan using Presidio. Expects { headers, rows } from Step 2. Data is normalized before analysis."""
    headers_norm, rows_norm = _normalize_scan_input(req.headers, req.rows)
    if not headers_norm or not rows_norm:
        raise HTTPException(status_code=400, detail="headers and rows are required and must not be empty")

    try:
        from presidio_analyzer import AnalyzerEngine
    except ImportError as e:
        logging.exception("presidio_analyzer import failed")
        raise HTTPException(
            status_code=500,
            detail="presidio_analyzer not installed. Run: pip install presidio-analyzer spacy && python -m spacy download en_core_web_sm",
        ) from e

    try:
        analyzer = AnalyzerEngine()
    except (OSError, Exception) as e:
        msg = str(e).lower()
        if "en_core" in msg or "spacy" in msg or "model" in msg:
            raise HTTPException(
                status_code=500,
                detail="spacy language model missing. Run: python -m spacy download en_core_web_sm",
            ) from e
        logging.exception("AnalyzerEngine init failed")
        raise HTTPException(status_code=500, detail=f"Presidio init failed: {str(e)}") from e

    df = pd.DataFrame(rows_norm, columns=headers_norm)
    findings = []
    try:
        for col in df.columns:
            if df[col].dtype in ("object", "string"):
                for idx, value in df[col].items():
                    s = str(value).strip() if value is not None and not (isinstance(value, float) and pd.isna(value)) else ""
                    if not s:
                        continue
                    try:
                        for r in analyzer.analyze(text=s, language="en"):
                            findings.append({
                                "row": int(idx),
                                "column": str(col),
                                "value": s,
                                "pii_type": r.entity_type,
                                "confidence": float(r.score),
                            })
                    except Exception as e:
                        logging.warning("Presidio analyze failed for cell (%s, %s): %s", idx, col, e)
                        continue
    except Exception as e:
        logging.exception("Presidio scan failed")
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}") from e

    summary = {
        "total": len(findings),
        "columns": len({f["column"] for f in findings}),
        "highConfidence": len([f for f in findings if f["confidence"] >= 0.9]),
    }
    return {"summary": summary, "details": findings}


@app.post("/api/synthetic/generate")
def api_synthetic_generate(req: SyntheticGenerateRequest):
    """Run GaussianCopula synthesis. Uses results/uploaded_data if input_path not given."""
    path = req.input_path or _UPLOADED_DATA_DIR
    if not os.path.exists(path):
        raise HTTPException(status_code=400, detail=f"Input path not found: {path}")
    return generate_synthetic_data_with_config(path)


@app.get("/api/synthetic/{table}", response_class=PlainTextResponse)
def api_synthetic_csv(table: str):
    """Return synthetic CSV for the given table name."""
    safe = "".join(c for c in table if c.isalnum() or c in "._-").strip() or "table"
    path = os.path.join(_SYNTHETIC_DIR, f"synthetic_{safe}.csv")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"Synthetic file not found: {safe}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@app.get("/api/uploaded-tables")
def api_uploaded_tables():
    """List table names (filenames without .csv) in results/uploaded_data."""
    if not os.path.isdir(_UPLOADED_DATA_DIR):
        return {"tables": []}
    tables = []
    for f in os.listdir(_UPLOADED_DATA_DIR):
        if f.lower().endswith(".csv"):
            tables.append(os.path.splitext(f)[0])
    return {"tables": tables}


@app.get("/api/synthetic-tables")
def api_synthetic_tables():
    """List table names that have generated synthetic data, with quality scores when available."""
    if not os.path.isdir(_SYNTHETIC_DIR):
        return {"tables": [], "scores": {}}
    tables = []
    prefix = "synthetic_"
    suffix = ".csv"
    for f in os.listdir(_SYNTHETIC_DIR):
        if f.lower().endswith(suffix) and f.lower().startswith(prefix):
            name = f[len(prefix):-len(suffix)]
            tables.append(name)
    scores = {}
    if os.path.isdir(_SCORES_DIR):
        for t in tables:
            score_path = os.path.join(_SCORES_DIR, f"score_{t}.csv")
            if os.path.isfile(score_path):
                try:
                    df = pd.read_csv(score_path)
                    if "overall_score" in df.columns and len(df) > 0:
                        scores[t] = float(df["overall_score"].iloc[0])
                except Exception:
                    pass
    return {"tables": tables, "scores": scores}


@app.get("/")
def _root():
    """Redirect to UI for single-origin dev experience."""
    return RedirectResponse(url="/ui/index.html")


if os.path.isdir(_UI_DIR):
    app.mount("/ui", StaticFiles(directory=_UI_DIR, html=True), name="ui")
if os.path.isdir(_SRC_DIR):
    app.mount("/src", StaticFiles(directory=_SRC_DIR), name="src")
