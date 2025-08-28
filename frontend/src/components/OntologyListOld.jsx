// src/components/OntologyList.jsx
import React, {useEffect, useMemo, useState} from "react";
import {api} from "../api";

export default function OntologyList({ type, title, onSelect, placeholder }) {
  const [items,setItems]=useState([]), [page,setPage]=useState(1), [total,setTotal]=useState(0);
  const [query,setQuery]=useState("");

  // simple debounce
  const q = useMemo(()=>{
    const o = {v:query}; let t;
    return (cb)=>{ clearTimeout(t); t=setTimeout(()=>cb(o.v),250); };
  },[query]);

  useEffect(()=>{
    let cancelled=false;
    q(async(qv)=>{
      const {ok,total:tt, predicates, classes, instances} = await api.list(type,{page,limit:20,q:qv});
      if (cancelled) return;
      if (ok){ setItems(predicates||classes||instances||[]); setTotal(tt||0); }
    });
    return ()=>{ cancelled=true; };
  },[type,page,query]);

  const totalPages = Math.max(1, Math.ceil(total/20));

  return (
    <div className="card">
      <h3>{title}</h3>
      <input value={query} onChange={(e)=>{setQuery(e.target.value); setPage(1);}} placeholder={placeholder||`Search ${title.toLowerCase()}...`} />
      <ul style={{maxHeight:220, overflowY:"auto"}}>
        {items.map((it,i)=>(
          <li key={i} style={{cursor:"pointer"}} onClick={()=>onSelect?.(it)}>{it}</li>
        ))}
      </ul>
      <div className="row">
        <button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</button>
        <span>Page {page} / {totalPages}</span>
        <button disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
      </div>
    </div>
  );
}