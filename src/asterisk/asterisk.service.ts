import { Injectable, OnModuleInit } from '@nestjs/common';
import * as ari from 'ari-client';
import * as WebSocket from 'ws';

@Injectable()
export class AsteriskService implements OnModuleInit {
  private client: any;

  async onModuleInit() {
    try {
      this.client = await ari.connect(
        process.env.ARI_HOST,
        process.env.ARI_USERNAME,
        process.env.ARI_PASSWORD,
      );
      this.client.on('StasisStart', (event, channel) => {
        console.log(`Incoming call from ${channel.caller.number}`);
        this.handleIncomingCall(channel);
      });
      this.client.start('audio-app');
    } catch (error) {
      console.error('ARI Connection Error:', error);
    }
  }

  handleIncomingCall(channel) {
    const ws = new WebSocket(
      `ws://localhost:${process.env.PORT ?? 3000}/audio-stream`,
    );

    ws.on('open', () => {
      console.log('WebSocket connected for streaming audio.');

      channel.on('ChannelDtmfReceived', (event) => {
        console.log('DTMF Received:', event.digit);
      });

      channel.on('ChannelHangupRequest', () => {
        console.log('Call ended.');
        ws.close();
      });

      // Example: Sending fake audio chunks (replace with actual streaming logic)
      setInterval(() => {
        const fakeAudioData = Buffer.from('Sample audio chunk', 'utf-8');
        ws.send(fakeAudioData);
      }, 1000);
    });
  }
}
