import { Test, TestingModule } from '@nestjs/testing';
import { AsteriskService } from './asterisk.service';

describe('AsteriskService', () => {
  let service: AsteriskService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AsteriskService],
    }).compile();

    service = module.get<AsteriskService>(AsteriskService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
