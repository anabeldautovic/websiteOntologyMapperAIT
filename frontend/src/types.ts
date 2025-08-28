// src/types.ts
export type FileSource = 'local' | 'server';

export interface FileEntry {
  id: string;
  source: FileSource;
  displayName: string;
  serverFilename?: string;
  fileObj?: File;
  preview?: { columns: string[]; rows: any[] };
  selectedColumn?: string;
  datapoints?: string[];
  selected?: boolean;
}
