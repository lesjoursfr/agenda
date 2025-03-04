import { DateTime } from "luxon";
import { Db } from "mongodb";
import { deepStrictEqual, fail, notStrictEqual, strictEqual } from "node:assert";
import cp from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as sinon from "sinon";
import { Agenda } from "../src/index";
import { Job } from "../src/job";
import someJobDefinition from "./fixtures/some-job-definition";
import { IMockMongo, mockMongo } from "./helpers/mock-mongodb";

// Slow timeouts for Travis
const jobTimeout = 500;
const jobType = "do work";
const jobProcessor = function () {};

describe("Job", function () {
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
  let agenda: Agenda;

  beforeEach(async function () {
    return new Promise((resolve) => {
      agenda = new Agenda(
        {
          mongo: mongoDb,
        },
        async function () {
          await delay(50);
          await clearJobs();
          agenda.define("someJob", jobProcessor);
          agenda.define("send email", jobProcessor);
          agenda.define("some job", jobProcessor);
          agenda.define(jobType, jobProcessor);
          return resolve();
        }
      );
    });
  });

  afterEach(async function () {
    await delay(50);
    await agenda.stop();
    await clearJobs();
  });

  describe("repeatAt", function () {
    const job = new Job(agenda, { name: "demo", type: "normal" });
    it("sets the repeat at", function () {
      job.repeatAt("3:30pm");
      strictEqual(job.attrs.repeatAt, "3:30pm");
    });
    it("returns the job", function () {
      strictEqual(job.repeatAt("3:30pm"), job);
    });
  });

  describe("toJSON", function () {
    it("failedAt", function () {
      let job = new Job(agenda, {
        name: "demo",
        type: "normal",
        nextRunAt: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        failedAt: null as any,
      });
      strictEqual(job.toJson().failedAt instanceof Date, false);

      job = new Job(agenda, {
        name: "demo",
        type: "normal",
        nextRunAt: null,
        failedAt: new Date(),
      });
      strictEqual(job.toJson().failedAt instanceof Date, true);
    });
  });

  describe("unique", function () {
    const job = new Job(agenda, { name: "demo", type: "normal" });
    it("sets the unique property", function () {
      job.unique({ "data.type": "active", "data.userId": "123" });
      strictEqual(JSON.stringify(job.attrs.unique), JSON.stringify({ "data.type": "active", "data.userId": "123" }));
    });
    it("returns the job", function () {
      strictEqual(job.unique({ "data.type": "active", "data.userId": "123" }), job);
    });
  });

  describe("repeatEvery", function () {
    const job = new Job(agenda, { name: "demo", type: "normal" });
    it("sets the repeat interval", function () {
      job.repeatEvery(5000);
      strictEqual(job.attrs.repeatInterval, 5000);
    });
    it("returns the job", function () {
      strictEqual(job.repeatEvery("one second"), job);
    });
    it("sets the nextRunAt property with skipImmediate", function () {
      const job2 = new Job(agenda, { name: "demo", type: "normal" });
      const now = new Date().valueOf();
      job2.repeatEvery("3 minutes", { skipImmediate: true });
      strictEqual(new Date(now + 180000 - 2) <= job2.attrs.nextRunAt!, true);
      strictEqual(job2.attrs.nextRunAt! <= new Date(now + 180002), true);
    });
    it("repeats from the existing nextRunAt property with skipImmediate", function () {
      const job2 = new Job(agenda, { name: "demo", type: "normal" });
      const futureDate = new Date("3000-01-01T00:00:00");
      job2.attrs.nextRunAt = futureDate;
      job2.repeatEvery("3 minutes", { skipImmediate: true });
      strictEqual(job2.attrs.nextRunAt!.getTime(), futureDate.getTime() + 180000);
    });
    it("repeats from the existing scheduled date with skipImmediate", function () {
      const futureDate = new Date("3000-01-01T00:00:00");
      const job2 = new Job(agenda, { name: "demo", type: "normal" }).schedule(futureDate);
      job2.repeatEvery("3 minutes", { skipImmediate: true });
      strictEqual(job2.attrs.nextRunAt!.getTime(), futureDate.valueOf() + 180000);
    });
  });

  describe("schedule", function () {
    let job: Job;
    beforeEach(() => {
      job = new Job(agenda, { name: "demo", type: "normal" });
    });
    it("sets the next run time", function () {
      job.schedule("in 5 minutes");
      strictEqual(job.attrs.nextRunAt instanceof Date, true);
    });
    it("sets the next run time Date object", function () {
      const when = new Date(Date.now() + 1000 * 60 * 3);
      job.schedule(when);
      strictEqual(job.attrs.nextRunAt instanceof Date, true);
      strictEqual(job.attrs.nextRunAt?.getTime(), when.getTime());
    });
    it("returns the job", function () {
      strictEqual(job.schedule("tomorrow at noon"), job);
    });
    it("understands ISODates on the 30th", function () {
      // https://github.com/agenda/agenda/issues/807
      strictEqual(job.schedule("2019-04-30T22:31:00.00Z").attrs.nextRunAt?.getTime(), 1556663460000);
    });
  });

  describe("priority", function () {
    let job: Job;
    beforeEach(() => {
      job = new Job(agenda, { name: "demo", type: "normal" });
    });
    it("sets the priority to a number", function () {
      job.priority(10);
      strictEqual(job.attrs.priority, 10);
    });
    it("returns the job", function () {
      strictEqual(job.priority(50), job);
    });
    it("parses written priorities", function () {
      job.priority("high");
      strictEqual(job.attrs.priority, 10);
    });
  });

  describe("computeNextRunAt", function () {
    let job: Job;

    beforeEach(() => {
      job = new Job(agenda, { name: "demo", type: "normal" });
    });

    it("returns the job", function () {
      const jobProto = Object.getPrototypeOf(job);
      strictEqual(jobProto.computeNextRunAt.call(job), job);
    });

    it("sets to undefined if no repeat at", function () {
      job.attrs.repeatAt = undefined;
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt, null);
    });

    it("it understands repeatAt times", function () {
      const d = new Date();
      d.setHours(23);
      d.setMinutes(59);
      d.setSeconds(0);
      job.attrs.repeatAt = "11:59pm";
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt?.getHours(), d.getHours());
      strictEqual(job.attrs.nextRunAt?.getMinutes(), d.getMinutes());
    });

    it("sets to undefined if no repeat interval", function () {
      job.attrs.repeatInterval = undefined;
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt, null);
    });

    it("it understands human intervals", function () {
      const now = new Date();
      job.attrs.lastRunAt = now;
      job.repeatEvery("2 minutes");
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt?.getTime(), now.valueOf() + 120000);
    });

    it("understands cron intervals", function () {
      const now = new Date();
      now.setMinutes(1);
      now.setMilliseconds(0);
      now.setSeconds(0);
      job.attrs.lastRunAt = now;
      job.repeatEvery("*/2 * * * *");
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt?.valueOf(), now.valueOf() + 60000);
    });

    it("understands cron intervals with a timezone", function () {
      const date = new Date("2015-01-01T06:01:00-00:00");
      job.attrs.lastRunAt = date;
      job.repeatEvery("0 6 * * *", {
        timezone: "GMT",
      });
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone("GMT").hour, 6);
      strictEqual(
        DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate(),
        DateTime.fromJSDate(job.attrs.lastRunAt!).plus({ days: 1 }).toJSDate().getDate()
      );
    });

    it("understands cron intervals with a vienna timezone with higher hours", function () {
      const date = new Date("2015-01-01T06:01:00-00:00");
      job.attrs.lastRunAt = date;
      job.repeatEvery("0 16 * * *", {
        timezone: "Europe/Vienna",
      });
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone("GMT").hour, 15);
      strictEqual(
        DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate(),
        DateTime.fromJSDate(job.attrs.lastRunAt!).toJSDate().getDate()
      );
    });

    it("understands cron intervals with a timezone when last run is the same as the interval", function () {
      const date = new Date("2015-01-01T06:00:00-00:00");
      job.attrs.lastRunAt = date;
      job.repeatEvery("0 6 * * *", {
        timezone: "GMT",
      });
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(DateTime.fromJSDate(job.attrs.nextRunAt!).setZone("GMT").hour, 6);
      strictEqual(
        DateTime.fromJSDate(job.attrs.nextRunAt!).toJSDate().getDate(),
        DateTime.fromJSDate(job.attrs.lastRunAt!).plus({ days: 1 }).toJSDate().getDate()
      );
    });

    it("gives the correct nextDate when the lastRun is 1ms before the expected time", function () {
      // (Issue #858): lastRunAt being 1ms before the nextRunAt makes cronTime return the same nextRunAt
      const last = new Date();
      last.setSeconds(59);
      last.setMilliseconds(999);
      const next = new Date(last.valueOf() + 1);
      const expectedDate = new Date(next.valueOf() + 60000);
      job.attrs.lastRunAt = last;
      job.attrs.nextRunAt = next;
      job.repeatEvery("* * * * *", {
        timezone: "GMT",
      });
      const jobProto = Object.getPrototypeOf(job);
      jobProto.computeNextRunAt.call(job);
      strictEqual(job.attrs.nextRunAt.valueOf(), expectedDate.valueOf());
    });

    it("cron job with month starting at 1", async function () {
      job.repeatEvery("0 0 * 1 *", {
        timezone: "GMT",
      });
      if (job.attrs.nextRunAt) {
        strictEqual(job.attrs.nextRunAt.getMonth(), 0);
      } else {
        fail();
      }
    });

    it("repeating job with cron", async function () {
      job.repeatEvery("0 0 * 1 *", {
        timezone: "GMT",
      });
      notStrictEqual(job.attrs.nextRunAt, null);
    });

    describe("when repeat at time is invalid", function () {
      beforeEach(() => {
        job.attrs.repeatAt = "foo";
        const jobProto = Object.getPrototypeOf(job);
        jobProto.computeNextRunAt.call(job);
      });

      it("sets nextRunAt to null", function () {
        strictEqual(job.attrs.nextRunAt, null);
      });

      it("fails the job", function () {
        strictEqual(job.attrs.failReason, "failed to calculate repeatAt time due to invalid format");
      });
    });

    describe("when repeat interval is invalid", function () {
      beforeEach(() => {
        job.attrs.repeatInterval = "asd";
        const jobProto = Object.getPrototypeOf(job);
        jobProto.computeNextRunAt.call(job);
      });

      it("sets nextRunAt to null", function () {
        strictEqual(job.attrs.nextRunAt, null);
      });

      it("fails the job", function () {
        strictEqual(
          job.attrs.failReason,
          "failed to calculate nextRunAt due to invalid repeat interval (asd): Error: Constraint error, got value 0 expected range 1-12"
        );
      });
    });
  });

  describe("remove", function () {
    it("removes the job", async function () {
      const job = new Job(agenda, {
        name: "removed job",
        type: "normal",
      });
      await job.save();
      const resultSaved = await mongoDb
        .collection("agendaJobs")
        .find({
          _id: job.attrs._id,
        })
        .toArray();

      strictEqual(resultSaved.length, 1);
      await job.remove();

      const resultDeleted = await mongoDb
        .collection("agendaJobs")
        .find({
          _id: job.attrs._id,
        })
        .toArray();

      strictEqual(resultDeleted.length, 0);
    });
  });

  describe("run", function () {
    beforeEach(async function () {
      agenda.define("testRun", (_job, done) => {
        setTimeout(() => {
          done();
        }, 100);
      });
    });

    it("updates lastRunAt", async function () {
      const job = new Job(agenda, { name: "testRun", type: "normal" });
      await job.save();
      const now = new Date();
      await delay(5);
      await job.run();

      strictEqual(now.valueOf() < (job.attrs.lastRunAt?.valueOf() ?? -Infinity), true);
    });

    it("fails if job is undefined", async function () {
      const job = new Job(agenda, { name: "not defined", type: "normal" });
      await job.save();

      await job.run().catch((error) => {
        strictEqual(error.message, "Undefined job");
      });
      notStrictEqual(job.attrs.failedAt, undefined);
      strictEqual(job.attrs.failReason, "Undefined job");
    });

    it("updates nextRunAt", async function () {
      const job = new Job(agenda, { name: "testRun", type: "normal" });
      await job.save();

      const now = new Date();
      job.repeatEvery("10 minutes");
      await delay(5);
      await job.run();
      strictEqual(now.valueOf() + 59999 < (job.attrs.nextRunAt?.valueOf() ?? -Infinity), true);
    });

    it("handles errors", async function () {
      const job = new Job(agenda, { name: "failBoat", type: "normal" });
      await job.save();

      agenda.define("failBoat", function () {
        throw new Error("Zomg fail");
      });
      await job.run();
      strictEqual(job.attrs.failReason, "Zomg fail");
    });

    it("handles errors with q promises", async function () {
      const job = new Job(agenda, { name: "failBoat2", type: "normal" });
      await job.save();

      agenda.define("failBoat2", async (_job, cb) => {
        try {
          throw new Error("Zomg fail");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (err: any) {
          cb(err);
        }
      });
      await job.run();
      notStrictEqual(job.attrs.failReason, undefined);
    });

    it("allows async functions", async function () {
      const job = new Job(agenda, { name: "async", type: "normal" });
      await job.save();

      const successSpy = sinon.stub();
      let finished = false;

      agenda.once("success:async", successSpy);

      agenda.define("async", async function () {
        await delay(5);
        finished = true;
      });

      strictEqual(finished, false);
      await job.run();
      strictEqual(successSpy.callCount, 1);
      strictEqual(finished, true);
    });

    it("handles errors from async functions", async function () {
      const job = new Job(agenda, { name: "asyncFail", type: "normal" });
      await job.save();

      const failSpy = sinon.stub();
      const err = new Error("failure");

      agenda.once("fail:asyncFail", failSpy);

      agenda.define("asyncFail", async function () {
        await delay(5);
        throw err;
      });

      await job.run();
      strictEqual(failSpy.callCount, 1);
      strictEqual(failSpy.calledWith(err), true);
    });

    it("waits for the callback to be called even if the function is async", async function () {
      const job = new Job(agenda, { name: "asyncCb", type: "normal" });
      await job.save();

      const successSpy = sinon.stub();
      let finishedCb = false;

      agenda.once("success:asyncCb", successSpy);

      agenda.define("asyncCb", async (_job, cb) => {
        (async function () {
          await delay(5);
          finishedCb = true;
          cb();
        })();
      });

      await job.run();
      strictEqual(finishedCb, true);
      strictEqual(successSpy.callCount, 1);
    });

    it("uses the callback error if the function is async and didn't reject", async function () {
      const job = new Job(agenda, { name: "asyncCbError", type: "normal" });
      await job.save();

      const failSpy = sinon.stub();
      const err = new Error("failure");

      agenda.once("fail:asyncCbError", failSpy);

      agenda.define("asyncCbError", async (_job, cb) => {
        (async function () {
          await delay(5);
          cb(err);
        })();
      });

      await job.run();
      strictEqual(failSpy.callCount, 1);
      strictEqual(failSpy.calledWith(err), true);
    });

    it("favors the async function error over the callback error if it comes first", async function () {
      const job = new Job(agenda, { name: "asyncCbTwoError", type: "normal" });
      await job.save();

      const failSpy = sinon.stub();
      const fnErr = new Error("functionFailure");
      const cbErr = new Error("callbackFailure");

      agenda.on("fail:asyncCbTwoError", failSpy);

      agenda.define("asyncCbTwoError", async (_job, cb) => {
        (async function () {
          await delay(5);
          cb(cbErr);
        })();

        throw fnErr;
      });

      await job.run();
      strictEqual(failSpy.callCount, 1);
      strictEqual(failSpy.calledWith(fnErr), true);
      strictEqual(failSpy.calledWith(cbErr), false);
    });

    it("favors the callback error over the async function error if it comes first", async function () {
      const job = new Job(agenda, { name: "asyncCbTwoErrorCb", type: "normal" });
      await job.save();

      const failSpy = sinon.stub();
      const fnErr = new Error("functionFailure");
      const cbErr = new Error("callbackFailure");

      agenda.on("fail:asyncCbTwoErrorCb", failSpy);

      agenda.define("asyncCbTwoErrorCb", async (_job, cb) => {
        cb(cbErr);
        await delay(5);
        throw fnErr;
      });

      await job.run();
      strictEqual(failSpy.callCount, 1);
      strictEqual(failSpy.calledWith(cbErr), true);
      strictEqual(failSpy.calledWith(fnErr), false);
    });

    it("doesn't allow a stale job to be saved", async function () {
      const job = new Job(agenda, { name: "failBoat3", type: "normal" });
      await job.save();

      agenda.define("failBoat3", async (_job, cb) => {
        // Explicitly find the job again,
        // so we have a new job object
        const jobs = await agenda.jobs({ name: "failBoat3" });
        strictEqual(jobs.length, 1);
        await jobs[0].remove();
        cb();
      });

      await job.run();

      // Expect the deleted job to not exist in the database
      const deletedJob = await agenda.jobs({ name: "failBoat3" });
      strictEqual(deletedJob.length, 0);
    });
  });

  describe("touch", function () {
    it("extends the lock lifetime", async function () {
      const lockedAt = new Date();
      const job = new Job(agenda, { name: "some job", type: "normal", lockedAt });
      await job.save();
      await delay(2);
      await job.touch();
      strictEqual(lockedAt.valueOf() < job.attrs.lockedAt!.valueOf(), true);
    });
  });

  describe("fail", function () {
    const job = new Job(agenda, { name: "demo", type: "normal" });
    it("takes a string", function () {
      job.fail("test");
      strictEqual(job.attrs.failReason, "test");
    });
    it("takes an error object", function () {
      job.fail(new Error("test"));
      strictEqual(job.attrs.failReason, "test");
    });
    it("sets the failedAt time", function () {
      job.fail("test");
      strictEqual(job.attrs.failedAt instanceof Date, true);
    });
    it("sets the failedAt time equal to lastFinishedAt time", function () {
      job.fail("test");
      strictEqual(job.attrs.failedAt, job.attrs.lastFinishedAt);
    });
  });

  describe("enable", function () {
    it("sets disabled to false on the job", function () {
      const job = new Job(agenda, { name: "test", type: "normal", disabled: true });
      job.enable();
      strictEqual(job.attrs.disabled, false);
    });

    it("returns the job", function () {
      const job = new Job(agenda, { name: "test", type: "normal", disabled: true });
      strictEqual(job.enable(), job);
    });
  });

  describe("disable", function () {
    it("sets disabled to true on the job", function () {
      const job = new Job(agenda, { name: "demo", type: "normal" });
      job.disable();
      strictEqual(job.attrs.disabled, true);
    });
    it("returns the job", function () {
      const job = new Job(agenda, { name: "demo", type: "normal" });
      strictEqual(job.disable(), job);
    });
  });

  describe("save", function () {
    it("doesnt save the job if its been removed", async function () {
      const job = agenda.create("another job");
      // Save, then remove, then try and save again.
      // The second save should fail.
      const j = await job.save();
      await j.remove();
      await j.save();

      const jobs = await agenda.jobs({ name: "another job" });
      strictEqual(jobs.length, 0);
    });

    it("returns the job", async function () {
      const job = agenda.create("some job", {
        wee: 1,
      });
      strictEqual(await job.save(), job);
    });
  });

  describe("start/stop", function () {
    it("starts/stops the job queue", async function () {
      const processed = new Promise((resolve) => {
        agenda.define("jobQueueTest", async (_job) => {
          resolve("processed");
        });
      });
      await agenda.every("1 second", "jobQueueTest");
      agenda.processEvery("1 second");
      await agenda.start();

      strictEqual(
        await Promise.race([
          processed,
          new Promise((resolve) => {
            setTimeout(() => resolve(`not processed`), 1100);
          }),
        ]),
        "processed"
      );

      await agenda.stop();
      const processedStopped = new Promise<void>((resolve) => {
        agenda.define("jobQueueTest", async (_job) => {
          resolve();
        });
      });

      strictEqual(
        await Promise.race([
          processedStopped,
          new Promise((resolve) => {
            setTimeout(() => resolve(`not processed`), 1100);
          }),
        ]),
        "not processed"
      );
    });

    it("does not run disabled jobs", async function () {
      let ran = false;
      agenda.define("disabledJob", function () {
        ran = true;
      });

      const job = await agenda.create("disabledJob").disable().schedule("now");
      await job.save();
      await agenda.start();
      await delay(jobTimeout);

      strictEqual(ran, false);

      await agenda.stop();
    });

    it("does not throw an error trying to process undefined jobs", async function () {
      await agenda.start();
      const job = agenda.create("jobDefinedOnAnotherServer").schedule("now");

      await job.save();

      await delay(jobTimeout);
      await agenda.stop();
    });

    it("clears locks on stop", async function () {
      agenda.define("longRunningJob", (_job, _cb) => {
        // Job never finishes
      });
      agenda.every("10 seconds", "longRunningJob");
      agenda.processEvery("1 second");

      await agenda.start();
      await delay(jobTimeout);
      const jobStarted = await agenda.db.getJobs({ name: "longRunningJob" });
      notStrictEqual(jobStarted[0].lockedAt, null);
      await agenda.stop();
      const job = await agenda.db.getJobs({ name: "longRunningJob" });
      strictEqual(job[0].lockedAt, undefined);
    });

    describe("events", function () {
      beforeEach(() => {
        agenda.define("jobQueueTest", (_job, cb) => {
          cb();
        });
        agenda.define("failBoat", function () {
          throw new Error("Zomg fail");
        });
      });

      it("emits start event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("start", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits start:job name event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("start:jobQueueTest", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits complete event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("complete", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits complete:job name event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("complete:jobQueueTest", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits success event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("success", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits success:job name event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "jobQueueTest", type: "normal" });
        await job.save();
        agenda.once("success:jobQueueTest", spy);

        await job.run();
        strictEqual(spy.called, true);
        strictEqual(spy.calledWithExactly(job), true);
      });

      it("emits fail event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "failBoat", type: "normal" });
        await job.save();
        agenda.once("fail", spy);

        await job.run().catch((error) => {
          strictEqual(error.message, "Zomg fail");
        });

        strictEqual(spy.called, true);

        const err = spy.args[0][0];
        strictEqual(err.message, "Zomg fail");
        strictEqual(job.attrs.failCount, 1);
        strictEqual(job.attrs.lastFinishedAt!.valueOf() < job.attrs.failedAt!.valueOf(), false);
      });

      it("emits fail:job name event", async function () {
        const spy = sinon.spy();
        const job = new Job(agenda, { name: "failBoat", type: "normal" });
        await job.save();
        agenda.once("fail:failBoat", spy);

        await job.run().catch((error) => {
          strictEqual(error.message, "Zomg fail");
        });

        strictEqual(spy.called, true);

        const err = spy.args[0][0];
        strictEqual(err.message, "Zomg fail");
        strictEqual(job.attrs.failCount, 1);
        strictEqual(job.attrs.lastFinishedAt!.valueOf() < job.attrs.failedAt!.valueOf(), false);
      });
    });
  });

  describe("job lock", function () {
    it("runs a recurring job after a lock has expired", async function () {
      const processorPromise = new Promise((resolve) => {
        let startCounter = 0;
        agenda.define(
          "lock job",
          async function () {
            startCounter++;

            if (startCounter !== 1) {
              await agenda.stop();
              resolve(startCounter);
            }
          },
          {
            lockLifetime: 50,
          }
        );
      });

      strictEqual(agenda.definitions["lock job"].lockLifetime, 50);

      agenda.defaultConcurrency(100);
      agenda.processEvery(10);
      agenda.every("0.02 seconds", "lock job");
      await agenda.stop();
      await agenda.start();
      strictEqual(await processorPromise, 2);
    });

    it("runs a one-time job after its lock expires", async function () {
      const processorPromise = new Promise((resolve) => {
        let runCount = 0;

        agenda.define(
          "lock job",
          async (_job) => {
            runCount++;
            if (runCount === 1) {
              // this should time out
              await new Promise((longResolve) => {
                setTimeout(longResolve, 1000);
              });
            } else {
              await new Promise((longResolve) => {
                setTimeout(longResolve, 10);
              });
              resolve(runCount);
            }
          },
          {
            lockLifetime: 50,
            concurrency: 1,
          }
        );
      });

      let errorHasBeenThrown!: Error;
      agenda.on("error", (err) => {
        errorHasBeenThrown = err;
      });
      agenda.processEvery(25);
      await agenda.start();
      agenda.now("lock job", {
        i: 1,
      });
      strictEqual(await processorPromise, 2);
      strictEqual(errorHasBeenThrown?.message.includes("execution of 'lock job' canceled"), true);
    });

    it("does not process locked jobs", async function () {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const history: any[] = [];

      agenda.define(
        "lock job",
        (job, cb) => {
          history.push(job.attrs.data.i);

          setTimeout(() => {
            cb();
          }, 150);
        },
        {
          lockLifetime: 300,
        }
      );

      agenda.processEvery(100);
      await agenda.start();

      await Promise.all([
        agenda.now("lock job", { i: 1 }),
        agenda.now("lock job", { i: 2 }),
        agenda.now("lock job", { i: 3 }),
      ]);

      await delay(500);
      strictEqual(history.length, 3);
      strictEqual(history.includes(1), true);
      strictEqual(history.includes(2), true);
      strictEqual(history.includes(3), true);
    });

    it("does not on-the-fly lock more than agenda._lockLimit jobs", async function () {
      agenda.lockLimit(1);

      agenda.define("lock job", (_job, _cb) => {
        /* this job nevers finishes */
      });

      await agenda.start();

      await Promise.all([agenda.now("lock job", { i: 1 }), agenda.now("lock job", { i: 2 })]);

      // give it some time to get picked up
      await delay(200);

      strictEqual((await agenda.getRunningStats()).lockedJobs, 1);
    });

    it("does not on-the-fly lock more mixed jobs than agenda._lockLimit jobs", async function () {
      agenda.lockLimit(1);

      agenda.define("lock job", (_job, _cb) => {});
      agenda.define("lock job2", (_job, _cb) => {});
      agenda.define("lock job3", (_job, _cb) => {});
      agenda.define("lock job4", (_job, _cb) => {});
      agenda.define("lock job5", (_job, _cb) => {});

      await agenda.start();

      await Promise.all([
        agenda.now("lock job", { i: 1 }),
        agenda.now("lock job5", { i: 2 }),
        agenda.now("lock job4", { i: 3 }),
        agenda.now("lock job3", { i: 4 }),
        agenda.now("lock job2", { i: 5 }),
      ]);

      await delay(500);
      strictEqual((await agenda.getRunningStats()).lockedJobs, 1);
      await agenda.stop();
    });

    it("does not on-the-fly lock more than definition.lockLimit jobs", async function () {
      agenda.define("lock job", (_job, _cb) => {}, { lockLimit: 1 });

      await agenda.start();

      await Promise.all([agenda.now("lock job", { i: 1 }), agenda.now("lock job", { i: 2 })]);

      await delay(500);
      strictEqual((await agenda.getRunningStats()).lockedJobs, 1);
    });

    it("does not lock more than agenda._lockLimit jobs during processing interval", async function () {
      agenda.lockLimit(1);
      agenda.processEvery(200);

      agenda.define("lock job", (_job, _cb) => {});

      await agenda.start();

      const when = DateTime.local().plus({ milliseconds: 300 }).toJSDate();

      await Promise.all([agenda.schedule(when, "lock job", { i: 1 }), agenda.schedule(when, "lock job", { i: 2 })]);

      await delay(500);
      strictEqual((await agenda.getRunningStats()).lockedJobs, 1);
    });

    it("does not lock more than definition.lockLimit jobs during processing interval", async function () {
      agenda.processEvery(200);

      agenda.define("lock job", (_job, _cb) => {}, { lockLimit: 1 });

      await agenda.start();

      const when = DateTime.local().plus({ milliseconds: 300 }).toJSDate();

      await Promise.all([agenda.schedule(when, "lock job", { i: 1 }), agenda.schedule(when, "lock job", { i: 2 })]);

      await delay(500);
      strictEqual((await agenda.getRunningStats()).lockedJobs, 1);
      await agenda.stop();
    });
  });

  describe("job concurrency", function () {
    it("should not block a job for concurrency of another job", async function () {
      agenda.processEvery(50);

      const processed: number[] = [];
      const now = Date.now();

      agenda.define(
        "blocking",
        (job, cb) => {
          processed.push(job.attrs.data.i);
          setTimeout(cb, 400);
        },
        {
          concurrency: 1,
        }
      );

      const checkResultsPromise = new Promise<number[]>((resolve) => {
        agenda.define(
          "non-blocking",
          (job) => {
            processed.push(job.attrs.data.i);
            resolve(processed);
          },
          {
            // Lower priority to keep it at the back in the queue
            priority: "lowest",
          }
        );
      });

      let finished = false;
      agenda.on("complete", function () {
        if (!finished && processed.length === 3) {
          finished = true;
        }
      });

      agenda.start();

      await Promise.all([
        agenda.schedule(new Date(now + 100), "blocking", { i: 1 }),
        agenda.schedule(new Date(now + 101), "blocking", { i: 2 }),
        agenda.schedule(new Date(now + 102), "non-blocking", { i: 3 }),
      ]);

      try {
        const results: number[] = await Promise.race([
          checkResultsPromise,

          new Promise<number[]>((_, reject) => {
            setTimeout(() => {
              reject(`not processed`);
            }, 2000);
          }),
        ]);
        strictEqual(results.includes(2), false);
      } catch (err) {
        console.log("stats", err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
        throw err;
      }
    });

    it("should run jobs as first in first out (FIFO)", async function () {
      agenda.processEvery(100);
      agenda.define("fifo", (_job, cb) => cb(), { concurrency: 1 });

      const checkResultsPromise = new Promise<number[]>((resolve) => {
        const results: number[] = [];

        agenda.on("start:fifo", (job) => {
          results.push(new Date(job.attrs.nextRunAt!).getTime());
          if (results.length !== 3) {
            return;
          }

          resolve(results);
        });
      });

      await agenda.start();

      await agenda.now("fifo");
      await delay(50);
      await agenda.now("fifo");
      await delay(50);
      await agenda.now("fifo");
      await delay(50);
      try {
        const results: number[] = await Promise.race([
          checkResultsPromise,

          new Promise<number[]>((_, reject) => {
            setTimeout(() => {
              reject(`not processed`);
            }, 2000);
          }),
        ]);
        strictEqual(results.join(""), results.sort().join(""));
      } catch (err) {
        console.log("stats", err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
        throw err;
      }
    });

    it("should run jobs as first in first out (FIFO) with respect to priority", async function () {
      const now = Date.now();

      agenda.define("fifo-priority", (_job, cb) => setTimeout(cb, 100), { concurrency: 1 });

      const checkResultsPromise = new Promise((resolve) => {
        const times: number[] = [];
        const priorities: number[] = [];

        agenda.on("start:fifo-priority", (job) => {
          priorities.push(job.attrs.priority);
          times.push(new Date(job.attrs.lastRunAt!).getTime());
          if (priorities.length !== 3 || times.length !== 3) {
            return;
          }

          resolve({ times, priorities });
        });
      });

      await Promise.all([
        agenda.create("fifo-priority", { i: 1 }).schedule(new Date(now)).priority("high").save(),
        agenda
          .create("fifo-priority", { i: 2 })
          .schedule(new Date(now + 100))
          .priority("low")
          .save(),
        agenda
          .create("fifo-priority", { i: 3 })
          .schedule(new Date(now + 100))
          .priority("high")
          .save(),
      ]);
      await agenda.start();
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { times, priorities } = await Promise.race<any>([
          checkResultsPromise,

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          new Promise<any>((_, reject) => {
            setTimeout(() => {
              reject(`not processed`);
            }, 2000);
          }),
        ]);

        strictEqual(times.join(""), times.sort().join(""));
        deepStrictEqual(priorities, [10, 10, -10]);
      } catch (err) {
        console.log("stats", err, JSON.stringify(await agenda.getRunningStats(), undefined, 3));
        throw err;
      }
    });

    it("should run higher priority jobs first", async function () {
      // Inspired by tests added by @lushc here:
      // <https://github.com/agenda/agenda/pull/451/commits/336ff6445803606a6dc468a6f26c637145790adc>
      const now = new Date();

      agenda.define("priority", (_job, cb) => setTimeout(cb, 10), { concurrency: 1 });

      const checkResultsPromise = new Promise((resolve) => {
        const results: number[] = [];

        agenda.on("start:priority", (job) => {
          results.push(job.attrs.priority);
          if (results.length !== 3) {
            return;
          }

          resolve(results);
        });
      });

      await Promise.all([
        agenda.create("priority").schedule(now).save(),
        agenda.create("priority").schedule(now).priority("low").save(),
        agenda.create("priority").schedule(now).priority("high").save(),
      ]);
      await agenda.start();
      try {
        const results = await Promise.race([
          checkResultsPromise,

          new Promise((_, reject) => {
            setTimeout(() => {
              reject(`not processed`);
            }, 2000);
          }),
        ]);
        deepStrictEqual(results, [10, 0, -10]);
      } catch (err) {
        console.log("stats", JSON.stringify(await agenda.getRunningStats(), undefined, 3));
        throw err;
      }
    });

    it("should support custom sort option", function () {
      const sort = { foo: 1 } as const;
      const agendaSort = new Agenda({ sort });
      deepStrictEqual(agendaSort.attrs.sort, sort);
    });
  });

  describe("every running", function () {
    beforeEach(async function () {
      agenda.defaultConcurrency(1);
      agenda.processEvery(5);

      await agenda.stop();
    });

    it("should run the same job multiple times", async function () {
      let counter = 0;

      agenda.define("everyRunTest1", (_job, cb) => {
        if (counter < 2) {
          counter++;
        }

        cb();
      });

      await agenda.every(10, "everyRunTest1");

      await agenda.start();

      await agenda.jobs({ name: "everyRunTest1" });
      await delay(jobTimeout);
      strictEqual(counter, 2);

      await agenda.stop();
    });

    it("should reuse the same job on multiple runs", async function () {
      let counter = 0;

      agenda.define("everyRunTest2", (_job, cb) => {
        if (counter < 2) {
          counter++;
        }

        cb();
      });
      await agenda.every(10, "everyRunTest2");

      await agenda.start();

      await delay(jobTimeout);
      const result = await agenda.jobs({ name: "everyRunTest2" });

      strictEqual(result.length, 1);
      await agenda.stop();
    });
  });

  describe("Integration Tests", function () {
    describe(".every()", function () {
      it("Should not rerun completed jobs after restart", (done) => {
        let i = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = function (e: any) {
          done(e);
        };

        const receiveMessage = function (msg: string) {
          if (msg === "ran") {
            strictEqual(i, 0);
            i += 1;

            startService();
          } else if (msg === "notRan") {
            strictEqual(i, 1);
            done();
          } else {
            done(new Error("Unexpected response returned!"));
          }
        };

        const startService = function () {
          const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
          const n = cp.fork(serverPath, [mongoCfg, "daily"], {
            execArgv: ["-r", "ts-node/register"],
          });

          n.on("message", receiveMessage);
          n.on("error", serviceError);
        };

        startService();
      });

      it("Should properly run jobs when defined via an array", (done) => {
        const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
        const n = cp.fork(serverPath, [mongoCfg, "daily-array"], {
          execArgv: ["-r", "ts-node/register"],
        });

        let ran1 = false;
        let ran2 = false;
        let doneCalled = false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = function (e: any) {
          done(e);
        };

        const receiveMessage = function (msg: string) {
          if (msg === "test1-ran") {
            ran1 = true;
            if (ran1 && ran2 && !doneCalled) {
              doneCalled = true;
              done();
              n.send("exit");
            }
          } else if (msg === "test2-ran") {
            ran2 = true;
            if (ran1 && ran2 && !doneCalled) {
              doneCalled = true;
              done();
              n.send("exit");
            }
          } else if (!doneCalled) {
            done(new Error("Jobs did not run!"));
          }
        };

        n.on("message", receiveMessage);
        n.on("error", serviceError);
      });

      it("should not run if job is disabled", async function () {
        let counter = 0;

        agenda.define("everyDisabledTest", (_job, cb) => {
          counter++;
          cb();
        });

        const job = await agenda.every(10, "everyDisabledTest");

        job.disable();

        await job.save();
        await agenda.start();

        await delay(jobTimeout);
        await agenda.jobs({ name: "everyDisabledTest" });
        strictEqual(counter, 0);
        await agenda.stop();
      });
    });

    describe("schedule()", function () {
      it("Should not run jobs scheduled in the future", (done) => {
        let i = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = function (e: any) {
          done(e);
        };

        const receiveMessage = function (msg: string) {
          if (msg === "notRan") {
            if (i < 5) {
              done();
              return;
            }

            i += 1;

            startService();
          } else {
            done(new Error("Job scheduled in future was ran!"));
          }
        };

        const startService = function () {
          const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
          const n = cp.fork(serverPath, [mongoCfg, "define-future-job"], {
            execArgv: ["-r", "ts-node/register"],
          });

          n.on("message", receiveMessage);
          n.on("error", serviceError);
        };

        startService();
      });

      it("Should run past due jobs when process starts", (done) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = function (e: any) {
          done(e);
        };

        const receiveMessage = function (msg: string) {
          if (msg === "ran") {
            done();
          } else {
            done(new Error("Past due job did not run!"));
          }
        };

        const startService = function () {
          const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
          const n = cp.fork(serverPath, [mongoCfg, "define-past-due-job"], {
            execArgv: ["-r", "ts-node/register"],
          });

          n.on("message", receiveMessage);
          n.on("error", serviceError);
        };

        startService();
      });

      it("Should schedule using array of names", (done) => {
        const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
        const n = cp.fork(serverPath, [mongoCfg, "schedule-array"], {
          execArgv: ["-r", "ts-node/register"],
        });

        let ran1 = false;
        let ran2 = false;
        let doneCalled = false;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = (err: any) => {
          done(err);
        };

        const receiveMessage = (msg: string) => {
          if (msg === "test1-ran") {
            ran1 = true;
            if (ran1 && ran2 && !doneCalled) {
              doneCalled = true;
              done();
              n.send("exit");
            }
          } else if (msg === "test2-ran") {
            ran2 = true;
            if (ran1 && ran2 && !doneCalled) {
              doneCalled = true;
              done();
              n.send("exit");
            }
          } else if (!doneCalled) {
            done(new Error("Jobs did not run!"));
          }
        };

        n.on("message", receiveMessage);
        n.on("error", serviceError);
      });
    });

    describe("now()", function () {
      it("Should immediately run the job", (done) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serviceError = function (e: any) {
          done(e);
        };

        const receiveMessage = function (msg: string) {
          if (msg === "ran") {
            return done();
          }

          return done(new Error("Job did not immediately run!"));
        };

        const serverPath = path.join(__dirname, "fixtures", "agenda-instance.ts");
        const n = cp.fork(serverPath, [mongoCfg, "now"], {
          execArgv: ["-r", "ts-node/register"],
        });

        n.on("message", receiveMessage);
        n.on("error", serviceError);
      });
    });

    describe("General Integration", function () {
      it("Should not run a job that has already been run", async function () {
        const runCount: { [keyof: string]: number } = {};

        agenda.define("test-job", (job, cb) => {
          const id = job.attrs._id!.toString();

          runCount[id] = runCount[id] ? runCount[id] + 1 : 1;
          cb();
        });

        agenda.processEvery(100);
        await agenda.start();

        await Promise.all([...new Array(10)].map(() => agenda.now("test-job")));

        await delay(jobTimeout);
        const ids = Object.keys(runCount);
        strictEqual(ids.length, 10);
        Object.keys(runCount).forEach((id) => {
          strictEqual(runCount[id], 1);
        });
      });
    });
  });

  it('checks database for running job on "client"', async function () {
    agenda.define("test", async function () {
      await new Promise((resolve) => {
        setTimeout(resolve, 30000);
      });
    });

    const job = await agenda.now("test");
    await agenda.start();

    await new Promise((resolve) => {
      agenda.on("start:test", resolve);
    });

    strictEqual(await job.isRunning(), true);
  });

  it("should not run job if it has been removed", async function () {
    let executed = false;
    agenda.define("test", async function () {
      executed = true;
    });

    const job = new Job(agenda, {
      name: "test",
      type: "normal",
    });
    job.schedule("in 1 second");
    await job.save();

    await agenda.start();

    let jobStarted;
    let retried = 0;
    // wait till it's locked (Picked up by the event processor)
    do {
      jobStarted = await agenda.db.getJobs({ name: "test" });
      if (!jobStarted[0].lockedAt) {
        await delay(100);
      }
      retried++;
    } while (!jobStarted[0].lockedAt || retried > 10);

    notStrictEqual(jobStarted[0].lockedAt, undefined);

    await job.remove();

    let error;
    const completed = new Promise<void>((resolve) => {
      agenda.on("error", (err) => {
        error = err;
        resolve();
      });
    });

    await Promise.race([
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, 1000);
      }),
      completed,
    ]);

    strictEqual(executed, false);
    if (typeof error !== "undefined") {
      strictEqual((error as Error).message.includes("(name: test) cannot be updated in the database"), true);
    }
  });

  describe("job fork mode", function () {
    it("runs a job in fork mode", async function () {
      const agendaFork = new Agenda({
        mongo: mongoDb,
        forkHelper: {
          path: "./tests/helpers/fork-helper.ts",
          options: {
            env: { DB_CONNECTION: mongoCfg },
            execArgv: ["-r", "ts-node/register"],
          },
        },
      });

      strictEqual(agendaFork.forkHelper?.path, "./tests/helpers/fork-helper.ts");

      const job = agendaFork.create("some job");
      job.forkMode(true);
      job.schedule("now");
      await job.save();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = await agenda.db.getJobById(job.attrs._id as any);

      if (!jobData) {
        throw new Error("job not found");
      }

      strictEqual(jobData.fork, true);

      // initialize job definition (keep in a seperate file to have a easier fork mode implementation)
      someJobDefinition(agendaFork);

      await agendaFork.start();

      do {
        await delay(50);
      } while (await job.isRunning());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobDataFinished = await agenda.db.getJobById(job.attrs._id as any);
      notStrictEqual(jobDataFinished?.lastFinishedAt, undefined);
      strictEqual(jobDataFinished?.failReason, null);
      strictEqual(jobDataFinished?.failCount, null);
    });

    it("runs a job in fork mode, but let it fail", async function () {
      const agendaFork = new Agenda({
        mongo: mongoDb,
        forkHelper: {
          path: "./tests/helpers/fork-helper.ts",
          options: {
            env: { DB_CONNECTION: mongoCfg },
            execArgv: ["-r", "ts-node/register"],
          },
        },
      });

      strictEqual(agendaFork.forkHelper?.path, "./tests/helpers/fork-helper.ts");

      const job = agendaFork.create("some job", { failIt: "error" });
      job.forkMode(true);
      job.schedule("now");
      await job.save();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = await agenda.db.getJobById(job.attrs._id as any);

      if (!jobData) {
        throw new Error("job not found");
      }

      strictEqual(jobData.fork, true);

      // initialize job definition (keep in a seperate file to have a easier fork mode implementation)
      someJobDefinition(agendaFork);

      await agendaFork.start();

      do {
        await delay(50);
      } while (await job.isRunning());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobDataFinished = await agenda.db.getJobById(job.attrs._id as any);
      notStrictEqual(jobDataFinished?.lastFinishedAt, undefined);
      notStrictEqual(jobDataFinished?.failReason, null);
      strictEqual(jobDataFinished?.failCount, 1);
    });

    it("runs a job in fork mode, but let it die", async function () {
      const agendaFork = new Agenda({
        mongo: mongoDb,
        forkHelper: {
          path: "./tests/helpers/fork-helper.ts",
          options: {
            env: { DB_CONNECTION: mongoCfg },
            execArgv: ["-r", "ts-node/register"],
          },
        },
      });

      strictEqual(agendaFork.forkHelper?.path, "./tests/helpers/fork-helper.ts");

      const job = agendaFork.create("some job", { failIt: "die" });
      job.forkMode(true);
      job.schedule("now");
      await job.save();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = await agenda.db.getJobById(job.attrs._id as any);

      if (!jobData) {
        throw new Error("job not found");
      }

      strictEqual(jobData.fork, true);

      // initialize job definition (keep in a seperate file to have a easier fork mode implementation)
      someJobDefinition(agendaFork);

      await agendaFork.start();

      do {
        // console.log('.');
        await delay(50);
      } while (await job.isRunning());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobDataFinished = await agenda.db.getJobById(job.attrs._id as any);
      notStrictEqual(jobDataFinished?.lastFinishedAt, undefined);
      notStrictEqual(jobDataFinished?.failReason, null);
      strictEqual(jobDataFinished?.failCount, 1);
    });

    it("runs a job in fork mode, but let it timeout", async function () {
      const agendaFork = new Agenda({
        mongo: mongoDb,
        forkHelper: {
          path: "./tests/helpers/fork-helper.ts",
          options: {
            env: { DB_CONNECTION: mongoCfg },
            execArgv: ["-r", "ts-node/register"],
          },
        },
        defaultLockLifetime: 1000,
      });

      strictEqual(agendaFork.forkHelper?.path, "./tests/helpers/fork-helper.ts");

      const job = agendaFork.create("some job", { failIt: "timeout" });
      job.forkMode(true);
      job.schedule("now");
      await job.save();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobData = await agenda.db.getJobById(job.attrs._id as any);

      if (!jobData) {
        throw new Error("job not found");
      }

      strictEqual(jobData.fork, true);

      // initialize job definition (keep in a seperate file to have a easier fork mode implementation)
      someJobDefinition(agendaFork);

      await agendaFork.start();

      do {
        // console.log('.');
        await delay(50);
      } while (await job.isRunning());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobDataFinished = await agenda.db.getJobById(job.attrs._id as any);
      notStrictEqual(jobDataFinished?.lastFinishedAt, undefined);
      notStrictEqual(jobDataFinished?.failReason, null);
      strictEqual(jobDataFinished?.failCount, 1);
    });
  });
});
