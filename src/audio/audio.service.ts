import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as net from 'net';
import axios from 'axios';

@Injectable()
export class AudioService implements OnModuleInit {
  private readonly logger = new Logger(AudioService.name);
  private readonly AUDIO_HOST = process.env.AUDIO_HOST!;
  private readonly AUDIO_PORT = Number(process.env.AUDIO_PORT!);

  private audioBuffer: Buffer[] = [];

  onModuleInit() {
    //this.connectToAsterisk();
  }

  private connectToAsterisk() {
    this.logger.log('Connecting to Asterisk AudioSocket ...');
    const client = new net.Socket();

    client.connect(this.AUDIO_PORT, this.AUDIO_HOST, () => {
      this.logger.log(
        `Connected to Asterisk AudioSocket on ${this.AUDIO_HOST}:${this.AUDIO_PORT}`,
      );
    });

    client.on('data', (data) => {
      this.logger.log(`Received ${data.length} bytes of audio`);
      this.audioBuffer.push(data);
    });

    client.on('close', () => {
      this.logger.warn('AudioSocket connection closed');
    });

    client.on('error', (err) => {
      this.logger.error('AudioSocket error:', err);
    });

    // Periodically process and send buffered audio to OpenAI
    // setInterval(() => this.processAudioBuffer(), 3000); // Send every 3 seconds
  }

  private async processAudioBuffer() {
    if (this.audioBuffer.length === 0) return;

    const audioData = Buffer.concat(this.audioBuffer);
    this.audioBuffer = []; // Clear the buffer

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        audioData,
        {
          headers: {
            Authorization: `Bearer YOUR_OPENAI_API_KEY`,
            'Content-Type': 'audio/wav',
          },
        },
      );

      this.logger.log(`Transcription: ${response.data.text}`);
    } catch (error) {
      this.logger.error('Error sending audio to OpenAI:', error);
    }
  }
}
