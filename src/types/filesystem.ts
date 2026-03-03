export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: number;
  permissions?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: number;
  created?: number;
  permissions?: string;
  owner?: string;
  group?: string;
  mimeType?: string;
}
