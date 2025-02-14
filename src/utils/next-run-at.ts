import date from "@lesjoursfr/date";
import humanInterval from "@lesjoursfr/human-interval";
import { CronExpressionParser } from "cron-parser";
import debug from "debug";
import { DateTime } from "luxon";
import type { IJobParameters } from "../interfaces";
import { isValidDate } from "./is-valid-date";

const log = debug("agenda:nextRunAt");

const dateForTimezone = (timezoneDate: Date, timezone?: string): DateTime =>
  DateTime.fromJSDate(timezoneDate, { zone: timezone });

export function isValidHumanInterval(value: unknown): value is string {
  const transformedValue = humanInterval(value as string);
  return typeof transformedValue === "number" && Number.isNaN(transformedValue) === false;
}

/**
 * Internal method that computes the interval
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const computeFromInterval = (attrs: IJobParameters<any>): Date => {
  const previousNextRunAt = attrs.nextRunAt || new Date();
  log("[%s:%s] computing next run via interval [%s]", attrs.name, attrs._id, attrs.repeatInterval);

  const lastRun = dateForTimezone(attrs.lastRunAt || new Date(), attrs.repeatTimezone);

  const cronOptions = {
    currentDate: lastRun.toJSDate(),
    tz: attrs.repeatTimezone,
  };

  let nextRunAt: Date | null = null;

  let error;
  if (typeof attrs.repeatInterval === "string") {
    try {
      let cronTime = CronExpressionParser.parse(attrs.repeatInterval, cronOptions);
      let nextDate = cronTime.next().toDate();
      if (nextDate.valueOf() === lastRun.valueOf() || nextDate.valueOf() <= previousNextRunAt.valueOf()) {
        // Handle cronTime giving back the same date for the next run time
        cronOptions.currentDate = new Date(lastRun.valueOf() + 1000);
        cronTime = CronExpressionParser.parse(attrs.repeatInterval, cronOptions);
        nextDate = cronTime.next().toDate();
      }

      nextRunAt = nextDate;
    } catch (err) {
      error = err;
    }
  }

  if (isValidHumanInterval(attrs.repeatInterval)) {
    if (!attrs.lastRunAt) {
      nextRunAt = new Date(lastRun.valueOf());
    } else {
      const intervalValue = humanInterval(attrs.repeatInterval) as number;
      nextRunAt = new Date(lastRun.valueOf() + intervalValue);
    }
  }

  if (!isValidDate(nextRunAt)) {
    log("[%s:%s] failed to calculate nextRunAt due to invalid repeat interval", attrs.name, attrs._id);
    throw new Error(
      `failed to calculate nextRunAt due to invalid repeat interval (${attrs.repeatInterval}): ${
        error || "no readable human interval"
      }`
    );
  }

  return nextRunAt;
};

/**
 * Internal method to compute next run time from the repeat string
 * @returns {undefined}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeFromRepeatAt(attrs: IJobParameters<any>): Date {
  const lastRun = attrs.lastRunAt || new Date();
  const nextDate = date(attrs.repeatAt!).valueOf();

  // If you do not specify offset date for below test it will fail for ms
  const offset = new Date();

  if (offset.getTime() === date(attrs.repeatAt!, offset).getTime()) {
    log("[%s:%s] failed to calculate repeatAt due to invalid format", attrs.name, attrs._id);
    // this.attrs.nextRunAt = undefined;
    // this.fail('failed to calculate repeatAt time due to invalid format');
    throw new Error("failed to calculate repeatAt time due to invalid format");
  }

  if (nextDate.valueOf() === lastRun.valueOf()) {
    return date("tomorrow at ", attrs.repeatAt);
  }

  return date(attrs.repeatAt!);
}
