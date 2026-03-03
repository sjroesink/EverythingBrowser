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

export interface ProviderCapabilities {
  fileProperties: boolean;
  setPermissions: boolean;
  setOwnerGroup: boolean;
  listOwnershipOptions: boolean;
}

export interface OwnershipOption {
  id: number;
  name: string;
}

export interface OwnershipOptions {
  owners: OwnershipOption[];
  groups: OwnershipOption[];
}

export interface FilePropertyUpdate {
  permissions?: number;
  ownerId?: number;
  groupId?: number;
}
