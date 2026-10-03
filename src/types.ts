export interface VaultItem {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface EncryptedPayload {
  ivHex: string;
  ciphertextHex: string;
  tagHex: string;
}

export interface RedactionResult {
  redacted: string;
  redactionSummary: string[];
  safe: boolean;
}

export type BiometricStatus = 
  | 'idle'
  | 'checking'
  | 'authenticated'
  | 'failed'
  | 'unsupported'
  | 'not_enrolled';

export interface FrameMetrics {
  totalFrames: number;
  droppedFrames: number;
  averageFps: number;
  minFps: number;
  maxFrameDurationMs: number;
}
