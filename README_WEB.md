# Auto EDA – Production Web App

A modern, production-ready web application that turns the original Streamlit "Auto EDA Dashboard" into a real product.

## 🏗️ Stack

| Layer    | Technology                                  |
|----------|---------------------------------------------|
| Backend  | **FastAPI** + Uvicorn (async)               |
| Frontend| Vanilla HTML / CSS / JS (no build step)     |
| Charts   | Matplotlib + Seaborn (rendered as PNG)      |
| Data     | Pandas, scikit-learn, NumPy                 |

## ✨ Features

- **Drag & drop** CSV upload
- **Dataset overview** with KPIs and column-by-column statistics
- **Univariate analysis** – histograms, violin plots, bar charts and pies (auto-detected per column type)
- **Bivariate analysis** – scatter / line / hexbin, crosstabs, pivot tables
- **Missing-value handling** – per-column strategies (mean / median / mode / zero / drop / unknown)
- **Outlier removal** – IQR method with change summary
- **Normalization** – MinMax / Standard scaler with before-vs-after KDE plots
- **One-click CSV download** of the cleaned dataset

## 📂 Project structure

```
Analysisweb-main/
├── backend/
│   ├── main.py        # FastAPI app + routes
│   ├── analysis.py    # Refactored EDA functions (no Streamlit)
│   └── uploads/       # (created at runtime)
├── frontend/
│   ├── index.html     # Main UI
│   ├── style.css      # Professional white theme
│   └── app.js         # API client + rendering
├── requirements-web.txt
├── run.bat            # Windows launcher
└── README_WEB.md      # ← you are here
```

## 🚀 Running locally

### Windows (easiest)
```bat
run.bat
```

### Manual (any OS)
```bash
python -m pip install -r requirements-web.txt
python -m uvicorn backend.main:app --reload --port 8000
```

Then open **http://localhost:8000** in your browser.

## 🔌 API documentation

Interactive docs are available at **http://localhost:8000/docs** (Swagger UI) once the server is running.

## 🌍 Deploying to production

- Use **Gunicorn** with **Uvicorn workers**:
  ```bash
  pip install gunicorn
  gunicorn backend.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
  ```
- For free hosting, deploy the backend to [Render](https://render.com), [Railway](https://railway.app), or [Fly.io](https://fly.io) – the static `frontend/` is already served by the same FastAPI process.
- For dataset persistence across requests, replace the in-memory `DATASETS` dict with **Redis** or a database.
