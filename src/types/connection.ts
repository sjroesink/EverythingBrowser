export type ProviderType = "Sftp" | "BackblazeB2" | "DockerVolume" | "DockerExec" | "LocalFs";

export interface SftpAuthPassword {
  method: "Password";
}
export interface SftpAuthPrivateKey {
  method: "PrivateKey";
  keyPath: string;
  passphraseProtected: boolean;
}
export interface SftpAuthKeyboardInteractive {
  method: "KeyboardInteractive";
}

export type SftpAuthMethod =
  | SftpAuthPassword
  | SftpAuthPrivateKey
  | SftpAuthKeyboardInteractive;

export interface SftpConfig {
  type: "Sftp";
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: SftpAuthMethod;
  useSshAgent?: boolean;
  defaultPath?: string;
}

export interface B2Config {
  type: "BackblazeB2";
  id: string;
  name: string;
  applicationKeyId: string;
  bucketName: string;
  region: string;
  endpoint?: string;
  prefix?: string;
}

export interface DockerVolumeConfig {
  type: "DockerVolume";
  id: string;
  name: string;
  volumeName: string;
  image?: string;
}

export interface DockerExecConfig {
  type: "DockerExec";
  id: string;
  name: string;
  container: string;
  defaultPath?: string;
}

export interface LocalFsConfig {
  type: "LocalFs";
  id: string;
  name: string;
  path: string;
}

export type ConnectionConfig = SftpConfig | B2Config | DockerVolumeConfig | DockerExecConfig | LocalFsConfig;

export interface SavedConnection {
  config: ConnectionConfig;
  createdAt: number;
  lastConnected?: number;
  color?: string;
  sortOrder: number;
}

export interface Tab {
  id: string;
  connectionId: string;
  config: ConnectionConfig;
  currentPath: string;
}
