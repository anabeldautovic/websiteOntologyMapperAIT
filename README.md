
# Full-Stack Data Ingest Starter (Postgres + Excel/Folder + TTL Ontology)

**Tech stack**: FastAPI backend, Vite + React frontend.

## Run
1) Backend
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

2) Frontend
```bash
cd frontend
npm install
npm run dev
```

- Frontend at http://localhost:5173
- Backend at http://localhost:8000 (OpenAPI docs at /docs)

## Features
- Connect to PostgreSQL, test with `SELECT version()`.
- Upload files (Excel/CSV/TSV/ZIP/other). Excel/CSV preview saved as `.preview.csv` in backend/uploads/.
- Upload folder (via browser directory selection) or send a ZIP of a folder.
- Upload TTL ontology; parses via RDFLib, returns triple count and exports `.nt` alongside upload.
- Load Excel directly into PostgreSQL table via `/load-excel-to-postgres`.

## Notes
- For production: lock CORS origins, add auth, validate schemas, and handle large file uploads (size limits, chunking).
- SSL: provide `sslmode` if your Postgres requires it (e.g., "require").
- CSV delimiter auto: basic `.csv` uses `,`, `.tsv` uses tab.
- Folder uploads: browsers submit many files; you can also ZIP the folder and upload the `.zip`.

## Postgre credentials

DB_USER = "postgres"
DB_PASS = "airpdat20"
DB_HOST = "10.101.252.38"
DB_PORT = 5432
DB_NAME = "postgres"