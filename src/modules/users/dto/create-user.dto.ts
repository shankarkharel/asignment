import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Role } from '../domain/role.enum';

export class CreateUserDto {
  @ApiProperty({ example: 'reviewer.two@example.test' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 12, description: 'At least 12 chars incl. a letter and a digit' })
  @IsString()
  @Length(12, 128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'password must contain a letter and a digit' })
  password: string;

  @ApiProperty({ example: 'Second Reviewer' })
  @IsString()
  @Length(1, 200)
  fullName: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;
}
