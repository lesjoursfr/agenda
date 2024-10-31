import type { IJobDefinition } from "./job-definition";
import type { IJobParameters } from "./job-parameters";

export interface IAgendaJobStatus {
  [name: string]: {
    running: number;
    locked: number;
    config: IJobDefinition;
  };
}

export interface IAgendaStatus {
  version: string;
  queueName: string | undefined;
  totalQueueSizeDB: number;
  config: {
    totalLockLimit: number;
    maxConcurrency: number;
    processEvery: string | number;
  };
  internal: {
    localQueueProcessing: number;
    localLockLimitReached: number;
  };
  jobStatus?: IAgendaJobStatus;
  queuedJobs: number | IJobParameters[];
  runningJobs: number | IJobParameters[];
  lockedJobs: number | IJobParameters[];
  jobsToLock: number | IJobParameters[];
  isLockingOnTheFly: boolean;
}
