import { Inngest } from 'inngest';

/** Event names, so a typo in a sender cannot silently produce a job nobody runs. */
export const EVENTS = {
  codeSubmitted: 'code/submitted',
} as const;

export interface CodeSubmittedData {
  snapshotId: string;
  projectId: string;
}

export const inngest = new Inngest({ id: 'code-flow' });
