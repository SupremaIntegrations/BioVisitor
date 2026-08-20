================================================================
  BioVisitor X — Instrucciones para el Icono del Installer
  Suprema LATAM
================================================================

CÓMO AGREGAR EL ICONO AL INSTALLER
─────────────────────────────────────────────────────────────

1. Coloca el archivo de icono en esta carpeta:
   windows-deployment\assets\biovisitor.ico

2. El archivo debe ser:
   - Formato: ICO (Windows Icon)
   - Tamaños recomendados: 16x16, 32x32, 48x48, 256x256 (todos en el mismo .ico)
   - Profundidad de color: 32-bit RGBA

3. Una vez colocado el .ico, descomenta la línea en biovisitor-setup.iss:

   ANTES (comentado):
   ; SetupIconFile=..\assets\biovisitor.ico

   DESPUÉS (activo):
   SetupIconFile=..\assets\biovisitor.ico

4. Recompila el installer con build-installer.bat

CÓMO CREAR UN .ICO DESDE EL LOGO DE SUPREMA LATAM
─────────────────────────────────────────────────────────────

Opción A — Online (sin software):
  1. Abre https://convertico.com o https://icoconvert.com
  2. Sube el logo de Suprema LATAM (PNG recomendado)
  3. Selecciona tamaños: 16, 32, 48, 256
  4. Descarga como .ico
  5. Renombra a biovisitor.ico y coloca aquí

Opción B — Con Photoshop:
  1. Instala el plugin ICO de Telegraphics:
     https://www.telegraphics.net/sw/
  2. Abre el logo PNG en Photoshop
  3. Exportar como: Archivo → Guardar como → ICO

Opción C — Con GIMP (gratuito):
  1. Abre el logo en GIMP
  2. Imagen → Escalar imagen (256x256)
  3. Archivo → Exportar como → biovisitor.ico
  4. Selecciona múltiples resoluciones en el diálogo

NOTA: Si no se configura el icono, el installer usará el icono
por defecto de Inno Setup (sin efecto en la funcionalidad).

================================================================
