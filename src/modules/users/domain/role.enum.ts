export enum Role {
  /** Full operational access. */
  ADMIN = 'ADMIN',
  /** Reviews applications and records risk decisions on applications assigned to them. */
  REVIEWER = 'REVIEWER',
  /** Creates and edits their own applications; cannot approve. */
  SALES = 'SALES',
}
