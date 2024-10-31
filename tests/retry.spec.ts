import { Db } from "mongodb";
import { setTimeout as delay } from "node:timers/promises";
import { Agenda, Job } from "../src/index";
import { IMockMongo, mockMongo } from "./helpers/mock-mongodb";

const jobType = "do work";
const jobProcessor = function () {};

describe("Retry", function () {
  // Mocked MongoDB
  let mockedMongo: IMockMongo;
  let mongoDb: Db; // mongo db connection db instance

  const clearJobs = async (): Promise<void> => {
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

  it("should retry a job", async function () {
    let shouldFail = true;

    agenda.processEvery(100); // Shave 5s off test runtime :grin:
    agenda.define("a job", (_job, done) => {
      if (shouldFail) {
        shouldFail = false;
        return done(new Error("test failure"));
      }

      done();
      return undefined;
    });

    agenda.on("fail:a job", (err: unknown, job: Job) => {
      if (err) {
        // Do nothing as this is expected to fail.
      }

      job.schedule("now").save();
    });

    const successPromise = new Promise((resolve) => {
      agenda.on("success:a job", resolve);
    });

    await agenda.now("a job");

    await agenda.start();
    await successPromise;
  }).timeout(10000);
});
