import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('VMS API End-to-End Tests', () => {
  let app: INestApplication;
  let jwtToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/v1/auth/login (POST) - Deberia loguearse y devolver JWT', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@supremainc.com',
        password: 'SupremaPassword123!',
        tenantId: 'system', // or leave blank if resolved via domain
      })
      .expect(201);

    expect(response.body).toHaveProperty('access_token');
    jwtToken = response.body.access_token;
  });

  it('/api/v1/visitors (POST) - Falla si no esta autenticado', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/visitors')
      .send({
        fullName: 'Integration Test Visitor',
        email: 'test@supremainc.com',
      })
      .expect(401);
  });
});
