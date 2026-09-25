"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { WEEKDAYS, type Pattern, type Weekday } from "@/lib/assistant/patterns";
import {
  INTEREST_OPTIONS,
  newId,
  type AIProfile,
  type Habit,
} from "@/types/persona";

// Edit forms used by the "My AI Profile" page. Each takes the current
// values and returns the changed part through onSave; the page saves it.

function Actions({ onCancel, saving, label = "Save" }: { onCancel: () => void; saving: boolean; label?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : label}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- about

export type AboutValues = { name: string } & AIProfile["about"];

export function AboutForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: AboutValues;
  saving: boolean;
  onSave: (values: AboutValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = (key: keyof AboutValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-4"
    >
      <Field label="What should the AI call you?">
        {(id) => <Input id={id} value={v.name} onChange={set("name")} maxLength={50} placeholder="e.g. Nour" />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="You are a...">
          {(id) => (
            <Select id={id} value={v.occupation ?? ""} onChange={set("occupation")}>
              <option value="">Not set</option>
              <option value="student">Student</option>
              <option value="employee">Employee</option>
              <option value="entrepreneur">Entrepreneur</option>
              <option value="freelancer">Freelancer</option>
              <option value="other">Something else</option>
            </Select>
          )}
        </Field>
        <Field label="Role">
          {(id) => <Input id={id} value={v.role ?? ""} onChange={set("role")} maxLength={80} placeholder="Engineering student" />}
        </Field>
      </div>
      <Field label="University, company or business">
        {(id) => <Input id={id} value={v.organization ?? ""} onChange={set("organization")} maxLength={100} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Field">
          {(id) => <Input id={id} value={v.field ?? ""} onChange={set("field")} maxLength={100} placeholder="Engineering" />}
        </Field>
        <Field label="Year / term">
          {(id) => <Input id={id} value={v.term ?? ""} onChange={set("term")} maxLength={60} placeholder="Last term" />}
        </Field>
      </div>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- interests & skills

function ChipInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const items = text.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...values];
    for (const item of items) {
      if (!next.some((v) => v.toLowerCase() === item.toLowerCase())) next.push(item);
    }
    onChange(next.slice(0, 30));
    setText("");
  };
  return (
    <Field label={label}>
      {(id) => (
        <div>
          <div className="flex gap-2">
            <Input
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={placeholder}
            />
            <Button type="button" variant="secondary" onClick={add} disabled={!text.trim()}>
              Add
            </Button>
          </div>
          {values.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {values.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChange(values.filter((x) => x !== v))}
                  className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent hover:bg-danger-soft hover:text-danger"
                  aria-label={`Remove ${v}`}
                >
                  {v} ×
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function InterestsForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: { interests: string[]; skills: string[] };
  saving: boolean;
  onSave: (values: { interests: string[]; skills: string[] }) => void;
  onCancel: () => void;
}) {
  const [interests, setInterests] = useState(initial.interests);
  const [skills, setSkills] = useState(initial.skills);
  const custom = interests.filter((i) => !INTEREST_OPTIONS.includes(i));
  const toggle = (o: string) =>
    setInterests((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ interests, skills });
      }}
      className="space-y-4"
    >
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Interests</p>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              aria-pressed={interests.includes(o)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                interests.includes(o)
                  ? "border-accent bg-accent text-white"
                  : "border-line text-ink hover:border-accent/40"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      <ChipInput
        label="Other interests"
        values={custom}
        onChange={(next) => setInterests([...interests.filter((i) => INTEREST_OPTIONS.includes(i)), ...next])}
        placeholder="e.g. Public speaking"
      />
      <ChipInput
        label="Skills you want to develop"
        values={skills}
        onChange={setSkills}
        placeholder="e.g. Python, n8n, Sales"
      />
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- schedule

export type ScheduleValues = Pick<AIProfile, "schedule" | "preferences">;

export function ScheduleForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: ScheduleValues;
  saving: boolean;
  onSave: (values: ScheduleValues) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(initial.schedule);
  const [p, setP] = useState(initial.preferences);
  const text = (key: keyof ScheduleValues["schedule"]) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS((prev) => ({ ...prev, [key]: e.target.value || undefined }));
  const pref = (key: keyof ScheduleValues["preferences"]) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    setP((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ schedule: s, preferences: p });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wake up">
          {(id) => <Input id={id} type="time" value={s.wake ?? ""} onChange={text("wake")} />}
        </Field>
        <Field label="Sleep">
          {(id) => <Input id={id} type="time" value={s.sleep ?? ""} onChange={text("sleep")} />}
        </Field>
      </div>
      <Field label="University / work hours">
        {(id) => <Input id={id} value={s.busy ?? ""} onChange={text("busy")} maxLength={300} placeholder="e.g. Sun–Thu 9:00–15:00" />}
      </Field>
      <Field label="When are you usually free?">
        {(id) => <Input id={id} value={s.free ?? ""} onChange={text("free")} maxLength={300} placeholder="e.g. Evenings and Fridays" />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Best time to study">
          {(id) => <Input id={id} value={s.study_time ?? ""} onChange={text("study_time")} maxLength={100} placeholder="e.g. After 20:00" />}
        </Field>
        <Field label="Best time for projects">
          {(id) => <Input id={id} value={s.project_time ?? ""} onChange={text("project_time")} maxLength={100} placeholder="e.g. Weekends" />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hours a day for goals">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={16}
              step={0.5}
              value={s.daily_hours ?? ""}
              onChange={(e) =>
                setS((prev) => ({ ...prev, daily_hours: e.target.value === "" ? undefined : Number(e.target.value) }))
              }
            />
          )}
        </Field>
        <Field label="Tasks per day">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={30}
              value={p.tasks_per_day ?? ""}
              onChange={(e) =>
                setP((prev) => ({ ...prev, tasks_per_day: e.target.value === "" ? undefined : Number(e.target.value) }))
              }
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Best energy">
          {(id) => (
            <Select id={id} value={p.energy ?? ""} onChange={pref("energy")}>
              <option value="">Not set</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="flexible">Flexible</option>
            </Select>
          )}
        </Field>
        <Field label="Sessions">
          {(id) => (
            <Select id={id} value={p.session ?? ""} onChange={pref("session")}>
              <option value="">Not set</option>
              <option value="long">Long, focused</option>
              <option value="short">Short</option>
              <option value="mixed">Mixed</option>
            </Select>
          )}
        </Field>
        <Field label="Schedule">
          {(id) => (
            <Select id={id} value={p.intensity ?? ""} onChange={pref("intensity")}>
              <option value="">Not set</option>
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label="Free time to keep every day">
        {(id) => (
          <Input
            id={id}
            value={p.free_time ?? ""}
            onChange={(e) => setP((prev) => ({ ...prev, free_time: e.target.value || undefined }))}
            maxLength={100}
            placeholder="e.g. 2 hours"
          />
        )}
      </Field>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}

// ---------------------------------------------------------------- routines

const DAY_LABELS: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

export function HabitForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Habit | null;
  saving: boolean;
  onSave: (habit: Habit) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<Pattern["type"]>(initial?.pattern.type ?? "daily");
  const [days, setDays] = useState<Weekday[]>(
    initial?.pattern.type === "days_of_week" ? initial.pattern.days : ["mon", "wed", "fri"]
  );
  const [n, setN] = useState(initial?.pattern.type === "every_n_days" ? initial.pattern.n : 2);
  const [on, setOn] = useState(initial?.pattern.type === "on_off" ? initial.pattern.on_days : 3);
  const [off, setOff] = useState(initial?.pattern.type === "on_off" ? initial.pattern.off_days : 1);
  const [time, setTime] = useState(initial?.time ?? "");
  const [duration, setDuration] = useState(initial?.duration ? String(initial.duration) : "");

  const pattern = (): Pattern => {
    switch (type) {
      case "days_of_week":
        return { type, days: days.length ? days : ["mon"] };
      case "every_n_days":
        return { type, n: Math.min(Math.max(n, 1), 60) };
      case "on_off":
        return { type, on_days: Math.min(Math.max(on, 1), 30), off_days: Math.min(Math.max(off, 0), 30) };
      default:
        return { type } as Pattern;
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const minutes = Number(duration);
        onSave({
          id: initial?.id ?? newId(),
          name: name.trim(),
          pattern: pattern(),
          time: time || null,
          duration: duration && minutes >= 5 ? Math.min(minutes, 720) : null,
        });
      }}
      className="space-y-4"
    >
      <Field label="Activity">
        {(id) => (
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} placeholder="e.g. Gym" autoFocus={!initial} />
        )}
      </Field>
      <Field label="How often?">
        {(id) => (
          <Select id={id} value={type} onChange={(e) => setType(e.target.value as Pattern["type"])}>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekends">Every weekend</option>
            <option value="days_of_week">Specific days</option>
            <option value="every_n_days">Every few days</option>
            <option value="on_off">Days on / days off</option>
          </Select>
        )}
      </Field>
      {type === "days_of_week" && (
        <div className="flex gap-1.5" role="group" aria-label="Days">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}
              aria-pressed={days.includes(d)}
              className={`h-10 flex-1 rounded-xl text-sm font-semibold transition ${
                days.includes(d) ? "bg-accent text-white" : "bg-surface-2 text-muted"
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      )}
      {type === "every_n_days" && (
        <Field label="Every how many days?">
          {(id) => <Input id={id} type="number" min={1} max={60} value={n} onChange={(e) => setN(Number(e.target.value))} />}
        </Field>
      )}
      {type === "on_off" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Days on">
            {(id) => <Input id={id} type="number" min={1} max={30} value={on} onChange={(e) => setOn(Number(e.target.value))} />}
          </Field>
          <Field label="Days off">
            {(id) => <Input id={id} type="number" min={0} max={30} value={off} onChange={(e) => setOff(Number(e.target.value))} />}
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Time (optional)">
          {(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
        </Field>
        <Field label="Minutes (optional)">
          {(id) => <Input id={id} type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />}
        </Field>
      </div>
      <Actions onCancel={onCancel} saving={saving} label={initial ? "Save" : "Add routine"} />
    </form>
  );
}

// ---------------------------------------------------------------- instructions

export function InstructionsForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim());
      }}
      className="space-y-4"
    >
      <Field label="What else should your AI know about how you like to work?">
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Never schedule anything on Friday mornings. Keep study sessions under an hour. Remind me to take breaks."
          />
        )}
      </Field>
      <Actions onCancel={onCancel} saving={saving} />
    </form>
  );
}
