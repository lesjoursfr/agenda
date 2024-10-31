import { Db } from "mongodb";
import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert";
import { setTimeout as delay } from "node:timers/promises";
import { Agenda } from "../src/index";
import { Job } from "../src/job";
import { hasMongoProtocol } from "../src/utils/has-mongo-protocol";
import { IMockMongo, mockMongo } from "./helpers/mock-mongodb";

// Slow timeouts for Travis
const jobTimeout = 500;
const jobType = "do work";
const jobProcessor = function () {};

describe("Agenda", function () {
  // Mocked MongoDB
  let mockedMongo: IMockMongo;
  let mongoCfg: string; // connection string to mongodb
  let mongoDb: Db; // mongo db connection db instance

  const clearJobs = async function () {
    if (mongoDb) {
      await mongoDb.collection("agendaJobs").deleteMany({});
    }
  };

  before(async function () {
    this.timeout(0);
    mockedMongo = await mockMongo();
    mongoCfg = mockedMongo.uri;
    mongoDb = mockedMongo.mongo.db();
  });

  after(async function () {
    await mockedMongo.disconnect();
  });

  // Agenda instances
  let globalAgenda: Agenda;

  beforeEach(async function () {
    return new Promise((resolve) => {
      globalAgenda = new Agenda(
        {
          mongo: mongoDb,
        },
        async function () {
          await delay(50);
          await clearJobs();
          globalAgenda.define("someJob", jobProcessor);
          globalAgenda.define("send email", jobProcessor);
          globalAgenda.define("some job", jobProcessor);
          globalAgenda.define(jobType, jobProcessor);
          return resolve();
        }
      );
    });
  });

  afterEach(async function () {
    await delay(50);
    await globalAgenda.stop();
    await clearJobs();
  });

  it("sets a default processEvery", function () {
    strictEqual(globalAgenda.attrs.processEvery, 5000);
  });

  describe("configuration methods", function () {
    it("sets the _db directly when passed as an option", function () {
      const agendaDb = new Agenda({ mongo: mongoDb });
      notStrictEqual(agendaDb.db, undefined);
    });
  });

  describe("configuration methods", function () {
    describe("mongo connection tester", function () {
      it("passing a valid server connection string", function () {
        strictEqual(hasMongoProtocol(mongoCfg), true);
      });

      it("passing a valid multiple server connection string", function () {
        strictEqual(hasMongoProtocol(`mongodb+srv://localhost/agenda-test`), true);
      });

      it("passing an invalid connection string", function () {
        strictEqual(hasMongoProtocol(`localhost/agenda-test`), false);
      });
    });
    describe("mongo", function () {
      it("sets the _db directly", function () {
        const agenda = new Agenda();
        agenda.mongo(mongoDb);
        notStrictEqual(agenda.db, undefined);
      });

      it("returns itself", async function () {
        const agenda = new Agenda();
        strictEqual(await agenda.mongo(mongoDb), agenda);
      });
    });

    describe("name", function () {
      it("sets the agenda name", function () {
        globalAgenda.name("test queue");
        strictEqual(globalAgenda.attrs.name, "test queue");
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.name("test queue"), globalAgenda);
      });
    });
    describe("processEvery", function () {
      it("sets the processEvery time", function () {
        globalAgenda.processEvery("3 minutes");
        strictEqual(globalAgenda.attrs.processEvery, 180000);
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.processEvery("3 minutes"), globalAgenda);
      });
    });
    describe("maxConcurrency", function () {
      it("sets the maxConcurrency", function () {
        globalAgenda.maxConcurrency(10);
        strictEqual(globalAgenda.attrs.maxConcurrency, 10);
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.maxConcurrency(10), globalAgenda);
      });
    });
    describe("defaultConcurrency", function () {
      it("sets the defaultConcurrency", function () {
        globalAgenda.defaultConcurrency(1);
        strictEqual(globalAgenda.attrs.defaultConcurrency, 1);
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.defaultConcurrency(5), globalAgenda);
      });
    });
    describe("lockLimit", function () {
      it("sets the lockLimit", function () {
        globalAgenda.lockLimit(10);
        strictEqual(globalAgenda.attrs.lockLimit, 10);
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.lockLimit(10), globalAgenda);
      });
    });
    describe("defaultLockLimit", function () {
      it("sets the defaultLockLimit", function () {
        globalAgenda.defaultLockLimit(1);
        strictEqual(globalAgenda.attrs.defaultLockLimit, 1);
      });
      it("returns itself", function () {
        strictEqual(globalAgenda.defaultLockLimit(5), globalAgenda);
      });
    });
    describe("defaultLockLifetime", function () {
      it("returns itself", function () {
        strictEqual(globalAgenda.defaultLockLifetime(1000), globalAgenda);
      });
      it("sets the default lock lifetime", function () {
        globalAgenda.defaultLockLifetime(9999);
        strictEqual(globalAgenda.attrs.defaultLockLifetime, 9999);
      });
      it("is inherited by jobs", function () {
        globalAgenda.defaultLockLifetime(7777);
        globalAgenda.define("testDefaultLockLifetime", function () {});
        strictEqual(globalAgenda.definitions.testDefaultLockLifetime.lockLifetime, 7777);
      });
    });
    describe("sort", function () {
      it("returns itself", function () {
        strictEqual(globalAgenda.sort({ nextRunAt: 1, priority: -1 }), globalAgenda);
      });
      it("sets the default sort option", function () {
        globalAgenda.sort({ nextRunAt: -1 });
        deepStrictEqual(globalAgenda.attrs.sort, { nextRunAt: -1 });
      });
    });
  });

  describe("job methods", function () {
    describe("create", function () {
      let job: Job;
      beforeEach(() => {
        job = globalAgenda.create("sendEmail", { to: "some guy" });
      });

      it("returns a job", function () {
        strictEqual(job instanceof Job, true);
      });
      it("sets the name", function () {
        strictEqual(job.attrs.name, "sendEmail");
      });
      it("sets the type", function () {
        strictEqual(job.attrs.type, "normal");
      });
      it("sets the agenda", function () {
        strictEqual(job.agenda, globalAgenda);
      });
      it("sets the data", function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        strictEqual((job.attrs.data as any).to, "some guy");
      });
    });

    describe("define", function () {
      it("stores the definition for the job", function () {
        strictEqual(globalAgenda.definitions.someJob.fn, jobProcessor);
      });

      it("sets the default concurrency for the job", function () {
        strictEqual(globalAgenda.definitions.someJob.concurrency, 5);
      });

      it("sets the default lockLimit for the job", function () {
        strictEqual(globalAgenda.definitions.someJob.lockLimit, 0);
      });

      it("sets the default priority for the job", function () {
        strictEqual(globalAgenda.definitions.someJob.priority, 0);
      });
      it("takes concurrency option for the job", function () {
        globalAgenda.define("highPriority", jobProcessor, { priority: 10 });
        strictEqual(globalAgenda.definitions.highPriority.priority, 10);
      });
    });

    describe("every", function () {
      describe("with a job name specified", function () {
        it("returns a job", async function () {
          strictEqual((await globalAgenda.every("5 minutes", "send email")) instanceof Job, true);
        });
        it("sets the repeatEvery", async function () {
          strictEqual(
            await globalAgenda.every("5 seconds", "send email").then(({ attrs }) => attrs.repeatInterval),
            "5 seconds"
          );
        });
        it("sets the agenda", async function () {
          strictEqual(await globalAgenda.every("5 seconds", "send email").then(({ agenda }) => agenda), globalAgenda);
        });
        it("should update a job that was previously scheduled with `every`", async function () {
          await globalAgenda.every(10, "shouldBeSingleJob");
          await delay(10);
          await globalAgenda.every(20, "shouldBeSingleJob");

          // Give the saves a little time to propagate
          await delay(jobTimeout);

          const res = await globalAgenda.jobs({ name: "shouldBeSingleJob" });
          strictEqual(res.length, 1);
        });
        it("should not run immediately if options.skipImmediate is true", async function () {
          const jobName = "send email";
          await globalAgenda.every("5 minutes", jobName, {}, { skipImmediate: true });
          const job = (await globalAgenda.jobs({ name: jobName }))[0];
          const nextRunAt = job.attrs.nextRunAt!.getTime();
          const now = new Date().getTime();
          strictEqual(nextRunAt - now > 0, true);
        });
        it("should run immediately if options.skipImmediate is false", async function () {
          const jobName = "send email";
          await globalAgenda.every("5 minutes", jobName, {}, { skipImmediate: false });
          const job = (await globalAgenda.jobs({ name: jobName }))[0];
          const nextRunAt = job.attrs.nextRunAt!.getTime();
          const now = new Date().getTime();
          strictEqual(nextRunAt - now <= 0, true);
        });
      });
      describe("with array of names specified", function () {
        it("returns array of jobs", async function () {
          strictEqual(Array.isArray(await globalAgenda.every("5 minutes", ["send email", "some job"])), true);
        });
      });
    });

    describe("schedule", function () {
      describe("with a job name specified", function () {
        it("returns a job", async function () {
          strictEqual((await globalAgenda.schedule("in 5 minutes", "send email")) instanceof Job, true);
        });
        it("sets the schedule", async function () {
          const fiveish = new Date().valueOf() + 250000;
          const scheduledJob = await globalAgenda.schedule("in 5 minutes", "send email");
          strictEqual(fiveish < scheduledJob.attrs.nextRunAt!.valueOf(), true);
        });
      });
      describe("with array of names specified", function () {
        it("returns array of jobs", async function () {
          strictEqual(Array.isArray(await globalAgenda.schedule("5 minutes", ["send email", "some job"])), true);
        });
      });
    });

    describe("unique", function () {
      describe("should demonstrate unique contraint", function () {
        it("should modify one job when unique matches", async function () {
          const job1 = await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: true,
            })
            .unique({
              "data.type": "active",
              "data.userId": "123",
            })
            .schedule("now")
            .save();

          await delay(100);

          const job2 = await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: false,
            })
            .unique({
              "data.type": "active",
              "data.userId": "123",
            })
            .schedule("now")
            .save();

          notStrictEqual(job1.attrs.nextRunAt!.toISOString(), job2.attrs.nextRunAt!.toISOString());

          const jobs = await mongoDb
            .collection("agendaJobs")
            .find({
              name: "unique job",
            })
            .toArray();
          strictEqual(jobs.length, 1);
        });

        it("should not modify job when unique matches and insertOnly is set to true", async function () {
          const job1 = await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: true,
            })
            .unique(
              {
                "data.type": "active",
                "data.userId": "123",
              },
              {
                insertOnly: true,
              }
            )
            .schedule("now")
            .save();

          const job2 = await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: false,
            })
            .unique(
              {
                "data.type": "active",
                "data.userId": "123",
              },
              {
                insertOnly: true,
              }
            )
            .schedule("now")
            .save();

          strictEqual(job1.attrs.nextRunAt!.toISOString(), job2.attrs.nextRunAt!.toISOString());

          const jobs = await mongoDb
            .collection("agendaJobs")
            .find({
              name: "unique job",
            })
            .toArray();
          strictEqual(jobs.length, 1);
        });
      });

      describe("should demonstrate non-unique contraint", function () {
        it("should create two jobs when unique doesn't match", async function () {
          const time = new Date(Date.now() + 1000 * 60 * 3);
          const time2 = new Date(Date.now() + 1000 * 60 * 4);

          await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: true,
            })
            .unique({
              "data.type": "active",
              "data.userId": "123",
              nextRunAt: time,
            })
            .schedule(time)
            .save();

          await globalAgenda
            .create("unique job", {
              type: "active",
              userId: "123",
              other: false,
            })
            .unique({
              "data.type": "active",
              "data.userId": "123",
              nextRunAt: time2,
            })
            .schedule(time)
            .save();

          const jobs = await mongoDb
            .collection("agendaJobs")
            .find({
              name: "unique job",
            })
            .toArray();

          strictEqual(jobs.length, 2);
        });
      });
    });

    describe("now", function () {
      it("returns a job", async function () {
        strictEqual((await globalAgenda.now("send email")) instanceof Job, true);
      });
      it("sets the schedule", async function () {
        const now = new Date();
        strictEqual(
          now.valueOf() - 1 <= (await globalAgenda.now("send email").then(({ attrs }) => attrs.nextRunAt!.valueOf())),
          true
        );
      });

      it("runs the job immediately", async function () {
        globalAgenda.define("immediateJob", async (job) => {
          strictEqual(await job.isRunning(), true);
          await globalAgenda.stop();
        });
        await globalAgenda.now("immediateJob");
        await globalAgenda.start();
      });
    });

    describe("jobs", function () {
      it("returns jobs", async function () {
        await globalAgenda.create("test").save();
        const c = await globalAgenda.jobs({});

        notStrictEqual(c.length, 0);
        strictEqual(c[0] instanceof Job, true);
        await clearJobs();
      });
    });

    describe("purge", function () {
      it("removes all jobs without definitions", async function () {
        const job = globalAgenda.create("no definition");
        await globalAgenda.stop();
        await job.save();
        const j = await globalAgenda.jobs({
          name: "no definition",
        });

        strictEqual(j.length, 1);
        await globalAgenda.purge();
        const jAfterPurge = await globalAgenda.jobs({
          name: "no definition",
        });

        strictEqual(jAfterPurge.length, 0);
      });
    });

    describe("saveJob", function () {
      it("persists job to the database", async function () {
        const job = globalAgenda.create("someJob", {});
        await job.save();

        notStrictEqual(job.attrs._id, undefined);

        await clearJobs();
      });
    });
  });

  describe("cancel", function () {
    beforeEach(async function () {
      let remaining = 3;
      const checkDone = function () {
        remaining -= 1;
      };

      await globalAgenda.create("jobA").save().then(checkDone);
      await globalAgenda.create("jobA", "someData").save().then(checkDone);
      await globalAgenda.create("jobB").save().then(checkDone);
      strictEqual(remaining, 0);
    });

    afterEach(async function () {
      await globalAgenda.db.removeJobs({ name: { $in: ["jobA", "jobB"] } });
    });

    it("should cancel a job", async function () {
      const j = await globalAgenda.jobs({ name: "jobA" });
      strictEqual(j.length, 2);

      await globalAgenda.cancel({ name: "jobA" });
      const job = await globalAgenda.jobs({ name: "jobA" });

      strictEqual(job.length, 0);
    });

    it("should cancel multiple jobs", async function () {
      const jobs1 = await globalAgenda.jobs({ name: { $in: ["jobA", "jobB"] } });
      strictEqual(jobs1.length, 3);
      await globalAgenda.cancel({ name: { $in: ["jobA", "jobB"] } });

      const jobs2 = await globalAgenda.jobs({ name: { $in: ["jobA", "jobB"] } });
      strictEqual(jobs2.length, 0);
    });

    it("should cancel jobs only if the data matches", async function () {
      const jobs1 = await globalAgenda.jobs({ name: "jobA", data: "someData" });
      strictEqual(jobs1.length, 1);
      await globalAgenda.cancel({ name: "jobA", data: "someData" });

      const jobs2 = await globalAgenda.jobs({ name: "jobA", data: "someData" });
      strictEqual(jobs2.length, 0);

      const jobs3 = await globalAgenda.jobs({ name: "jobA" });
      strictEqual(jobs3.length, 1);
    });
  });

  describe("search", function () {
    beforeEach(async function () {
      await globalAgenda.create("jobA", 1).save();
      await globalAgenda.create("jobA", 2).save();
      await globalAgenda.create("jobA", 3).save();
    });

    afterEach(async function () {
      await globalAgenda.db.removeJobs({ name: "jobA" });
    });

    it("should limit jobs", async function () {
      const results = await globalAgenda.jobs({ name: "jobA" }, {}, 2);
      strictEqual(results.length, 2);
    });

    it("should skip jobs", async function () {
      const results = await globalAgenda.jobs({ name: "jobA" }, {}, 2, 2);
      strictEqual(results.length, 1);
    });

    it("should sort jobs", async function () {
      const results = await globalAgenda.jobs({ name: "jobA" }, { data: -1 });

      strictEqual(results.length, 3);

      const job1 = results[0];
      const job2 = results[1];
      const job3 = results[2];

      strictEqual(job1.attrs.data, 3);
      strictEqual(job2.attrs.data, 2);
      strictEqual(job3.attrs.data, 1);
    });
  });

  describe("ensureIndex findAndLockNextJobIndex", function () {
    it("ensureIndex-Option false does not create index findAndLockNextJobIndex", async function () {
      const agenda = new Agenda({
        mongo: mongoDb,
        ensureIndex: false,
      });

      agenda.define("someJob", jobProcessor);
      await agenda.create("someJob", 1).save();

      const listIndex = await mongoDb.command({ listIndexes: "agendaJobs" });
      strictEqual(listIndex.cursor.firstBatch.length, 1);
      strictEqual(listIndex.cursor.firstBatch[0].name, "_id_");
    });

    it("ensureIndex-Option true does create index findAndLockNextJobIndex", async function () {
      const agenda = new Agenda({
        mongo: mongoDb,
        ensureIndex: true,
      });

      agenda.define("someJob", jobProcessor);
      await agenda.create("someJob", 1).save();

      const listIndex = await mongoDb.command({ listIndexes: "agendaJobs" });
      strictEqual(listIndex.cursor.firstBatch.length, 2);
      strictEqual(listIndex.cursor.firstBatch[0].name, "_id_");
      strictEqual(listIndex.cursor.firstBatch[1].name, "findAndLockNextJobIndex");
    });

    it("creating two agenda-instances with ensureIndex-Option true does not throw an error", async function () {
      const agenda = new Agenda({
        mongo: mongoDb,
        ensureIndex: true,
      });

      agenda.define("someJob", jobProcessor);
      await agenda.create("someJob", 1).save();

      const secondAgenda = new Agenda({
        mongo: mongoDb,
        ensureIndex: true,
      });

      secondAgenda.define("someJob", jobProcessor);
      await secondAgenda.create("someJob", 1).save();
    });
  });

  describe("process jobs", function () {
    it("do not run failed jobs again", async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unhandledRejections: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rejectionsHandler = (error: any) => unhandledRejections.push(error);
      process.on("unhandledRejection", rejectionsHandler);

      let jprocesses = 0;

      globalAgenda.define("failing job", async (_job) => {
        jprocesses++;
        throw new Error("failed");
      });

      let failCalled = false;
      globalAgenda.on("fail:failing job", (_err) => {
        failCalled = true;
      });

      let errorCalled = false;
      globalAgenda.on("error", (_err) => {
        errorCalled = true;
      });

      globalAgenda.processEvery(100);
      await globalAgenda.start();

      await globalAgenda.now("failing job");

      await delay(500);

      process.removeListener("unhandledRejection", rejectionsHandler);

      strictEqual(jprocesses, 1);
      strictEqual(errorCalled, false);
      strictEqual(failCalled, true);
      strictEqual(unhandledRejections.length, 0);
    }).timeout(10000);

    it("ensure there is no unhandledPromise on job timeouts", async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unhandledRejections: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rejectionsHandler = (error: any) => unhandledRejections.push(error);
      process.on("unhandledRejection", rejectionsHandler);

      globalAgenda.define(
        "very short timeout",
        (_job, done) => {
          setTimeout(() => {
            done();
          }, 10000);
        },
        {
          lockLifetime: 100,
        }
      );

      let errorCalled = false;
      globalAgenda.on("error", (_err) => {
        errorCalled = true;
      });

      globalAgenda.processEvery(100);
      await globalAgenda.start();

      await globalAgenda.now("very short timeout");

      await delay(500);

      process.removeListener("unhandledRejection", rejectionsHandler);

      strictEqual(errorCalled, true);
      strictEqual(unhandledRejections.length, 0);
    }).timeout(10000);

    it("should not cause unhandledRejection", async function () {
      // This unit tests if for this bug [https://github.com/agenda/agenda/issues/884]
      // which is not reproducible with default agenda config on shorter processEvery.
      // Thus we set the test timeout to 10000, and the delay below to 6000.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unhandledRejections: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rejectionsHandler = (error: any) => unhandledRejections.push(error);
      process.on("unhandledRejection", rejectionsHandler);

      let j1processes = 0;

      globalAgenda.define("j1", (_job, done) => {
        j1processes += 1;
        done();
      });

      let j2processes = 0;
      globalAgenda.define("j2", (_job, done) => {
        j2processes += 1;
        done();
      });

      let j3processes = 0;
      globalAgenda.define("j3", async (_job) => {
        j3processes += 1;
      });
      await globalAgenda.start();

      await globalAgenda.every("5 seconds", "j1");
      await globalAgenda.every("10 seconds", "j2");
      await globalAgenda.every("15 seconds", "j3");

      await delay(3001);

      process.removeListener("unhandledRejection", rejectionsHandler);

      strictEqual(1 <= j1processes, true);
      strictEqual(j2processes, 1);
      strictEqual(j3processes, 1);

      strictEqual(unhandledRejections.length, 0);
    }).timeout(10000);
  });
});
