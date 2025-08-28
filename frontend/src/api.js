// src/api.js
export const API_ROOT = "http://localhost:8000";
const j = (r) => r.json();

export const api = {
  connect: (creds) =>
    fetch(`${API_ROOT}/connect-db`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(creds),
    }).then(j),

  runSQL: (sql) =>
    fetch(`${API_ROOT}/run-query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    }).then(j),

  uploadFiles: (files) => {
    const form = new FormData();
    [...files].forEach((f) => form.append("files", f));
    return fetch(`${API_ROOT}/upload-files`, { method: "POST", body: form }).then(j);
  },

  // ✅ fixed to hit the right preview endpoint (5 rows only)
  preview: (file) => {
    const f = new FormData();
    f.append("file", file);
    // ✅ point to /preview (not /preview/file)
    return fetch(`${API_ROOT}/preview`, {
      method: "POST",
      body: f,
    }).then(j);
  },

  uploadTTL: (file) => {
    const f = new FormData();
    f.append("ttl", file);
    return fetch(`${API_ROOT}/upload-ontology`, { method: "POST", body: f }).then(j);
  },

  list: (type, { page = 1, limit = 20, q = "" } = {}) => {
    const path = type === "entities" ? "entities" : type;
    return fetch(
      `${API_ROOT}/ontology/${path}?page=${page}&limit=${limit}&q=${encodeURIComponent(q)}`
    ).then(j);
  },

  applyRegex: (regex, datapoints) =>
    fetch(`${API_ROOT}/regex/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regex, datapoints }),
    }).then(j),

  // ✅ new extract endpoint for full column
  extract: (file, column) => {
    const f = new FormData();
    f.append("file", file);
    f.append("column", column);
    return fetch(`${API_ROOT}/extract`, { method: "POST", body: f }).then(j);
  },

  listUploads: () => fetch(`${API_ROOT}/uploads/list`).then(j),
    previewUploaded: (filename) =>
      fetch(`${API_ROOT}/preview/upload?filename=${encodeURIComponent(filename)}`).then(j),
    extractUploaded: (filename, column) => {
      const f = new FormData();
      f.append("filename", filename);
      f.append("column", column);
      return fetch(`${API_ROOT}/extract-upload`, { method: "POST", body: f }).then(j);
    },
    deleteUploaded: (filename) =>
      fetch(`${API_ROOT}/uploads/delete?filename=${encodeURIComponent(filename)}`, { method: "DELETE" }).then(j),
};
