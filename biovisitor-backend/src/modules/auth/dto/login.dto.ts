/**
 * @file login.dto.ts
 * @description DTO para el endpoint de login de operadores VMS.
 */

import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
