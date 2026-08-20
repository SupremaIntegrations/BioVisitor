/**
 * @file seed.ts
 * @description Script para crear un administrador y tenant inicial (Solo para desarrollo).
 * Uso: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npx ts-node src/seed.ts
 *
 * Si SEED_ADMIN_PASSWORD no se define, se genera una contraseña aleatoria segura
 * que se imprime en consola una sola vez — nunca se almacena en el código fuente.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, Tenant, UserRole, BioStarPlatform } from './database/entities';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

async function bootstrap() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('❌ SEED_ADMIN_EMAIL no está definido. Ejemplo:');
    console.error('   SEED_ADMIN_EMAIL=admin@empresa.com SEED_ADMIN_PASSWORD=... npx ts-node src/seed.ts');
    process.exit(1);
  }

  const providedPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminPassword = providedPassword || generateSecurePassword();
  const passwordWasGenerated = !providedPassword;

  const app = await NestFactory.createApplicationContext(AppModule);

  const tenantRepo = app.get<Repository<Tenant>>(getRepositoryToken(Tenant));
  const userRepo = app.get<Repository<User>>(getRepositoryToken(User));

  // 1. Usar el primer tenant existente; solo crear uno si no hay ninguno
  let tenant = await tenantRepo.findOne({ order: { createdAt: 'ASC' } });
  if (!tenant) {
    tenant = tenantRepo.create({
      code: 'BVXDEFAULT',
      name: 'BioVisitor X',
      timezone: 'America/Bogota',
      biostarPlatform: BioStarPlatform.BIOSTAR_2,
      biostarApiUrl: '',
      biostarCredentialsEncrypted: '',
    });
    await tenantRepo.save(tenant);
    console.log('✅ Tenant creado.');
  } else {
    console.log(`ℹ️  Usando tenant existente: "${tenant.name}" (${tenant.id})`);
  }

  // 2. Crear o restablecer usuario Admin
  let admin = await userRepo.findOne({ where: { email: adminEmail } });
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  if (!admin) {
    admin = userRepo.create({
      email: adminEmail,
      passwordHash,
      fullName: process.env.SEED_ADMIN_NAME || 'Administrador del Sistema',
      role: UserRole.ADMIN,
      tenantId: tenant.id,
      language: 'es',
      isActive: true,
    });
    await userRepo.save(admin);
    console.log(`✅ Usuario admin creado: ${adminEmail}`);
  } else {
    admin.passwordHash = passwordHash;
    admin.lockedUntil = null as any;
    admin.failedLoginAttempts = 0;
    admin.isActive = true;
    await userRepo.save(admin);
    console.log(`ℹ️  Usuario admin restablecido: ${adminEmail}`);
  }

  if (passwordWasGenerated) {
    console.log('');
    console.log('⚠️  Contraseña generada automáticamente (guárdela ahora, no se volverá a mostrar):');
    console.log(`   Contraseña: ${adminPassword}`);
    console.log('');
  }

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error seeding db:', err);
  process.exit(1);
});
