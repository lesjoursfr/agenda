import { Agenda } from "../../src/index";

export default {
  none: function (): void {},
  daily: function (agenda: Agenda) {
    agenda.define("once a day test job", (_job, done) => {
      process.send!("ran");
      done();
      process.exit(0);
    });

    agenda.every("one day", "once a day test job");
  },
  "daily-array": function (agenda: Agenda) {
    agenda.define("daily test 1", (_job, done) => {
      process.send!("test1-ran");
      done();
    });

    agenda.define("daily test 2", (_job, done) => {
      process.send!("test2-ran");
      done();
    });

    agenda.every("one day", ["daily test 1", "daily test 2"]);
  },
  "define-future-job": function (agenda: Agenda) {
    const future = new Date();
    future.setDate(future.getDate() + 1);

    agenda.define("job in the future", (_job, done) => {
      process.send!("ran");
      done();
      process.exit(0);
    });

    agenda.schedule(future, "job in the future");
  },
  "define-past-due-job": function (agenda: Agenda) {
    const past = new Date();
    past.setDate(past.getDate() - 1);

    agenda.define("job in the past", (_job, done) => {
      process.send!("ran");
      done();
      process.exit(0);
    });

    agenda.schedule(past, "job in the past");
  },
  "schedule-array": function (agenda: Agenda) {
    const past = new Date();
    past.setDate(past.getDate() - 1);

    agenda.define("scheduled test 1", (_unlockJobsjob, done) => {
      process.send!("test1-ran");
      done();
    });

    agenda.define("scheduled test 2", (_job, done) => {
      process.send!("test2-ran");
      done();
    });

    agenda.schedule(past, ["scheduled test 1", "scheduled test 2"]);
  },
  now: function (agenda: Agenda) {
    agenda.define("now run this job", (_job, done) => {
      process.send!("ran");
      done();
      process.exit(0);
    });

    agenda.now("now run this job");
  },
};
