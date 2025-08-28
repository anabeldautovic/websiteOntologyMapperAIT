import React, { useMemo, useRef, useState, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { api } from "./api"; // connect, runSQL, uploadFiles, preview, uploadTTL, list, previewUploaded, extractUploaded, deleteUploaded
import OntologyList from "./components/OntologyList";
import { FileEntry as FileEntryBase } from "./types";

// ---- Local helper types ----
type PreviewTable = {
  type?: "table";
  columns: string[];
  rows: Record<string, unknown>[];
};

type SqlOk =
  | { ok: true; rows?: unknown; message?: string }
  | { ok: false; error?: string; detail?: string };

type RegexMatch = {
  datapoint: string;
  groups?: Record<string, string>;
};

type FileEntry = FileEntryBase & {
  id: string;
  source: "local" | "server";
  displayName: string;
  serverFilename?: string;
  fileObj?: File;
  preview?: { columns: string[]; rows: Record<string, unknown>[] };
  selected?: boolean;
  selectedColumn?: string;
  datapoints?: string[];
};

export default function App() {
  // ===== Toolbar refs =====
  const filesRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const ttlRef = useRef<HTMLInputElement | null>(null);

  // ===== DB Connection =====
  const [host, setHost] = useState("10.101.252.38");
  const [port, setPort] = useState<number>(5432);
  const [user, setUser] = useState("postgres");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("postgres");

  // (Optional) Load Excel → Postgres
  const excelRef = useRef<HTMLInputElement | null>(null);
  const [tableName, setTableName] = useState("uploaded_table");
  const [ifExists, setIfExists] = useState<"append" | "replace" | "fail">("append");

  // ===== Workbench state =====
  const [datapoints, setDatapoints] = useState<string[]>([]);
  const [filterQ, setFilterQ] = useState("");
  const [filterResults, setFilterResults] = useState<RegexMatch[]>([]);

  const [subject, setSubject] = useState("");
  const [predicate, setPredicate] = useState("");
  const [object, setObject] = useState("");

  // ===== Console (logs + SQL) =====
  const [log, setLog] = useState("");
  const [sql, setSql] = useState("");
  const [sqlOut, setSqlOut] = useState<SqlOk | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);

  // ===== Previews =====
  const [previews, setPreviews] = useState<
    Array<{ filename: string; data: PreviewTable; fileObj: File | null }>
  >([]);
  const [datapointColumn, setDatapointColumn] = useState("");
  const [ontologyTick, setOntologyTick] = useState(0);

  const [serverFile, setServerFile] = useState(""); // e.g. "my.csv"
  const [availableUploads, setAvailableUploads] = useState<string[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const REGEX_STORAGE_KEY = "kb_regex_state";
  const TRIPLES_STORAGE_KEY = "kb_triples";
  const SPO_STORAGE_KEY = "kb_spo";

  type Triple = { id: string; subject: string; predicate: string; object: string };
  const [triples, setTriples] = useState<Triple[]>([]);


  const addLog = (m: string) => setLog((p) => (p ? `${p}\n${m}` : m));
  // ---- Debug helpers ----
  const addLogJSON = (label: string, obj: unknown, max = 12_000) => {
    try {
      const s = JSON.stringify(obj, null, 2);
      addLog(`${label}:\n${s.length > max ? s.slice(0, max) + " …(truncated)" : s}`);
    } catch (e: any) {
      addLog(`${label}: <unserializable: ${String(e?.message || e)}>`);
    }
  };

  const logSample = <T,>(label: string, arr: T[], n = 5) => {
    addLog(`${label} (showing ${Math.min(n, arr.length)} of ${arr.length}):\n${JSON.stringify(arr.slice(0, n), null, 2)}`);
  };


  // -----------------------
  // Uploads + Previews
  // -----------------------

  useEffect(() => {
    try {
      const savedTriples = JSON.parse(localStorage.getItem(TRIPLES_STORAGE_KEY) || "[]");
      if (Array.isArray(savedTriples)) setTriples(savedTriples);

      const savedSPO = JSON.parse(localStorage.getItem(SPO_STORAGE_KEY) || "{}");
      if (typeof savedSPO.subject === "string") setSubject(savedSPO.subject);
      if (typeof savedSPO.predicate === "string") setPredicate(savedSPO.predicate);
      if (typeof savedSPO.object === "string") setObject(savedSPO.object);
    } catch (e) {
      addLog(`❌ [RESTORE] ${String((e as any)?.message || e)}`);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TRIPLES_STORAGE_KEY, JSON.stringify(triples));
    } catch {/* ignore quota */}
  }, [triples]);

  useEffect(() => {
    try {
      localStorage.setItem(SPO_STORAGE_KEY, JSON.stringify({ subject, predicate, object }));
    } catch {/* ignore quota */}
  }, [subject, predicate, object]);



  useEffect(() => {
    try {
      const raw = localStorage.getItem(REGEX_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { q?: string; results?: RegexMatch[] };
      if (typeof saved.q === "string") setFilterQ(saved.q);
      if (Array.isArray(saved.results)) setFilterResults(saved.results);
      addLog("[REGEX] Restored pattern and cached results from storage.");
    } catch (e: any) {
      addLog(`❌ [REGEX] Restore failed: ${e?.message || String(e)}`);
    }
  }, []);

  useEffect(() => {
    try {
      const snapshot = { q: filterQ, results: filterResults };
      localStorage.setItem(REGEX_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      /* ignore quota errors */
    }
  }, [filterQ, filterResults]);


  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("kb_restore") || "{}");
    if (saved.serverFile) setServerFile(saved.serverFile);
    if (saved.datapointColumn) setDatapointColumn(saved.datapointColumn);
  }, []);

  useEffect(() => {
    api.listUploads().then((r: any) => {
      if (r?.ok) setAvailableUploads(r.files.map((f: any) => f.filename));
    });
  }, []);

  // Whenever serverFile changes, pull preview from backend
  useEffect(() => {
    if (!serverFile) return;
    (async () => {
      const r: PreviewTable & { ok?: boolean; type?: string } = await api.previewUploaded(serverFile);
      if ((r as any)?.ok && r.type === "table") {
        setPreviews([{ filename: serverFile, data: r, fileObj: null }]);
      }
    })();
  }, [serverFile]);

  // Persist selection
  useEffect(() => {
    localStorage.setItem("kb_restore", JSON.stringify({ serverFile, datapointColumn }));
  }, [serverFile, datapointColumn]);

  const uploadFiles = async (files: FileList) => {
    const r = await api.uploadFiles(files);
    addLog(JSON.stringify(r, null, 2));
  };

  useEffect(() => {
    const saved: FileEntry[] = JSON.parse(localStorage.getItem("kb_files") || "[]");
    setFiles(saved);

    api.listUploads().then((r: any) => {
      if (r?.ok) setAvailableUploads(r.files.map((f: any) => f.filename));
    });
  }, []);

  // persist on change (drop fileObj to avoid huge storage)
  useEffect(() => {
    const skinny = files.map(({ fileObj, ...rest }) => rest);
    localStorage.setItem("kb_files", JSON.stringify(skinny));
  }, [files]);

  const previewFile = async (file: File) => {
    const data: PreviewTable | any = await api.preview(file);
    if (data?.type === "table") {
      setPreviews((prev) => [...prev, { filename: file.name, data, fileObj: file }]);
    }
  };

  // rehydrate previews for any server-sourced entries missing preview
  useEffect(() => {
    (async () => {
      const need = files.filter((f) => f.serverFilename && !f.preview);
      if (!need.length) return;
      addLog(`[REHYDRATE] Need previews for ${need.length} server file(s).`);
      try {
        const updates = await Promise.all(
          need.map(async (f) => {
            addLog(`[REHYDRATE] previewUploaded("${f.serverFilename}") …`);
            const r = await api.previewUploaded(f.serverFilename!);
            if (r?.ok && r.type === "table") {
              addLog(`[REHYDRATE] "${f.serverFilename}" -> columns=${r.columns?.length ?? 0}, rows=${r.rows?.length ?? 0}.`);
            } else {
              addLog(`[REHYDRATE] "${f.serverFilename}" -> preview failed or not a table.`);
            }
            return {
              id: f.id,
              preview: (r?.ok && r.type === "table") ? { columns: r.columns, rows: r.rows } : undefined,
            };
          })
        );
        setFiles((cur) =>
          cur.map((f) => {
            const u = updates.find((x) => x.id === f.id);
            return u ? { ...f, preview: u.preview } : f;
          })
        );
      } catch (e: any) {
        addLog(`[REHYDRATE] Error: ${e?.message || String(e)}`);
      }
    })();
  }, [files]);

  // re-extract datapoints if selectedColumn exists but datapoints missing
  useEffect(() => {
    (async () => {
      const need = files.filter((f) => f.serverFilename && f.selectedColumn && !f.datapoints);
      if (!need.length) return;
      addLog(`[EXTRACT] Need datapoints for ${need.length} file(s) with selectedColumn.`);
      try {
        const updates = await Promise.all(
          need.map(async (f) => {
            addLog(`[EXTRACT] extractUploaded("${f.serverFilename}", "${f.selectedColumn}") …`);
            const r = await api.extractUploaded(f.serverFilename!, f.selectedColumn!);
            if (r?.ok) {
              addLog(`[EXTRACT] "${f.displayName}" -> ${r.datapoints?.length ?? 0} datapoints.`);
            } else {
              addLog(`[EXTRACT] "${f.displayName}" failed: ${r?.detail || r?.error || "unknown error"}`);
            }
            return { id: f.id, datapoints: r?.ok ? (r.datapoints as string[]) : [] };
          })
        );
        setFiles((cur) =>
          cur.map((f) => {
            const u = updates.find((x) => x.id === f.id);
            return u ? { ...f, datapoints: u.datapoints } : f;
          })
        );
      } catch (e: any) {
        addLog(`[EXTRACT] Error: ${e?.message || String(e)}`);
      }
    })();
  }, [files]);


  const combinedDatapoints = useMemo(() => {
    const seen = new Set<string>();
    for (const f of files) {
      if (!f.selected || !Array.isArray(f.datapoints)) continue;
      for (const d of f.datapoints) if (typeof d === "string" && !seen.has(d)) seen.add(d);
    }
    return Array.from(seen);
  }, [files]);

  // Log when files or combined datapoints change
  useEffect(() => {
    const selected = files.filter(f => f.selected);
    addLog(`[FILES] Total=${files.length}, Selected=${selected.length}`);
  }, [files]);

  useEffect(() => {
    addLog(`[DP] Combined unique datapoints = ${combinedDatapoints.length}`);
    if (combinedDatapoints.length) logSample("[DP] Sample combined datapoints", combinedDatapoints, 8);
    // Keep legacy state in sync so anything else using `datapoints` continues to work
    setDatapoints(combinedDatapoints);
  }, [combinedDatapoints]);

  /*  (old handlers kept here for reference; JSX-style comments outside JSX cause TSX errors)
  const onPickFiles = async (e) => {...}
  const onPickFolder = async (e) => {...}
  */
  useEffect(() => {
    (async () => {
      if (!filterQ.trim()) return;
      if (!combinedDatapoints.length) return;

      addLog(`[REGEX] Auto re-run after refresh. Datapoints=${combinedDatapoints.length}`);
      try {
        const resp: any = await api.applyRegex(filterQ, combinedDatapoints);
        if (resp?.ok) {
          setFilterResults(resp.matches as RegexMatch[]);
          addLog(`[REGEX] Auto re-run complete. Matches=${resp.matches?.length ?? 0}`);
        } else {
          addLog(`[REGEX] Auto re-run failed: ${resp?.detail || resp?.error || "unknown"}`);
        }
      } catch (e: any) {
        addLog(`[REGEX] Auto re-run error: ${e?.message || String(e)}`);
      }
    })();
  }, [combinedDatapoints, filterQ]);

  const onPickTTL = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = await api.uploadTTL(file);
    addLog(JSON.stringify(r, null, 2));
    await previewFile(file);
    setOntologyTick((x) => x + 1);
  };

  // -----------------------
  // DB actions
  // -----------------------
  const testConnection = async () => {
    addLog("Testing connection…");
    const r = await api.connect({
      host,
      port: Number(port),
      user,
      password,
      database,
    });
    addLog(JSON.stringify(r, null, 2));
  };

  // Optional Excel → PG loader (kept from old app)
  const loadExcelToPg = async () => {
    const file = excelRef.current?.files?.[0];
    if (!file) return addLog("No Excel selected for DB load");
    try {
      const config = {
        creds: { host, port: Number(port), user, password, database },
        table_name: tableName,
        if_exists: ifExists,
      };
      const form = new FormData();
      form.append("config", JSON.stringify(config));
      form.append("file", file);
      const res = await fetch("http://localhost:8000/load-excel-to-postgres", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      addLog(JSON.stringify(data, null, 2));
    } catch (e: any) {
      addLog(`Load-to-Postgres failed: ${e.message}`);
    }
  };

  // -----------------------
  // Regex/SPARQL filtering
  // -----------------------
  const runRegex = async () => {
    try {
      if (!filterQ.trim()) {
        addLog("Enter a regex first");
        return;
      }

      const targets = combinedDatapoints; // make 100% sure we use the combined list
      addLog(`[REGEX] Pattern: /${filterQ}/ on ${targets.length} datapoints.`);
      if (targets.length) logSample("[REGEX] Target sample", targets, 10);

      addLog("[REGEX] Calling api.applyRegex …");
      const resp: any = await api.applyRegex(filterQ, targets);
      addLogJSON("[REGEX] api.applyRegex response (truncated)", resp);

      if (resp?.ok) {
        const matches = resp.matches as Array<{ datapoint: string; groups?: Record<string, string> }>;
        setFilterResults(matches);

        const total = matches.length;
        const withGroups = matches.filter((m) => m.groups && Object.keys(m.groups).length > 0).length;

        addLog(
          `[REGEX] Done.\n` +
          `- searched: ${targets.length} datapoints\n` +
          `- total matches: ${total}\n` +
          `- with named groups: ${withGroups}`
        );
        if (total) logSample("[REGEX] Match sample", matches.slice(0, 20), 5);
      } else {
        addLog(`[REGEX] Failed: ${resp?.detail || resp?.error || "unknown error"}`);
      }
    } catch (e: any) {
      addLog(`[REGEX] Error: ${e?.message || String(e)}`);
    }
  };

  const runSPARQL = () => addLog("SPARQL not implemented yet");

  // -----------------------
  // Triple builder
  // -----------------------
  const canInstantiate = useMemo(() => Boolean(subject && predicate && object), [subject, predicate, object]);
  const instantiate = () => {
    if (!subject || !predicate || !object) return;
    const t: Triple = { id: uuid(), subject, predicate, object };
    setTriples(xs => [...xs, t]);
    addLog(`Instantiate: ${JSON.stringify(t)}`);
  };
  const swapDirection = () => {
    if (!predicate) return;
    setSubject(object);
    setObject(subject);
    addLog("Swapped subject/object.");
  };

  // -----------------------
  // SQL runner
  // -----------------------
  const runSQL = async () => {
    if (!sql.trim()) return;
    setSqlBusy(true);
    setSqlOut(null);
    try {
      const r: SqlOk = await api.runSQL(sql);
      setSqlOut(r);
    } catch (e) {
      setSqlOut({ ok: false, error: String(e) });
    } finally {
      setSqlBusy(false);
    }
  };

  // -----------------------
  // File add helpers
  // -----------------------
  const addUploadedFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) {
      addLog("[UPLOAD] No files provided.");
      return;
    }
    const filesArr = Array.from(fileList);
    addLog(`[UPLOAD] ${filesArr.length} file(s) picked.`);
    logSample("[UPLOAD] Filenames", filesArr.map(f => f.name), 10);

    // 1) Save to server
    try {
      addLog("[UPLOAD] Calling api.uploadFiles …");
      const r: any = await api.uploadFiles(fileList);
      addLogJSON("[UPLOAD] api.uploadFiles response", r);

      const mapSaved = new Map<string, string>(); // original name -> server basename
      if (r?.ok && Array.isArray(r.report)) {
        for (const item of r.report) {
          const base = item.saved_to ? item.saved_to.split(/[\\/]/).pop() : item.filename;
          mapSaved.set(item.filename, base);
        }
        addLogJSON("[UPLOAD] server name mapping", Object.fromEntries(mapSaved));
      }

      // 2) Add entries + preview locally
      for (const f of filesArr) {
        const id = uuid();
        addLog(`[PREVIEW] Requesting preview for "${f.name}" …`);
        const prev: any = await api.preview(f);
        if (prev?.type === "table") {
          addLog(`[PREVIEW] "${f.name}" -> table with ${prev.columns?.length ?? 0} columns, ${prev.rows?.length ?? 0} rows.`);
        } else {
          addLog(`[PREVIEW] "${f.name}" -> non-table or preview failed.`);
        }

        setFiles((cur) => [
          ...cur,
          {
            id,
            source: "local",
            displayName: f.name,
            serverFilename: mapSaved.get(f.name), // used later for extractUploaded
            fileObj: f,
            preview: prev?.type === "table" ? { columns: prev.columns, rows: prev.rows } : undefined,
            selected: true,
          },
        ]);
      }
    } catch (e: any) {
      addLog(`[UPLOAD] Error: ${e?.message || String(e)}`);
    }
  };


  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    addLog("[PICK] Files input changed.");
    await addUploadedFiles(e.target.files);
  };
  const onPickFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    addLog("[PICK] Folder input changed.");
    await addUploadedFiles(e.target.files);
  };


  return (
    <div className="container">
      <h1>Knowledge Builder</h1>

      {/* ===== Toolbar ===== */}
      <div className="card navbar-card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={() => filesRef.current?.click()}>
          Upload timeseries
        </button>
        <input ref={filesRef} type="file" multiple hidden onChange={onPickFiles} />

        <button className="btn" onClick={() => folderRef.current?.click()}>
          Upload folder
        </button>
        {/* Non-standard attributes: suppress TS type errors */}
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error nonstandard attribute accepted by browsers
          webkitdirectory=""
          directory=""
          onChange={onPickFolder}
        />

        <button className="btn" onClick={() => ttlRef.current?.click()}>
          Upload ontology (.ttl)
        </button>
        <input ref={ttlRef} type="file" accept=".ttl" hidden onChange={onPickTTL} />

        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => addLog("Load Knowledge base — hook to API")}>
          Load Knowledge base
        </button>
        <button className="btn" onClick={() => addLog(`Save Knowledge base (.ttl): ${triples.length} triples`)}>
          Save Knowledge base
        </button>
      </div>

      {/* ===== Workbench (3 columns) ===== */}
      <div className="workbench">
        {/* SUBJECT box */}
        <div className="card">
          <div className="section-title">Subject</div>

          {/* Regex/SPARQL results */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">Regex/SPARQL results</div>

            <textarea
              className="log"
              placeholder="Type regex here…"
              value={filterQ}
              onChange={(e) => setFilterQ(e.target.value)}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn" onClick={runRegex}>
                Run regex
              </button>

              <button className="btn" onClick={runSPARQL}>
                Run SPARQL
              </button>
            </div>

            {/* Show results table */}
            {Array.isArray(filterResults) && filterResults.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Datapoint</th>
                      {[
                        ...new Set(
                          filterResults.flatMap((m2) => (m2.groups ? Object.keys(m2.groups) : []))
                        ),
                        "_", // always include full match key
                      ]
                        .filter((x, i, arr) => arr.indexOf(x) === i)
                        .map((key) => (
                          <th key={key}>{key}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filterResults.map((m, i) => (
                      <tr key={i}>
                        <td>{m.datapoint}</td>
                        {[
                          ...new Set(
                            filterResults.flatMap((m2) => (m2.groups ? Object.keys(m2.groups) : []))
                          ),
                          "_",
                        ]
                          .filter((x, i, arr) => arr.indexOf(x) === i)
                          .map((key) => (
                            <td key={key}>{m.groups && m.groups[key] ? m.groups[key] : "—"}</td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Entities autocomplete (classes + instances) */}
          <OntologyList
            type="entities"
            title="Instances or classes (autocomplete)"
            onSelect={setSubject}
            placeholder="Search instances or classes…"
            refreshKey={ontologyTick}
          />
        </div>

        {/* VERB box */}
        <div className="card">
          <div className="section-title">Verb</div>
          <OntologyList
            type="properties"
            title="Property to instantiate"
            onSelect={setPredicate}
            placeholder="Search properties…"
            refreshKey={ontologyTick}
          />

          {/* Build Triple preview + actions */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="section-title">Build Triple</div>
            <p>
              <b>Subject</b>: {subject || "—"}
            </p>
            <p>
              <b>Verb</b>: {predicate || "—"}
            </p>
            <p>
              <b>Object</b>: {object || "—"}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  if (!predicate) return;
                  const s = subject;
                  setSubject(object);
                  setObject(s);
                  addLog("Swapped subject/object.");
                }}
              >
                ↔︎ change direction
              </button>
              <button
                className="btn"
                disabled={!subject || !predicate || !object}
                onClick={instantiate}
              >
                Instantiate
              </button>
            </div>
          </div>
        </div>

        {/* OBJECT box */}
        <div className="card">
          <div className="section-title">Object</div>
          <OntologyList
            type="entities"
            title="Instances or classes (autocomplete)"
            onSelect={setObject}
            placeholder="Search instances or classes…"
            refreshKey={ontologyTick}
          />

          {/* Instantiated list */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="section-title">Instantiated elements (.ttl export)</div>
            <ul style={{ maxHeight: 240, overflowY: "auto" }}>
              {triples.map((t, i) => (
                <li key={i}>
                  <b>{t.subject}</b> → <i>{t.predicate}</i> → {t.object}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ===== Database panel ===== */}
      <div className="card">
        <div className="section-title">PostgreSQL Connection</div>
        <div className="row-2col">
          <div>
            <label>Host</label>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.101.252.38" />
          </div>
          <div>
            <label>Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
          <div>
            <label>User</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="postgres" />
          </div>
          <div>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label>Database</label>
            <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="postgres" />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn" onClick={testConnection}>
            Test Connection
          </button>
        </div>
      </div>

      {/* Previously uploaded */}
      <div className="card">
        <div className="section-title">Add previously uploaded</div>
        <select
          multiple
          size={6}
          value={toAdd}
          onChange={(e) => setToAdd(Array.from(e.target.selectedOptions).map((o) => o.value))}
        >
          {availableUploads.map((fn) => (
            <option key={fn} value={fn}>
              {fn}
            </option>
          ))}
        </select>
        <button
          className="btn"
          onClick={async () => {
            const existing = new Set(files.map((f) => f.serverFilename || f.displayName));
            const picks = toAdd.filter((fn) => !existing.has(fn));
            for (const fn of picks) {
              const id = uuid();
              const prev: any = await api.previewUploaded(fn);
              setFiles((cur) => [
                ...cur,
                {
                  id,
                  source: "server",
                  displayName: fn,
                  serverFilename: fn,
                  preview: prev?.ok ? { columns: prev.columns, rows: prev.rows } : undefined,
                  selected: true,
                },
              ]);
            }
            setToAdd([]);
          }}
        >
          Add selected
        </button>
      </div>

      {/* ===== File & TTL previews ===== */}
      {files.length > 0 && (
        <div className="card">
          <div className="section-title">File Previews</div>

          {files.map((f) => (
            <div key={f.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="checkbox"
                  checked={!!f.selected}
                  onChange={(e) => {
                    addLog(`[SELECT] ${e.target.checked ? "✓ SELECT" : "✗ DESELECT"} "${f.displayName}"`);
                    setFiles((cur) =>
                      cur.map((x) => (x.id === f.id ? { ...x, selected: e.target.checked } : x))
                    );
                  }}
                />
                <h4 style={{ margin: 0 }}>
                  {f.displayName}
                  {f.source === "server" ? " (saved)" : ""}
                </h4>
                <div style={{ flex: 1 }} />
                <button
                  className="btn"
                  onClick={() => {
                    setFiles((cur) => cur.filter((x) => x.id !== f.id));
                  }}
                >
                  Remove
                </button>
                {f.serverFilename && (
                  <button
                    className="btn"
                    onClick={async () => {
                      const resp = await api.deleteUploaded(f.serverFilename!);
                      if (resp?.ok) {
                        setFiles((cur) => cur.filter((x) => x.id !== f.id));
                        const r = await api.listUploads();
                        if (r?.ok) setAvailableUploads(r.files.map((ff: any) => ff.filename));
                      }
                    }}
                  >
                    Delete from server
                  </button>
                )}
              </div>

              {f.preview ? (
                (() => {
                    const preview = f.preview; // safe here, TS knows it's defined

                    return (
                    <>
                        <div style={{ marginTop: 8 }}>
                        <label>
                            Datapoint column:{" "}
                            <select
                              value={f.selectedColumn || ""}
                              onChange={async (e) => {
                                const col = e.target.value || "";
                                setFiles((cur) =>
                                  cur.map((x) => (x.id === f.id ? { ...x, selectedColumn: col } : x))
                                );
                                addLog(`[COLUMN] "${f.displayName}" -> selected column "${col || "(none)"}"`);

                                if (!col || !f.serverFilename) return;

                                try {
                                  addLog(`[EXTRACT] extractUploaded("${f.serverFilename}", "${col}") …`);
                                  const resp = await api.extractUploaded(f.serverFilename, col);
                                  if (resp?.ok) {
                                    addLog(`[EXTRACT] "${f.displayName}" -> ${resp.datapoints?.length ?? 0} datapoints.`);
                                    setFiles((cur) =>
                                      cur.map((x) => (x.id === f.id ? { ...x, datapoints: resp.datapoints } : x))
                                    );
                                  } else {
                                    addLog(`[EXTRACT] Failed for "${f.displayName}": ${resp?.detail || resp?.error}`);
                                  }
                                } catch (err: any) {
                                  addLog(`[EXTRACT] Error for "${f.displayName}": ${err?.message || String(err)}`);
                                }
                              }}
                            >
                            <option value="">-- select column --</option>
                            {preview.columns.map((c) => (
                                <option key={c} value={c}>
                                {c}
                                </option>
                            ))}
                            </select>
                        </label>
                        </div>

                        <div style={{ overflowX: "auto", marginTop: 8 }}>
                        <table className="preview-table">
                            <thead>
                            <tr>{preview.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                            </thead>
                            <tbody>
                            {preview.rows.map((row, i) => (
                                <tr key={i}>
                                {preview.columns.map((c, j) => (
                                    <td key={j}>{String((row as any)[c])}</td>
                                ))}
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        </div>
                    </>
                    );
                })()
                ) : (
                <div>Loading preview…</div>
                )}

            </div>
          ))}
        </div>
      )}

      {/* ===== Bottom console ===== */}
      <div className="row-eq">
        <div className="card">
          <div className="section-title">Log</div>
          <div className="log log-scroll">{log || "—"}</div>
        </div>

        <div className="card">
          <div className="section-title">Run SQL Query</div>
          <textarea
            className="log"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT 1;"
          />
          <div className="console-actions">
            <button className="btn btn--primary" onClick={runSQL} disabled={sqlBusy}>
              {sqlBusy ? "Running…" : "Run Query"}
            </button>
          </div>
          <div className="log log-scroll" style={{ marginTop: 8 }}>
            {sqlOut
              ? sqlOut.ok
                ? (sqlOut as any).rows
                  ? JSON.stringify((sqlOut as any).rows, null, 2)
                  : (sqlOut as any).message
                : `Error: ${sqlOut.error || (sqlOut as any).detail}`
              : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
