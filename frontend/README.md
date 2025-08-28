
# Frontend (Vite + React)

## Quickstart
```bash
cd frontend
npm install
npm run dev
```
App runs at http://localhost:5173 and assumes backend at http://localhost:8000

## Tabs
- **Database**: Test connection to PostgreSQL (host/port/user/password/db/sslmode).
- **Files**: Upload multiple files or a folder (Chrome/Edge via `webkitdirectory`).
  - Excel/CSV will generate `.preview.csv` files server-side (first 50 rows).
  - ZIP files will be extracted and scanned recursively.
- **Ontology (.ttl)**: Upload a Turtle ontology; backend parses with RDFLib and returns triple count.
- **Load Excel → Postgres**: Upload a single Excel file and load into a Postgres table.
