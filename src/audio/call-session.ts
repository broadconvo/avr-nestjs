import { AudioStream } from '@fonoster/streams';

// Create a CallSession class to encapsulate per-call state
export class CallSession {
  outboundStream: AudioStream;
  isPlaying = false;
  playbackTimeoutId: NodeJS.Timeout | null = null;
  referenceId: string;

  constructor(outboundStream: AudioStream, referenceId: string) {
    this.outboundStream = outboundStream;
    this.referenceId = referenceId;
  }
}
