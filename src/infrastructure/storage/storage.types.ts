export type StorageObjectMetadata = {
  sizeBytes?: number;
  mimeType?: string;
};

export type SignedStorageUrl = {
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
};

export type StorageAdapter = {
  enabled: boolean;
  publicUrl: (key: string) => string;
  createUploadUrl: (key: string, contentType: string) => Promise<SignedStorageUrl>;
  createDownloadUrl: (key: string) => Promise<SignedStorageUrl>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
  getObject: (key: string) => Promise<Buffer>;
  deleteObject: (key: string) => Promise<void>;
  headObject: (key: string) => Promise<StorageObjectMetadata>;
};
