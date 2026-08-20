import { Module } from '@nestjs/common';
import {
  I18nModule,
  AcceptLanguageResolver,
  HeaderResolver,
  QueryResolver,
} from 'nestjs-i18n';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

/**
 * Módulo de configuración de i18n
 * Soporta resolución del idioma mediante:
 * 1. Querystring (?lang=es)
 * 2. Header (x-custom-lang)
 * 3. Header Accept-Language
 */
@Module({
  imports: [
    I18nModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        fallbackLanguage:
          configService.get<string>('app.defaultLanguage') || 'es',
        loaderOptions: {
          path: path.join(__dirname, '../../i18n/'),
          watch: true,
        },
      }),
      resolvers: [
        { use: QueryResolver, options: ['lang'] },
        new HeaderResolver(['x-custom-lang']),
        AcceptLanguageResolver,
      ],
      inject: [ConfigService],
    }),
  ],
  exports: [I18nModule],
})
export class AppI18nModule {}
