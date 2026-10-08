import type { Admission } from '@shared/types';
import type { RespLevel } from '@shared/reference';

export interface CensusRow {
  admission: Admission;
  label: string;
  name: string | null;
  mrn: string | null;
  losDays: number;
  resp: { level: RespLevel; since: string | null; id: string | null };
  vaso: { id: string; agent: string; since: string }[];
  abx: { id: string; drug: string; intent: string | null; since: string }[];
  issues: number;
  culturesSent: number;
  culturesResulted: number;
}
