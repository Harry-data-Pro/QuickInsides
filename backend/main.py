"""
FastAPI backend for the Auto EDA production website.
Run with:
    uvicorn backend.main:app --reload --port 8000
The frontend (frontend/index.html) is served as static files.
"""

from __future__ import annotations

import io
import os
import uuid
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analysis as A


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
UPLOAD_DIR = os.path.join(BASE_DIR, "backend", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(
    title="Auto EDA API",
    description="Production backend for the Automatic EDA Dashboard",
    version="1.0.0",
)

# CORS – open for local dev; restrict in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# In-memory dataset store
#   { dataset_id: pandas DataFrame }
# In production swap with Redis / a database.
# ---------------------------------------------------------------------------
DATASETS: Dict[str, pd.DataFrame] = {}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ImputeRequest(BaseModel):
    strategies: Dict[str, str]


class NormalizeRequest(BaseModel):
    strategies: Dict[str, str]


class OutlierRequest(BaseModel):
    columns: Optional[List[str]] = None


class NumNumRequest(BaseModel):
    x_col: str
    y_col: str
    kind: str = "scatter"  # "scatter" | "line" | "hexbin"


class CatCatRequest(BaseModel):
    index_col: str
    column_col: str


class PivotRequest(BaseModel):
    index_cols: List[str] = []
    column_cols: List[str] = []
    value_cols: List[str]
    aggfunc: str = "sum"


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------
def _read_dataset(dataset_id: str) -> pd.DataFrame:
    if dataset_id not in DATASETS:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return DATASETS[dataset_id]


# ---------------------------------------------------------------------------
# Routes – meta
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "datasets_loaded": len(DATASETS)}


# ---------------------------------------------------------------------------
# Routes – dataset lifecycle
# ---------------------------------------------------------------------------
@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    try:
        content = await file.read()
        df = pd.read_csv(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read CSV: {exc}") from exc

    df = df.dropna(axis=1, how="all")
    dataset_id = str(uuid.uuid4())
    DATASETS[dataset_id] = df

    splits = A.split_columns(df)
    info = A.dataset_info(df)
    preview = A.dataset_preview(df)

    return {
        "dataset_id": dataset_id,
        "filename": file.filename,
        "splits": splits,
        "info": info,
        "preview": preview,
    }


@app.get("/api/dataset/{dataset_id}/info")
def dataset_info(dataset_id: str) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    return {"info": A.dataset_info(df), "splits": A.split_columns(df)}


@app.get("/api/dataset/{dataset_id}/preview")
def dataset_preview(dataset_id: str, n: int = 5) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    return A.dataset_preview(df, n=n)


@app.get("/api/dataset/{dataset_id}/download")
def download(dataset_id: str) -> StreamingResponse:
    df = _read_dataset(dataset_id)
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="cleaned_data.csv"'},
    )


# ---------------------------------------------------------------------------
# Routes – analysis
# ---------------------------------------------------------------------------
@app.get("/api/dataset/{dataset_id}/univariate")
def univariate(dataset_id: str) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    return {"columns": A.univariate(df)}


@app.post("/api/dataset/{dataset_id}/bivariate/num-num")
def num_num(dataset_id: str, body: NumNumRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    return A.bivariate_num_num(df, body.x_col, body.y_col, body.kind)


@app.post("/api/dataset/{dataset_id}/bivariate/cat-cat")
def cat_cat(dataset_id: str, body: CatCatRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    return A.bivariate_cat_cat(df, body.index_col, body.column_col)


@app.post("/api/dataset/{dataset_id}/bivariate/pivot")
def pivot(dataset_id: str, body: PivotRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    if not body.value_cols:
        raise HTTPException(status_code=400, detail="At least one value column is required")
    return A.bivariate_pivot(
        df,
        index_cols=body.index_cols,
        column_cols=body.column_cols,
        value_cols=body.value_cols,
        aggfunc=body.aggfunc,
    )


# ---------------------------------------------------------------------------
# Routes – preprocessing
# ---------------------------------------------------------------------------
@app.post("/api/dataset/{dataset_id}/missing")
def missing_values(dataset_id: str, body: ImputeRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    new_df, log = A.impute_missing(df, body.strategies)
    DATASETS[dataset_id] = new_df  # commit changes
    return {
        "log": log,
        "info": A.dataset_info(new_df),
        "splits": A.split_columns(new_df),
        "preview": A.dataset_preview(new_df),
    }


@app.post("/api/dataset/{dataset_id}/outliers")
def outliers(dataset_id: str, body: OutlierRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    new_df, summary = A.iqr_process(df, body.columns)
    DATASETS[dataset_id] = new_df
    return {
        "summary": summary,
        "info": A.dataset_info(new_df),
        "splits": A.split_columns(new_df),
        "preview": A.dataset_preview(new_df),
    }


@app.post("/api/dataset/{dataset_id}/normalize")
def normalize(dataset_id: str, body: NormalizeRequest) -> Dict[str, Any]:
    df = _read_dataset(dataset_id)
    new_df, log = A.normalize(df, body.strategies)
    DATASETS[dataset_id] = new_df
    return {
        "log": log,
        "info": A.dataset_info(new_df),
        "splits": A.split_columns(new_df),
        "preview": A.dataset_preview(new_df),
    }


# ---------------------------------------------------------------------------
# Static frontend (must be registered LAST)
# ---------------------------------------------------------------------------
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
else:
    @app.get("/", response_class=HTMLResponse)
    def index_fallback() -> str:
        return (
            "<h1>Auto EDA API</h1>"
            "<p>The <code>frontend/</code> directory was not found.</p>"
            "<p>Visit <a href='/docs'>/docs</a> for the API documentation.</p>"
        )

