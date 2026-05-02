import { IsString, IsOptional } from 'class-validator';
export class UpdateProjectMaterialIssueDto {
  @IsString() @IsOptional() siteId?: string;
  @IsString() @IsOptional() notes?: string;
}
