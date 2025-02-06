import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AsteriskService } from './asterisk/asterisk.service';
import { AsteriskModule } from './asterisk/asterisk.module';
import { AudioModule } from './audio/audio.module';

@Module({
  imports: [AsteriskModule, AudioModule],
  controllers: [AppController],
  providers: [AppService, AsteriskService],
})
export class AppModule {}
