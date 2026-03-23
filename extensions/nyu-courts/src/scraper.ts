/**
 * NYU Facilities schedule fetcher.
 *
 * Fetches events from Google Calendar public feeds (JSON API with iCal fallback)
 * for basketball courts, pools, and gym/fitness areas.
 */

const GOOGLE_CALENDAR_API_BASE = "https://clients6.google.com/calendar/v3/calendars";
const GCAL_API_KEY = "AIzaSyBNlYH01_9Hc5S1J9vuFmu2nUqBZJNAXxs"; // public embed key

// ── Calendar IDs by facility ──

const PAULSON_COURT_CALENDARS = [
  {
    id: "c_d712bdf8c170e91f2fe27641b30d4a05725567afb80c8b98ea311445c12cd238@group.calendar.google.com",
    label: "Paulson Court 3 (Main Court)",
  },
  {
    id: "c_ad9640c6656f0dec228d4f658bbd0edb7ae2e6fbaae0d44b87e31444a4e2039b@group.calendar.google.com",
    label: "Paulson Court 1 (Vball)",
  },
  {
    id: "c_11c10edc333799c4f4b62dc0715427d824d494cafd982a2b031d5146b4a78b10@group.calendar.google.com",
    label: "Paulson Court 2",
  },
];

const PAF_COURT_CALENDARS = [
  {
    id: "nyu.edu_nstcp1ep6bota5nsuv0oa2btcs@group.calendar.google.com",
    label: "PAF Main Court",
  },
];

const PAULSON_POOL_CALENDARS = [
  {
    id: "c_1bf7e598b00653c33381321f04cfa9949032bb71f7d08ef5ded07d083254313c@group.calendar.google.com",
    label: "Paulson Pool",
  },
];

const PAULSON_GYM_CALENDARS = [
  {
    id: "c_c2c9b3a2da7a718e7697103402c6397f6153ee50acbddd899dc1abdd93a22a94@group.calendar.google.com",
    label: "Paulson Cardio Room",
  },
  {
    id: "c_1fcfaa03f98654da16346965476869d421245bb7f0c1d952967750a736cef74d@group.calendar.google.com",
    label: "Paulson Jogging Track",
  },
];

// ── Static hours for facilities without calendars ──

const STATIC_HOURS = {
  pafPool: {
    regular: "Mon-Wed 9am-3pm | Thu 9am-3pm & 6pm-9pm | Fri 9am-3pm & 6pm-9pm | Sat-Sun 8:30am-3pm",
    note: "PAF Pool (Palladium Natatorium) — no live calendar available, hours may vary.",
  },
  facility404: {
    regular: "Mon-Thu 6am-10:30pm | Fri 6am-8pm | Sat-Sun 8am-8pm",
    note: "404 Fitness — no live calendar available, hours may vary.",
  },
  pafGym: {
    regular: "Mon-Thu 7:30am-10pm | Fri 7:30am-9pm | Sat-Sun 8:30am-9pm",
    note: "PAF Gym area — no live calendar; follows general PAF facility hours.",
  },
  paulsonGeneral: {
    regular: "Mon-Thu 6:30am-10pm | Fri 6:30am-8pm | Sat-Sun 8am-8pm",
  },
  pafGeneral: {
    regular: "Mon-Thu 7:30am-10pm | Fri 7:30am-9pm | Sat-Sun 8:30am-9pm",
  },
};

// Spring break & special closures (Spring 2026)
const SPECIAL_CLOSURES = [
  { label: "Spring Break", start: "2026-03-16", end: "2026-03-22", note: "Modified hours — check overview page" },
  { label: "Easter", date: "2026-04-05", note: "Most facilities CLOSED (Paulson 9am-5pm)" },
  { label: "Final Exam Week", start: "2026-05-04", end: "2026-05-08", note: "Modified hours" },
];

// ── Types ──

export type FacilityType = "basketball" | "pool" | "gym" | "all";
export type LocationId = "paulson" | "paf" | "all";

export type CalendarEvent = {
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  calendarLabel?: string;
};

export type FacilitySchedule = {
  facility: string;
  facilityType: FacilityType;
  url: string;
  events: CalendarEvent[];
  staticHours?: string;
  note?: string;
  error?: string;
};

// ── Google Calendar JSON API ──

async function fetchEventsViaJsonApi(
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[] | null> {
  const params = new URLSearchParams({
    calendarId,
    singleEvents: "true",
    timeZone: "America/New_York",
    maxAttendees: "1",
    maxResults: "250",
    sanitizeHtml: "true",
    timeMin,
    timeMax,
    key: GCAL_API_KEY,
  });

  const url = `${GOOGLE_CALENDAR_API_BASE}/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as {
    items?: Array<{
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      description?: string;
    }>;
  };

  return (data.items || []).map((item) => ({
    summary: item.summary || "(no title)",
    start: item.start?.dateTime || item.start?.date || "",
    end: item.end?.dateTime || item.end?.date || "",
    location: item.location,
    description: item.description,
  }));
}

// ── iCal feed (fallback) ──

function parseICalDate(dtStr: string): Date {
  const clean = dtStr.replace(/[^0-9TZ]/g, "");
  if (clean.endsWith("Z")) {
    const y = +clean.slice(0, 4);
    const m = +clean.slice(4, 6) - 1;
    const d = +clean.slice(6, 8);
    const h = +clean.slice(9, 11);
    const mi = +clean.slice(11, 13);
    const s = +clean.slice(13, 15);
    return new Date(Date.UTC(y, m, d, h, mi, s));
  }
  const y = +clean.slice(0, 4);
  const m = +clean.slice(4, 6) - 1;
  const d = +clean.slice(6, 8);
  const h = +clean.slice(9, 11) || 0;
  const mi = +clean.slice(11, 13) || 0;
  const s = +clean.slice(13, 15) || 0;
  return new Date(y, m, d, h, mi, s);
}

function parseICalFeed(
  icalText: string,
  timeMin: Date,
  timeMax: Date,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const blocks = icalText.split("BEGIN:VEVENT");
  const calNameMatch = icalText.match(/X-WR-CALNAME:\s*(.+)/);
  const calName = calNameMatch?.[1]?.trim();

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const get = (key: string): string => {
      const re = new RegExp(`^${key}[^:]*:(.+)`, "m");
      return block.match(re)?.[1]?.trim() || "";
    };

    const dtStart = get("DTSTART");
    const dtEnd = get("DTEND");
    const summary = get("SUMMARY");
    if (!dtStart) continue;

    const startDate = parseICalDate(dtStart);
    const endDate = dtEnd ? parseICalDate(dtEnd) : startDate;
    if (endDate < timeMin || startDate > timeMax) continue;

    events.push({
      summary: summary || "(no title)",
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      location: get("LOCATION") || undefined,
      description: get("DESCRIPTION") || undefined,
      calendarLabel: calName,
    });
  }
  return events;
}

async function fetchEventsViaIcal(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iCal feed ${res.status} for ${calendarId}`);
  }
  return parseICalFeed(await res.text(), timeMin, timeMax);
}

// ── Main fetch logic ──

async function fetchCalendarEvents(
  cal: { id: string; label: string },
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const jsonEvents = await fetchEventsViaJsonApi(cal.id, timeMin, timeMax);
  if (jsonEvents !== null) {
    return jsonEvents.map((e) => ({ ...e, calendarLabel: cal.label }));
  }
  const minDate = new Date(timeMin);
  const maxDate = new Date(timeMax);
  const icalEvents = await fetchEventsViaIcal(cal.id, minDate, maxDate);
  return icalEvents.map((e) => ({ ...e, calendarLabel: e.calendarLabel || cal.label }));
}

function buildTimeRange(days: number): { timeMin: string; timeMax: string } {
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).toISOString();
  return { timeMin, timeMax };
}

async function fetchScheduleForCalendars(
  name: string,
  facilityType: FacilityType,
  url: string,
  calendars: Array<{ id: string; label: string }>,
  timeMin: string,
  timeMax: string,
  staticHours?: string,
  note?: string,
): Promise<FacilitySchedule> {
  const results = await Promise.allSettled(
    calendars.map((cal) => fetchCalendarEvents(cal, timeMin, timeMax)),
  );

  const allEvents: CalendarEvent[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allEvents.push(...result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return {
    facility: name,
    facilityType,
    url,
    events: allEvents,
    staticHours,
    note,
    error: errors.length > 0 && allEvents.length === 0 ? errors.join("; ") : undefined,
  };
}

function createStaticSchedule(
  name: string,
  facilityType: FacilityType,
  url: string,
  hours: { regular: string; note?: string },
): FacilitySchedule {
  return {
    facility: name,
    facilityType,
    url,
    events: [],
    staticHours: hours.regular,
    note: hours.note,
  };
}

// ── Public API ──

export async function fetchFacilityStatus(
  facility: FacilityType,
  location: LocationId,
  days = 7,
): Promise<FacilitySchedule[]> {
  const { timeMin, timeMax } = buildTimeRange(days);
  const promises: Promise<FacilitySchedule>[] = [];

  // Basketball courts
  if (facility === "basketball" || facility === "all") {
    if (location === "paulson" || location === "all") {
      promises.push(
        fetchScheduleForCalendars(
          "Paulson Courts 1-4 (John A. Paulson Center)",
          "basketball",
          "https://gonyuathletics.com/sports/2024/12/18/paulson-courts-1-4.aspx",
          PAULSON_COURT_CALENDARS,
          timeMin,
          timeMax,
          STATIC_HOURS.paulsonGeneral.regular,
        ),
      );
    }
    if (location === "paf" || location === "all") {
      promises.push(
        fetchScheduleForCalendars(
          "PAF Main Court (Palladium Athletic Facility)",
          "basketball",
          "https://gonyuathletics.com/sports/2014/12/18/pafmaincourt.aspx?id=1520",
          PAF_COURT_CALENDARS,
          timeMin,
          timeMax,
          STATIC_HOURS.pafGeneral.regular,
        ),
      );
    }
  }

  // Swimming pools
  if (facility === "pool" || facility === "all") {
    if (location === "paulson" || location === "all") {
      promises.push(
        fetchScheduleForCalendars(
          "Paulson Pool (Natatorium)",
          "pool",
          "https://gonyuathletics.com/sports/2024/12/18/paulson-pool.aspx",
          PAULSON_POOL_CALENDARS,
          timeMin,
          timeMax,
        ),
      );
    }
    if (location === "paf" || location === "all") {
      promises.push(
        Promise.resolve(
          createStaticSchedule(
            "PAF Pool (Palladium Natatorium)",
            "pool",
            "https://gonyuathletics.com/sports/2021/2/25/nyu-athletics-facilities-hours-access.aspx",
            STATIC_HOURS.pafPool,
          ),
        ),
      );
    }
  }

  // Gym / Fitness
  if (facility === "gym" || facility === "all") {
    if (location === "paulson" || location === "all") {
      promises.push(
        fetchScheduleForCalendars(
          "Paulson Cardio Room & Jogging Track",
          "gym",
          "https://gonyuathletics.com/sports/2024/12/18/paulson-cardio-jogging-track.aspx",
          PAULSON_GYM_CALENDARS,
          timeMin,
          timeMax,
          STATIC_HOURS.paulsonGeneral.regular,
        ),
      );
    }
    if (location === "paf" || location === "all") {
      promises.push(
        Promise.resolve(
          createStaticSchedule(
            "PAF Gym Area (Palladium Athletic Facility)",
            "gym",
            "https://gonyuathletics.com/sports/2021/2/25/nyu-athletics-facilities-hours-access.aspx",
            STATIC_HOURS.pafGym,
          ),
        ),
      );
    }
    // 404 Fitness (always included when gym is requested, regardless of location)
    promises.push(
      Promise.resolve(
        createStaticSchedule(
          "404 Fitness",
          "gym",
          "https://gonyuathletics.com/sports/2016/9/22/404_Activity_Areas.aspx",
          STATIC_HOURS.facility404,
        ),
      ),
    );
  }

  return Promise.all(promises);
}

/** Backward-compatible alias for basketball-only queries. */
export async function fetchCourtStatus(
  court: LocationId,
  days = 7,
): Promise<FacilitySchedule[]> {
  return fetchFacilityStatus("basketball", court, days);
}

export { SPECIAL_CLOSURES, STATIC_HOURS };
