
# Backend (FastAPI)

## Quickstart
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

API will run at http://localhost:8000 with docs at http://localhost:8000/docs

## Endpoints
- `POST /connect-db` — test PostgreSQL connection.
- `POST /upload-files` — upload multiple files (Excel/CSV/TSV/ZIP/others). Creates `.preview.csv` files.
- `POST /upload-ontology` — upload a `.ttl` ontology; returns triple count.
- `POST /load-excel-to-postgres` — multipart form with:
    - `config`: JSON string `{"creds": {"host":"...", "port":5432, "user":"...", "password":"...", "database":"...", "sslmode":"require"}, "table_name":"my_table", "if_exists":"append"}`
    - `file`: Excel file

Uploaded files land in `backend/uploads/`.
