import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CallSession } from '../entities/call-session.entity';
import { ConfigService } from '@nestjs/config';
import { CallMetadataDto } from '../dto/call-metadata.dto';

@Injectable()
export class CallSessionService implements OnModuleInit {
  private readonly sessions = new Map<string, CallSession>();
  private readonly logger = new Logger(CallSessionService.name);
  private cleanUpInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    // Run cleanup every minute to remove expired sessions
    this.cleanUpInterval = setInterval(
      () => this.cleanupExpiredSessions(),
      60 * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.cleanUpInterval);
  }

  saveSession(metadata: CallMetadataDto): void {
    const ttlSeconds = this.configService.get<number>(
      'CALL_SESSION_TTL_SECONDS',
      60,
    );
    const session = new CallSession(metadata, ttlSeconds);
    this.sessions.set(metadata.sessionId, session);
    this.logger.log(`Saved call metadata for sessionId: ${metadata.sessionId}`);
  }

  getActiveSessions(): CallSession[] {
    // get all active sessions and not expired
    return Array.from(this.sessions.values()).filter(
      (session) => !session.isExpired,
    );
  }

  getSession(sessionId: string): CallSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session?.isExpired) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return session;
  }

  updateSession(sessionId: string, updates: Partial<CallSession>): boolean {
    const session = this.getSession(sessionId);
    if (!session) {
      return false;
    }
    Object.assign(session, updates);
    return true;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    let expiredCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.isExpired) {
        this.sessions.delete(sessionId);
        expiredCount++;
      }
    }
    if (expiredCount > 0) {
      this.logger.log(`Removed ${expiredCount} expired sessions`);
    }
  }
}
