"""
Refactored analysis functions for the Auto EDA backend.
These mirror the logic from helper.py but return data structures
(JSON / base64 images) that are safe to send over HTTP and free
of any Streamlit dependency.
"""

from __future__ import annotations

import base64
import io
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")  # headless backend
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from pandas.api.types import is_numeric_dtype
from sklearn.preprocessing import MinMaxScaler, StandardScaler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def fig_to_base64(fig) -> str:
    """Convert a matplotlib figure to a base64-encoded PNG data URI."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode("ascii")


def _limit_categories(series: pd.Series, top_n: int = 15) -> pd.Series:
    if series.nunique() > top_n:
        return series.value_counts().head(top_n)
    return series.value_counts()


# ---------------------------------------------------------------------------
# Dataset info
# ---------------------------------------------------------------------------
def split_columns(data: pd.DataFrame) -> Dict[str, List[str]]:
    """Return lists of numeric, categorical and label-like columns."""
    num_col, cat_col, label = [], [], []
    for col in data.columns:
        if data[col].dtype in ["int64", "float64", "float32", "int32"]:
            num_col.append(col)
            if data[col].nunique() < 3:
                label.append(col)
        else:
            cat_col.append(col)
    return {"numeric": num_col, "categorical": cat_col, "label": label}


def dataset_info(data: pd.DataFrame) -> Dict[str, Any]:
    """Return a JSON-serialisable summary of the dataset."""
    n_rows, n_cols = data.shape
    missing_total = int(data.isnull().sum().sum())
    duplicates = int(data.duplicated().sum())

    columns: List[Dict[str, Any]] = []
    for col in data.columns:
        col_info: Dict[str, Any] = {
            "name": col,
            "dtype": str(data[col].dtype),
            "missing": int(data[col].isnull().sum()),
            "missing_pct": round(float(data[col].isnull().mean() * 100), 2),
            "unique": int(data[col].nunique()),
        }
        if is_numeric_dtype(data[col]):
            desc = data[col].describe()
            col_info.update(
                {
                    "mean": round(float(desc.get("mean", 0)), 4),
                    "std": round(float(desc.get("std", 0)), 4),
                    "min": round(float(desc.get("min", 0)), 4),
                    "max": round(float(desc.get("max", 0)), 4),
                    "median": round(float(data[col].median()), 4),
                    "skew": round(float(data[col].skew()), 4) if not data[col].isnull().all() else None,
                }
            )
        columns.append(col_info)

    return {
        "shape": {"rows": n_rows, "cols": n_cols},
        "missing_total": missing_total,
        "duplicates": duplicates,
        "columns": columns,
    }


def dataset_preview(data: pd.DataFrame, n: int = 5) -> Dict[str, Any]:
    sample = data.head(n).fillna("").astype(object)
    return {"headers": list(sample.columns), "rows": sample.values.tolist()}


# ---------------------------------------------------------------------------
# Univariate analysis
# ---------------------------------------------------------------------------
def univariate_numeric(data: pd.DataFrame, column: str) -> Dict[str, Any]:
    """Return base64 histogram + violin plot for a numeric column."""
    plt.style.use("ggplot")
    series = data[column].dropna()

    # histogram + KDE
    fig, ax = plt.subplots(figsize=(10, 4))
    sns.histplot(x=series, kde=True, fill=True, ax=ax, color="#3b82f6")
    ax.set_title(f"Distribution of {column}", fontsize=14, fontweight="bold")
    ax.set_xlabel(column)
    hist_img = fig_to_base64(fig)

    # violin
    fig, ax = plt.subplots(figsize=(10, 3))
    sns.violinplot(x=series, ax=ax, color="#10b981")
    ax.set_title(f"Violin of {column}", fontsize=12, fontweight="bold")
    violin_img = fig_to_base64(fig)

    return {
        "type": "numeric",
        "histogram": hist_img,
        "violin": violin_img,
        "stats": {
            "mean": round(float(series.mean()), 4),
            "median": round(float(series.median()), 4),
            "std": round(float(series.std()), 4),
            "min": round(float(series.min()), 4),
            "max": round(float(series.max()), 4),
            "skew": round(float(series.skew()), 4) if len(series) > 0 else 0,
        },
    }


def univariate_categorical(data: pd.DataFrame, column: str) -> Dict[str, Any]:
    """Return base64 bar + pie for a categorical column."""
    plt.style.use("ggplot")
    counts = _limit_categories(data[column].astype(str))

    # bar
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.bar(x=counts.index.astype(str), height=counts.values, color="#3b82f6")
    ax.set_title(f"Count plot of {column}", fontsize=14, fontweight="bold")
    ax.tick_params(rotation=45)
    bar_img = fig_to_base64(fig)

    # pie
    fig, ax = plt.subplots(figsize=(6, 6))
    ax.pie(x=counts.values, labels=counts.index, autopct="%1.1f%%", pctdistance=1.1)
    ax.set_title(f"Share of {column}", fontsize=12, fontweight="bold")
    pie_img = fig_to_base64(fig)

    return {
        "type": "categorical",
        "bar": bar_img,
        "pie": pie_img,
        "counts": [{"label": str(k), "value": int(v)} for k, v in counts.items()],
    }


def univariate(data: pd.DataFrame) -> Dict[str, Any]:
    """Run univariate analysis on every column of the dataset."""
    result: Dict[str, Any] = {}
    for col in data.columns:
        if is_numeric_dtype(data[col]):
            result[col] = univariate_numeric(data, col)
        else:
            result[col] = univariate_categorical(data, col)
    return result


# ---------------------------------------------------------------------------
# Bivariate analysis
# ---------------------------------------------------------------------------
def bivariate_num_num(
    data: pd.DataFrame,
    x_col: str,
    y_col: str,
    kind: str = "scatter",
) -> Dict[str, Any]:
    plt.style.use("ggplot")
    fig, ax = plt.subplots(figsize=(8, 5))
    if kind == "scatter":
        sns.scatterplot(x=data[x_col], y=data[y_col], ax=ax, color="#3b82f6", alpha=0.7)
    elif kind == "line":
        df_sorted = data[[x_col, y_col]].dropna().sort_values(x_col)
        sns.lineplot(x=df_sorted[x_col], y=df_sorted[y_col], ax=ax, color="#3b82f6")
    elif kind == "hexbin":
        d = data[[x_col, y_col]].dropna()
        hb = ax.hexbin(d[x_col], d[y_col], gridsize=25, cmap="viridis")
        fig.colorbar(hb, ax=ax)
    ax.set_xlabel(x_col)
    ax.set_ylabel(y_col)
    ax.set_title(f"{kind.title()}: {x_col} vs {y_col}", fontsize=13, fontweight="bold")
    return {"image": fig_to_base64(fig)}


def bivariate_cat_cat(
    data: pd.DataFrame, index_col: str, column_col: str
) -> Dict[str, Any]:
    ct = pd.crosstab(
        index=data[index_col],
        columns=data[column_col],
        normalize=True,
        margins=True,
    ).mul(100).round(2)
    return {"crosstab": ct.reset_index().to_dict(orient="records")}


def bivariate_pivot(
    data: pd.DataFrame,
    index_cols: List[str],
    column_cols: List[str],
    value_cols: List[str],
    aggfunc: str = "sum",
) -> Dict[str, Any]:
    pivot = pd.pivot_table(
        data,
        index=index_cols or None,
        columns=column_cols or None,
        values=value_cols,
        aggfunc=aggfunc,
    )
    pivot = pivot.fillna(0).round(4)
    return {
        "columns": [str(c) for c in pivot.columns],
        "index": [str(i) for i in pivot.index],
        "values": pivot.values.tolist(),
    }


# ---------------------------------------------------------------------------
# Missing value handling
# ---------------------------------------------------------------------------
MISSING_STRATEGIES_NUM = [
    "Do Nothing",
    "Fill with Mean (Average)",
    "Fill with Median (Middle Value)",
    "Fill with Zero (0)",
    "Drop Rows",
]

MISSING_STRATEGIES_CAT = [
    "Do Nothing",
    "Fill with Mode (Most Frequent)",
    "Fill as 'Unknown'",
    "Drop Rows",
]


def impute_missing(
    data: pd.DataFrame, strategies: Dict[str, str]
) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """
    Apply per-column missing-value strategies.
    `strategies` maps column name -> chosen strategy.
    """
    df = data.copy()
    log: List[Dict[str, Any]] = []
    for col, strategy in strategies.items():
        if col not in df.columns:
            continue
        missing_before = int(df[col].isnull().sum())
        if missing_before == 0 and strategy != "Drop Rows":
            log.append(
                {
                    "column": col,
                    "strategy": strategy,
                    "missing_before": missing_before,
                    "missing_after": 0,
                    "rows_dropped": 0,
                }
            )
            continue

        if strategy == "Fill with Mean (Average)":
            df[col] = df[col].fillna(df[col].mean())
        elif strategy == "Fill with Median (Middle Value)":
            df[col] = df[col].fillna(df[col].median())
        elif strategy == "Fill with Zero (0)":
            df[col] = df[col].fillna(0)
        elif strategy == "Fill with Mode (Most Frequent)":
            if not df[col].mode().empty:
                df[col] = df[col].fillna(df[col].mode()[0])
        elif strategy == "Fill as 'Unknown'":
            df[col] = df[col].fillna("Unknown")
        elif strategy == "Drop Rows":
            before = len(df)
            df = df.dropna(subset=[col])
            after = len(df)
            log.append(
                {
                    "column": col,
                    "strategy": strategy,
                    "missing_before": missing_before,
                    "missing_after": 0,
                    "rows_dropped": before - after,
                }
            )
            continue

        log.append(
            {
                "column": col,
                "strategy": strategy,
                "missing_before": missing_before,
                "missing_after": int(df[col].isnull().sum()),
                "rows_dropped": 0,
            }
        )
    return df, log


# ---------------------------------------------------------------------------
# Outlier handling (IQR)
# ---------------------------------------------------------------------------
def iqr_process(
    data: pd.DataFrame,
    columns: Optional[List[str]] = None,
) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """Remove outliers using IQR. Returns cleaned df + per-column change summary."""
    if columns is None:
        columns = [c for c in data.columns if is_numeric_dtype(data[c])]

    new = data.copy()
    summary: List[Dict[str, Any]] = []
    for col in columns:
        if col not in new.columns or not is_numeric_dtype(new[col]):
            continue
        old_count = new[col].count()
        old_desc = new[col].describe()
        p25 = new[col].quantile(0.25)
        p75 = new[col].quantile(0.75)
        iqr = p75 - p25
        low, high = p25 - 1.5 * iqr, p75 + 1.5 * iqr
        new = new[(new[col] <= high) & (new[col] >= low)]
        new_desc = new[col].describe()
        removed_pct = round(100 - (new[col].shape[0] / old_count * 100), 2) if old_count else 0
        diff = (old_desc.astype(float) - new_desc.astype(float)).round(4)
        summary.append(
            {
                "column": col,
                "lower_bound": round(float(low), 4),
                "upper_bound": round(float(high), 4),
                "removed_pct": removed_pct,
                "diff": diff.to_dict(),
            }
        )
    return new, summary


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------
def normalize(
    data: pd.DataFrame, strategies: Dict[str, str]
) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """Apply per-column scaling. Returns scaled df + log of choices."""
    df = data.copy()
    log: List[Dict[str, Any]] = []
    for col, strategy in strategies.items():
        if col not in df.columns or not is_numeric_dtype(df[col]):
            continue
        original = df[col].copy()
        if strategy == "MinMaxScaler":
            scaler = MinMaxScaler()
            df[[col]] = scaler.fit_transform(df[[col]])
        elif strategy == "StandardScaler":
            scaler = StandardScaler()
            df[[col]] = scaler.fit_transform(df[[col]])
        else:
            log.append({"column": col, "strategy": "Do Nothing"})
            continue
        log.append({"column": col, "strategy": strategy})

        # comparison plot
        plt.style.use("ggplot")
        fig, ax = plt.subplots(figsize=(8, 3.5))
        original.plot(kind="kde", ax=ax, label="Original", color="#3b82f6")
        df[col].plot(kind="kde", ax=ax, label="Normalized", color="#ef4444")
        ax.set_title(f"{col} – Before vs After {strategy}", fontsize=12, fontweight="bold")
        ax.set_xlabel(col)
        ax.legend()
        log[-1]["comparison"] = fig_to_base64(fig)
    return df, log





