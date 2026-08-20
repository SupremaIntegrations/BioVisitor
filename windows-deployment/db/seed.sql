-- ============================================================
--  BioVisitor X — Seed de datos iniciales
--  Crea: tenant por defecto
--
--  REQUIERE: schema.sql ejecutado previamente
--            Extensión pgcrypto (incluida en schema.sql)
--
--  La tabla "users" queda intencionalmente vacía. BioVisitor X
--  detecta que no existe ningún ADMIN y muestra su propio
--  asistente de configuración inicial (GET /auth/system-status,
--  POST /auth/setup) en el primer inicio de sesión, donde el
--  administrador define su propio correo y contraseña.
-- ============================================================

-- Tenant por defecto
INSERT INTO tenants (
  id,
  name,
  code,
  "biostarPlatform",
  "biostarApiUrl",
  "biostarCredentialsEncrypted",
  "brandingConfig",
  timezone,
  "defaultLanguage",
  "isActive",
  "maxConcurrentVisitors"
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Suprema LATAM',
  'suprema-latam',
  'BIOSTAR_2',
  'https://localhost:2778',
  'PENDIENTE_CONFIGURAR',          -- Configurar en Settings > Conexiones BioStar
  '{"primaryColor":"#A12944","companyName":"Suprema LATAM"}',
  'America/Bogota',
  'es',
  TRUE,
  500
) ON CONFLICT (code) DO NOTHING;

SELECT
  'Seed completado. La tabla users esta vacia — completa el asistente de configuracion inicial en el primer inicio de sesion.' AS status;
