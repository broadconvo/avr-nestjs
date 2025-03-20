import { AudioStream } from '@fonoster/streams';
import { CallMetadataDto } from '../dto/call-metadata.dto';

export class CallSession {
  metadata: CallMetadataDto;
  createdAt: Date;
  expiresAt: Date;
  outboundStream?: AudioStream;
  isPlaying: boolean = false;
  playbackTimeoutId: NodeJS.Timeout | null = null;

  // ttlSeconds is the time to live for the call session in seconds
  constructor(metadata: CallMetadataDto, ttlSeconds: number = 60) {
    this.metadata = metadata;
    this.createdAt = new Date();
    this.expiresAt = new Date(this.createdAt.getTime() + ttlSeconds * 1000);
  }

  get isExpired(): boolean {
    return new Date() > this.expiresAt;
  }
}
