import { Db } from "mongodb";
import { fail, match, notStrictEqual, strictEqual } from "node:assert";
import { Agenda } from "../src/index";
import { IMockMongo, mockMongo } from "./helpers/mock-mongodb";

describe("JobProcessor", function () {
  // Mocked MongoDB
  let mockedMongo: IMockMongo;
  let mongoDb: Db; // mongo db connection db instance

  const clearJobs = async function () {
    if (mongoDb) {
      await mongoDb.collection("agendaJobs").deleteMany({});
    }
  };

  before(async function () {
    this.timeout(0);
    mockedMongo = await mockMongo();
    mongoDb = mockedMongo.mongo.db();
  });

  after(async function () {
    await mockedMongo.disconnect();
  });

  // Agenda instances
  let agenda: Agenda;

  beforeEach(async function () {
    return new Promise((resolve) => {
      agenda = new Agenda(
        {
          mongo: mongoDb,
          maxConcurrency: 4,
          defaultConcurrency: 1,
          lockLimit: 15,
          defaultLockLimit: 6,
          processEvery: "1 second",
          name: "agendaTest",
        },
        async function () {
          await clearJobs();
          return resolve();
        }
      );
    });
  });

  afterEach(async function () {
    await agenda.stop();
    await clearJobs();
  });

  describe("getRunningStats", function () {
    it("throws an error when agenda is not running", async function () {
      try {
        await agenda.getRunningStats();
        fail();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        strictEqual(err.message, "agenda not running!");
      }
    });

    it("contains the agendaVersion", async function () {
      await agenda.start();

      const status = await agenda.getRunningStats();
      notStrictEqual(status.version, undefined);
      match(status.version, /\d+.\d+.\d+/);
    });

    it("shows the correct job status", async function () {
      agenda.define("test", async function () {
        await new Promise((resolve) => {
          setTimeout(resolve, 30000);
        });
      });

      agenda.now("test");
      await agenda.start();

      await new Promise((resolve) => {
        agenda.on("start:test", resolve);
      });

      const status = await agenda.getRunningStats();
      notStrictEqual(status.jobStatus, undefined);
      if (status.jobStatus) {
        notStrictEqual(status.jobStatus.test, undefined);
        strictEqual(status.jobStatus.test.locked, 1);
        strictEqual(status.jobStatus.test.running, 1);
        strictEqual(typeof status.jobStatus.test.config.fn, "function");
        strictEqual(status.jobStatus.test.config.concurrency, 1);
        strictEqual(status.jobStatus.test.config.lockLifetime, 600000);
        strictEqual(status.jobStatus.test.config.priority, 0);
        strictEqual(status.jobStatus.test.config.lockLimit, 6);
      }
    });

    it("shows isLockingOnTheFly", async function () {
      await agenda.start();

      const status = await agenda.getRunningStats();
      notStrictEqual(status.isLockingOnTheFly, undefined);
      strictEqual(typeof status.isLockingOnTheFly, "boolean");
      strictEqual(status.isLockingOnTheFly, false);
    });

    it("shows queueName", async function () {
      await agenda.start();

      const status = await agenda.getRunningStats();
      notStrictEqual(status.isLockingOnTheFly, undefined);
      strictEqual(typeof status.queueName, "string");
      strictEqual(status.queueName, "agendaTest");
    });

    it("shows totalQueueSizeDB", async function () {
      await agenda.start();

      const status = await agenda.getRunningStats();
      notStrictEqual(status.totalQueueSizeDB, undefined);
      strictEqual(typeof status.totalQueueSizeDB, "number");
      strictEqual(status.totalQueueSizeDB, 0);
    });
  });

  it("ensure new jobs are always filling up running queue", async function () {
    let shortOneFinished = false;

    agenda.define("test long", async function () {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    });
    agenda.define("test short", async function () {
      shortOneFinished = true;
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });

    await agenda.start();

    // queue up long ones
    for (let i = 0; i < 100; i += 1) {
      agenda.now("test long");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    // queue more short ones (they should complete first!)
    for (let j = 0; j < 100; j += 1) {
      agenda.now("test short");
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    strictEqual(shortOneFinished, true);
  });

  it("ensure slow jobs time out", async function () {
    let jobStarted = false;
    agenda.define(
      "test long",
      async function () {
        jobStarted = true;
        await new Promise((resolve) => {
          setTimeout(resolve, 2500);
        });
      },
      { lockLifetime: 500 }
    );

    // queue up long ones
    agenda.now("test long");

    await agenda.start();

    const promiseResult = await new Promise<Error | void>((resolve) => {
      agenda.on("error", (err) => {
        resolve(err);
      });

      agenda.on("success", function () {
        resolve();
      });
    });

    strictEqual(jobStarted, true);
    strictEqual(promiseResult instanceof Error, true);
  });

  it("ensure slow jobs do not time out when calling touch", async function () {
    agenda.define(
      "test long",
      async (job) => {
        for (let i = 0; i < 10; i += 1) {
          await new Promise((resolve) => {
            setTimeout(resolve, 100);
          });
          await job.touch();
        }
      },
      { lockLifetime: 500 }
    );

    await agenda.start();

    // queue up long ones
    agenda.now("test long");

    const promiseResult = await new Promise<Error | void>((resolve) => {
      agenda.on("error", (err) => {
        resolve(err);
      });

      agenda.on("success", function () {
        resolve();
      });
    });

    strictEqual(promiseResult instanceof Error, false);
  });

  it("ensure concurrency is filled up", async function () {
    agenda.maxConcurrency(300);
    agenda.lockLimit(150);
    agenda.defaultLockLimit(20);
    agenda.defaultConcurrency(10);

    for (let jobI = 0; jobI < 10; jobI += 1) {
      agenda.define(
        `test job ${jobI}`,
        async function () {
          await new Promise((resolve) => {
            setTimeout(resolve, 5000);
          });
        },
        { lockLifetime: 10000 }
      );
    }

    // queue up jobs
    for (let jobI = 0; jobI < 10; jobI += 1) {
      for (let jobJ = 0; jobJ < 25; jobJ += 1) {
        agenda.now(`test job ${jobI}`);
      }
    }

    await agenda.start();

    let runningJobs = 0;
    // eslint-disable-next-line no-async-promise-executor
    const allJobsStarted = new Promise(async (resolve) => {
      do {
        runningJobs = (await agenda.getRunningStats()).runningJobs as number;
        await new Promise((wait) => {
          setTimeout(wait, 50);
        });
      } while (runningJobs < 90); // @todo Why not 100?
      resolve("all started");
    });

    strictEqual(
      await Promise.race([
        allJobsStarted,
        new Promise((resolve) => {
          setTimeout(() => resolve(`not all jobs started, currently running: ${runningJobs}`), 1500);
        }),
      ]),
      "all started"
    );
  });
});
