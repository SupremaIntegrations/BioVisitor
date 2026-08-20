import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateFaceDto {
  @IsString()
  @IsNotEmpty()
  imageBase64: string;
}
