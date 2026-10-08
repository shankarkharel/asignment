import { PartialType } from '@nestjs/swagger';
import { CreateApplicationDto } from './create-application.dto';

/** All fields optional; only allowed while the application is editable (DRAFT / INFO_REQUESTED). */
export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}
